import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

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

function appendLine(level, args) {
  state.suppressStdoutTap = true;
  try {
    appendLineInner(level, args);
  } finally {
    state.suppressStdoutTap = false;
  }
}

function appendLineInner(level, args) {
  const entry = buildEntry(level, args, new Date());

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
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      appendLine(level, args);
      state.originals[level](...args);
    };
  }

  patchStdoutTap();
  state.patched = true;
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

function classifyRawLine(line, isStderr) {
  if (STDOUT_TRACEBACK_RE.test(line)) return "ERROR";
  if (STDOUT_WARN_RE.test(line)) return "WARN";
  return isStderr ? "ERROR" : "LOG";
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
