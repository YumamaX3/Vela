import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";
// M3 §2 — the funnel. This is a DELIBERATE ESM cycle: logshipper/index.js
// imports appendStructuredEntry + appendRawLine back from this module. It is
// safe because (a) both sides expose hoisted `export function` declarations,
// (b) every cross-call sits inside a function body, and (c) NOTHING here reads
// a cross-module binding at module-eval time — the imported names are only
// CALLED later. `log-double-capture.test.js` and `console-log-buffer.test.js`
// both import this module FIRST, so that entry order is what proves it.
import { shipConsoleLine, shipContainerLine, shipLog, LOG_LEVELS } from "./logshipper/index.js";
// M6 §3 — the correlation stamp. The wrapper reads the live ALS store HERE, at
// the one seam every console.* call already passes through, which is what lets
// ~162 logger call sites become joinable with zero edits. The read is
// LIVENESS-CHECKED inside getVoyage(): a store whose closedAt is set yields
// null, so a detached task that outlived its request renders honestly
// unjoinable instead of forging attribution to a finished voyage.
import { getVoyage } from "./logContext.js";

const consoleLevels = ["log", "info", "warn", "error", "debug"];

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    logs: [],
    entries: [], // Structured log entries
    seq: 0,
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
  };
  global._consoleLogBufferState.emitter.setMaxListeners(100);
}

const state = global._consoleLogBufferState;

if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(100);
}

if (!state.entries) state.entries = [];
if (state.seq === undefined) state.seq = 0;
if (!state.pendingLines) state.pendingLines = [];
if (!state.pendingEntries) state.pendingEntries = [];
if (!state.flushTimer) state.flushTimer = null;
// Container-stream tap (the Dozzle shore): process.stdout/stderr lines that
// never passed through console.* — Next's own banner, dependency prints,
// crash stacks. Guarded against double-capture: console.* wrappers emit via
// appendLine AND then write to stdout through the originals, so the tap
// suppresses while appendLine is in flight.
if (!state.stdoutPatched) state.stdoutPatched = false;
if (!state.originalStdoutWrite) state.originalStdoutWrite = null;
if (!state.originalStderrWrite) state.originalStderrWrite = null;
if (!state.suppressStdoutTap) state.suppressStdoutTap = false;
// Container-view entries keep their own ring (not mixed into console entries).
if (!state.rawEntries) state.rawEntries = [];
if (!state.pendingRawEntries) state.pendingRawEntries = [];

const FLUSH_INTERVAL_MS = 80;
const MAX_BATCH_LINES = 50;

function flushPendingLines() {
  state.flushTimer = null;
  if (!state.pendingLines.length && !state.pendingRawEntries.length) return;

  const lines = state.pendingLines.splice(0, state.pendingLines.length);
  const entries = state.pendingEntries ? state.pendingEntries.splice(0, state.pendingEntries.length) : [];
  const rawEntries = state.pendingRawEntries.splice(0, state.pendingRawEntries.length);
  state.emitter.emit("lines", lines);
  if (entries.length) {
    state.emitter.emit("entries", entries);
  }
  if (rawEntries.length) {
    state.emitter.emit("raw", rawEntries);
  }
}

function scheduleFlush() {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(flushPendingLines, FLUSH_INTERVAL_MS);
  state.flushTimer?.unref?.();
}

// HH:MM:SS in the server's local format
function timeStamp(date = new Date()) {
  return date.toLocaleTimeString("en-GB", { hour12: false });
}

// Strip ANSI escape codes
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  return typeof str === "string" ? str.replace(ANSI_RE, "") : String(str);
}

function formatArg(arg) {
  if (typeof arg === "string") return stripAnsi(arg);
  if (arg instanceof Error) return stripAnsi(arg.stack || arg.message || String(arg));
  try {
    return stripAnsi(JSON.stringify(arg));
  } catch {
    return stripAnsi(String(arg));
  }
}

// Extract tags like [FETCH], [AUTH], [RTK], [STREAM], [DB], etc.
const TAG_RE = /\[([A-Za-z0-9_-]{2,24})\]/g;

function extractTags(text) {
  const tags = new Set();
  let match;
  while ((match = TAG_RE.exec(text)) !== null) {
    const candidate = match[1].toUpperCase();
    if (!["LOG", "INFO", "WARN", "ERROR", "DEBUG"].includes(candidate)) {
      tags.add(candidate);
    }
  }
  return Array.from(tags);
}

function buildEntry(level, args, now) {
  state.seq = (state.seq + 1) % 1_000_000_000;
  const time = timeStamp(now);
  const lvlUpper = level.toUpperCase();
  const message = args.map(formatArg).join(" ");
  const raw = `${time} [${lvlUpper}] ${message}`;

  return {
    id: `log_${state.seq}_${now.getTime()}`,
    seq: state.seq,
    time,
    iso: now.toISOString(),
    level: lvlUpper,
    message,
    raw,
    tags: extractTags(message),
  };
}

// M6 §3 — stamp the correlation fields onto an already-built ring entry.
// Applied by the CALLERS (the console.* wrapper and the shipper funnel),
// never from buildEntry: buildEntry is pure and M1's double-capture law owns
// the suppression window, so the stamp must not reshape that window's body.
// With NO live voyage the entry is returned untouched — absent fields stay
// absent rather than becoming a null the harbor could mistake for a
// measurement. The shipper's `entry?.x ?? null` decides the persisted column.
export function stampVoyageOnEntry(entry) {
  if (!entry) return entry;
  const voyage = getVoyage();
  if (!voyage) return entry;
  entry.reqId = voyage.reqId ?? null;
  entry.upstreamId = voyage.upstreamId ?? null;
  entry.provider = voyage.provider ?? null;
  return entry;
}

// r3 §9 — the suppression window belongs to the console.* wrapper below, not
// here: it must span BOTH the structured capture and the original write,
// because the stdout tap sees the originals' bytes. A window that closes
// after the capture but before the original write double-captures every
// console line into the raw ring (measured: 1 console.log -> 1 entry + 1 raw
// line). The wrapper calls appendLineInner directly while the window is up.
//
// M3 §2 — the ring-append body is now EXPORTED. The logshipper is the funnel
// (shipLog owns clamps, the control-char scrub and the SAB serialization), so
// this module must expose the ring half on its own: same buildEntry, same
// ring caps, same 80ms/50-line batching, same SSE frames. Zero visible change.

/** Build the structured entry (buildEntry owns seq/id/time/tags). */
export function makeConsoleEntry(level, args, now = new Date()) {
  return buildEntry(level, args, now);
}

/**
 * Append a structured console entry to the logs/entries rings, queue it for
 * the 80ms batcher, and emit. The one ring-append path — the logshipper's
 * funnel calls this, so rings and SSE behave exactly as they did before M3.
 *
 @param {{level:string, args:Array, time?:string, iso?:string, tags?:Array,
          message?:string}} spec  a prebuilt entry overrides the stamped parts,
          so the shipper does not stamp a second, divergent `time`.
 */
export function appendStructuredEntry(spec) {
  let entry;
  if (spec.time || spec.iso || spec.tags || typeof spec.message === "string") {
    // The shipper already holds the stamped fields — reuse them verbatim so
    // the durable row and the memory row describe the same instant.
    entry = spec.entry ?? {
      id: `log_${(state.seq = (state.seq + 1) % 1_000_000_000)}_${Date.parse(spec.iso) || Date.now()}`,
      seq: state.seq,
      time: spec.time,
      iso: spec.iso,
      level: String(spec.level || "LOG").toUpperCase(),
      message: spec.message,
      raw: `${spec.time} [${String(spec.level || "LOG").toUpperCase()}] ${spec.message}`,
      tags: spec.tags ?? [],
    };
  } else {
    entry = buildEntry(spec.level, spec.args, new Date());
  }

  state.logs.push(entry.raw);
  state.entries.push(entry);

  const maxLines = CONSOLE_LOG_CONFIG.maxLines;
  if (state.logs.length > maxLines) {
    state.logs = state.logs.slice(-maxLines);
  }
  if (state.entries.length > maxLines) {
    state.entries = state.entries.slice(-maxLines);
  }

  state.pendingLines.push(entry.raw);
  state.pendingEntries.push(entry);

  if (state.pendingLines.length >= MAX_BATCH_LINES) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    flushPendingLines();
  } else {
    scheduleFlush();
  }
  return entry;
}

/** The stamped path used by the console.* wrapper (the M1 suppression window
 *  wraps THIS call and the original write together). */
function appendLineInner(level, args) {
  return appendStructuredEntry({ level, args });
}

// ═══ M3 §2 — THE FUNNEL ═══
// The durable row is shipped from HERE, inside the capture and inside the M1
// suppression window, so logshipper is downstream of the ring and never
// re-enters it. The ring/SSE path is untouched; only the durable half is
// added, and it is added by calling the write door.
//
// THE CYCLE (logshipper/index.js imports appendStructuredEntry + appendRawLine
// back from here) is safe because every cross-call sits inside a function
// body and both sides are hoisted `export function` declarations. No
// cross-module binding is READ at module-eval time — that is the law.
function shipDurableConsole(entry) {
  try {
    shipConsoleLine({
      level: entry.level,
      message: entry.message,
      entry: stampVoyageOnEntry(entry),
    });
  } catch {
    // A shipping fault must never break the console. It drops with the rest of
    // the degraded path rather than taking the harbor down.
  }
}

function shipDurableContainer(entry, isStderr) {
  try {
    shipContainerLine({ entry, isStderr });
  } catch {
    // Same law as above.
  }
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      // r3 §9 — one suppression window spans capture + original write. The
      // tap reads this flag synchronously, and the tap is synchronous (a
      // write callback cannot interleave), so the flag cannot be seen down
      // by another console call in between. Every OTHER stdout write —
      // Next's banner, a child's relayed output — still captures normally.
      state.suppressStdoutTap = true;
      try {
        // M6 §3 — the correlation stamp, applied to the ring entry itself so
        // BOTH halves carry it: the ring entry the harbor renders live, and
        // the durable row shipConsoleLine forwards (logshipper/index.js reads
        // `entry?.reqId ?? null`). The window's SHAPE is untouched — the stamp
        // is a read of the live ALS store plus three field writes, all inside
        // the same synchronous try/finally M1 sealed.
        const entry = stampVoyageOnEntry(appendLineInner(level, args));
        // M3 §2: the durable row leaves from INSIDE the suppression window, so
        // the stdout tap still sees one console line as one structured entry
        // and zero raw lines (M1's law, unchanged).
        shipDurableConsole(entry);
        state.originals[level](...args);
      } finally {
        state.suppressStdoutTap = false;
      }
    };
  }

  patchStdoutTap();
  state.patched = true;
}


// ─── M6 §4 — the numeric-level path for logger.js ──────────────────────────
// §4's law is that a logger-emitted line carries its numeric level AT THE
// SOURCE, with no text classification to recover it. The wrapper above cannot
// do that: logger.error() prints through console.log, so the wrapper's
// `CONSOLE_LEVEL_NUM[level]` answers 20 and the ERROR→LOG misclassification
// §4 exists to cure survives — measured in the plan's own §0.
//
// THE SHAPE, and why it is this shape: the durable row leaves from the door
// with the caller's numeric level, while the ring + SSE path is fed by exactly
// the same appendLineInner the wrapper uses. So a logger line is still ONE
// ring entry and ZERO raw lines (M1's law, held by the same suppression
// window the wrapper opens), and it is still ONE durable row (M3's law: one
// append, one ship — this path deliberately does NOT call shipDurableConsole,
// which is what would have made it two).
//
// It must not re-derive the level from the console CHANNEL either: the
// channel is a terminal-output choice (logger.error has always printed via
// console.log), and treating it as the severity is the very conflation this
// function exists to undo.
export function emitLeveledConsole({ channel = "log", lvl = LOG_LEVELS.info, text }) {
  const args = [text];
  // The ring's own vocabulary is the console channel, unchanged — the live tail
  // and its filters keep behaving exactly as they did before M6.
  state.suppressStdoutTap = true;
  try {
    const entry = stampVoyageOnEntry(appendLineInner(channel, args));
    try {
      // The numeric level is the caller's, straight through. Same correlation
      // fields the console path forwards, read off the stamped entry.
      shipLog({
        lvl,
        stream: "console",
        reqId: entry?.reqId ?? null,
        upstreamId: entry?.upstreamId ?? null,
        provider: entry?.provider ?? null,
        tag: entry?.tags?.[0] ?? null,
        msg: entry?.message ?? text,
        meta: { level: entry?.level ?? String(channel).toUpperCase(), time: entry?.time ?? null, tags: entry?.tags ?? [] },
      });
    } catch {
      // A shipping fault must never break the logger — same law as above.
    }
    const original = state.originals[channel];
    (original ?? console[channel])(...args);
  } finally {
    state.suppressStdoutTap = false;
  }
}

// -- The Container Stream (the Dozzle shore) ---------------------------------
// Taps process.stdout/stderr writes directly, line-buffers them, and keeps a
// dedicated rawEntries ring: the part of what `docker logs` sees that the
// console.* capture misses -- the MITM child's relayed output, dependency
// prints, crash stacks, framework warnings. The tap installs at boot
// (instrumentation.js) and again at layout module scope, so it starts with the
// first request and never holds what the process printed before it. Level is
// inferred: stderr -> ERROR, stdout -> LOG, with keyword sharpening
// (tracebacks, "warn") so the harbor can filter.
const RAW_MAX = 2000;
const STDOUT_TRACEBACK_RE = new RegExp("^\\s*at\\s|\\w+Error:|Traceback|DeprecationWarning|ExperimentalWarning", "i");
const STDOUT_WARN_RE = new RegExp("\\bwarn(ing)?\\b", "i");

/** Exported for the logshipper funnel — the raw ring keeps its classification. */
export function classifyRawLine(line, isStderr) {
  if (STDOUT_TRACEBACK_RE.test(line)) return "ERROR";
  if (STDOUT_WARN_RE.test(line)) return "WARN";
  return isStderr ? "ERROR" : "LOG";
}

/**
 * Append one already-built container entry to the raw ring (M3 §2 export).
 *
 * The raw ring KEEPS its raw ANSI by design — the plan explicitly exempts the
 * legacy container view, which is labeled raw. The control-char scrub is
 * applied to the PERSISTED serialization and the structured entries, never
 * here. This is the one place the two halves deliberately differ.
 */
export function appendRawLine(entry) {
  state.rawEntries.push(entry);
  if (state.rawEntries.length > RAW_MAX) {
    state.rawEntries = state.rawEntries.slice(-RAW_MAX);
  }
  state.pendingRawEntries.push(entry);
  if (state.pendingRawEntries.length >= MAX_BATCH_LINES) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    flushPendingLines();
  } else {
    scheduleFlush();
  }
  return entry;
}

function pushRawLine(text, isStderr) {
  const now = new Date();
  state.seq = (state.seq + 1) % 1_000_000_000;
  const clean = stripAnsi(String(text)).replace(/\r$/, "");
  if (!clean.trim()) return;
  const entry = {
    id: `raw_${state.seq}_${now.getTime()}`,
    seq: state.seq,
    time: timeStamp(now),
    iso: now.toISOString(),
    level: classifyRawLine(clean, isStderr),
    stream: isStderr ? "stderr" : "stdout",
    message: clean,
    tags: extractTags(clean),
    raw: clean,
  };
  // M6 §3 — a raw line is FOREIGN by definition once §9's suppression holds:
  // it is a write that did NOT pass through console.*, so it has no voyage to
  // read. stampVoyageOnEntry therefore leaves it untouched and its durable row
  // carries an honest NULL. A raw line written from INSIDE a live voyage (the
  // MITM child's relayed output cannot be, but an in-process write can) is
  // stamped — never guessed from a tag.
  stampVoyageOnEntry(entry);
  appendRawLine(entry);
  // M3 §2: the container stream's durable twin. The RAW ring above keeps its
  // ANSI by design (the plan exempts the legacy raw view); shipLog applies the
  // control-char scrub to what is PERSISTED.
  shipDurableContainer(entry, isStderr);
  return entry;
}

function patchStdoutTap() {
  if (state.stdoutPatched) return;
  state.originalStdoutWrite = process.stdout.write.bind(process.stdout);
  state.originalStderrWrite = process.stderr.write.bind(process.stderr);
  const rest = { out: "", err: "" };
  const tap = (origWrite, isStderr, key) => (chunk, encoding, cb) => {
    const text = rest[key] + String(chunk);
    const lines = text.split("\n");
    rest[key] = lines.pop() || "";
    if (!state.suppressStdoutTap) {
      for (const line of lines) pushRawLine(line, isStderr);
    }
    return origWrite(chunk, encoding, cb);
  };
  process.stdout.write = tap(state.originalStdoutWrite, false, "out");
  process.stderr.write = tap(state.originalStderrWrite, true, "err");
  state.stdoutPatched = true;
}

export function getConsoleLogs({ level = "all", query = "", tag = "all", limit = null, structured = false } = {}) {
  if (structured) {
    let res = state.entries;
    if (level && level !== "all") {
      const targetLvl = level.toUpperCase();
      res = res.filter((e) => e.level === targetLvl);
    }
    if (tag && tag !== "all") {
      const targetTag = tag.toUpperCase();
      res = res.filter((e) => e.tags.includes(targetTag));
    }
    if (query) {
      const q = query.toLowerCase();
      res = res.filter((e) => e.message.toLowerCase().includes(q) || e.time.includes(q));
    }
    if (limit && Number.isInteger(limit) && limit > 0) {
      res = res.slice(-limit);
    }
    return res;
  }

  // Raw string logs query
  let res = state.logs;
  if (level && level !== "all") {
    const targetLvl = `[${level.toUpperCase()}]`;
    res = res.filter((l) => l.includes(targetLvl));
  }
  if (tag && tag !== "all") {
    const targetTag = `[${tag.toUpperCase()}]`;
    res = res.filter((l) => l.toUpperCase().includes(targetTag));
  }
  if (query) {
    const q = query.toLowerCase();
    res = res.filter((l) => l.toLowerCase().includes(q));
  }
  if (limit && Number.isInteger(limit) && limit > 0) {
    res = res.slice(-limit);
  }
  return res;
}

export function getConsoleLogStats() {
  const counts = { total: state.entries.length, LOG: 0, INFO: 0, WARN: 0, ERROR: 0, DEBUG: 0 };
  const tagCounts = {};
  for (const e of state.entries) {
    if (counts[e.level] !== undefined) counts[e.level]++;
    for (const t of e.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }
  return {
    counts,
    tagCounts,
    maxLines: CONSOLE_LOG_CONFIG.maxLines,
  };
}

export function clearConsoleLogs() {
  state.logs = [];
  state.entries = [];
  state.rawEntries = [];
  state.emitter.emit("clear");
}

export function getRawLogs({ query = "", level = "all", limit = null } = {}) {
  let res = state.rawEntries;
  if (level && level !== "all") {
    const target = level.toUpperCase();
    res = res.filter((e) => e.level === target);
  }
  if (query) {
    const q = query.toLowerCase();
    res = res.filter((e) => e.message.toLowerCase().includes(q) || e.time.includes(q));
  }
  if (limit && Number.isInteger(limit) && limit > 0) {
    res = res.slice(-limit);
  }
  return res;
}

export function getConsoleEmitter() {
  return state.emitter;
}
