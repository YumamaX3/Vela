/**
 * index.js — `shipLog`, the SINGLE WRITE DOOR (sealed plan r3 §2).
 *
 * One call shape for every durable log line in the harbor: the console funnel
 * (consoleLogBuffer), the request ledger, and every future caller pass through
 * `shipLog`. Everything policy-shaped — the level enum, the stream vocabulary,
 * the clamps, the control-char scrub, the hold, the transport choice — lives
 * here and NOWHERE ELSE, so a row's legality is decided in exactly one place.
 *
 * POSTURES (§2's posture law), named once and read everywhere:
 *   - transport 'worker'   — a real worker_threads drainer owns logEvents.
 *   - transport 'degraded' — driver is sql.js, so no worker: batch in memory,
 *                            persist ≤ once per 5s when non-empty (R4 = enqueue-only).
 *   - transport 'disabled' — VELA_DB_MODE=mysql: there is no SQLite primary to
 *                            own the table. Loud, never silent.
 *
 * M4 ADDED (§2.1): `shutdownLogshipper()` — the bounded-2s handshake — plus the
 * beforeExit belt, the three hard-kill window constants R3 asks stats to name,
 * and the VELA_LOG_DRIVER pin reported through `driverPin`.
 */

// consoleLogBuffer calls US, not the other way round: it owns the rings and
// hands us an already-built entry. The cycle that makes this module part of the
// console's import graph is therefore one-directional at call time, and the
// two append helpers it exports exist for other consumers, not for this file.
import { setCheckpointOwner, workerOwnsCheckpointing } from "../db/checkpointOwner.js";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The worker's own shore, resolved ONCE from THIS module's file. Webpack
// rewrites `import.meta.url` in the server bundle (it became a static-media
// asset URL, so `new Worker(that)` failed its filename validation and the
// whole shipper silently never booted in production). A real filesystem path
// is the one thing no bundler rewrites.

import { enqueue, createRing, ringStats } from "./writer.js";
import { redactEntry } from "./redact.js";
function thisDir() {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    // A bundler that rewrites import.meta.url to something fileURLToPath
    // rejects: fall back to this repo's own layout, which is the only
    // place the worker file can ever live.
    return path.join(process.cwd(), "src", "lib", "logshipper");
  }
}
const __dirname = thisDir();

/** The numeric enum of §1. */
export const LOG_LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, fatal: 50 });

/** console.* name → numeric level (the wrapper's own mapping). */
export const CONSOLE_LEVEL_NUM = Object.freeze({ debug: 10, log: 20, info: 20, warn: 30, error: 40 });

/** The five declared values of §1's enum — the only ones a row may carry. */
const VALID_LEVELS = new Set(Object.values(LOG_LEVELS));

export const MSG_MAX_CHARS = 8_000;
export const META_MAX_CHARS = 16_000;

/** Retention until M8 wires settings (§2): age-based, 14 days. */
export const DEFAULT_RETENTION = Object.freeze({ mode: "age", days: 14 });

/** Degraded-mode cadence: at most one persist per 5s, only when non-empty. */
export const DEGRADED_PERSIST_INTERVAL_MS = 5_000;
/** Degraded-mode hard cap: 50 MB total, prune-oldest on breach. */
export const DEGRADED_MAX_BYTES = 50 * 1024 * 1024;

// ─── The hard-kill windows (§2 / R3) ───────────────────────────────────────
// R3 states the durability bound as NUMBERS, not as a promise: a hard kill
// (SIGKILL, power loss) loses the accepted-but-unflushed window. Two windows
// exist, one per posture, and both are named here so /api/logs/stats can
// surface them instead of the harbor implying an unbounded promise.

/** §2.1: main waits this long for the worker's `stopped` ack, then exits. */
export const SHUTDOWN_FLUSH_WINDOW_MS = 2_000;
/**
 * The worker's batch interval — part of the ≈2.5s worst case R3 measures
 * (drain bound 2s + one batch interval). Named from the WORKER's constant,
 * not re-typed here: a second copy of 250 is how the ledger starts lying.
 */
export const WORKER_FLUSH_CADENCE_MS = 250;
/** Degraded posture: §2's ≤5s lag (one persist per 5s when non-empty). */
export const DEGRADED_FLUSH_LAG_MS = DEGRADED_PERSIST_INTERVAL_MS;

// ─── (b) The control-char scrub ───────────────────────────────────────────
// SGR is the existing ANSI_RE from consoleLogBuffer, restated here so the
// persisted path owns its own law. The extra arms matter because an upstream
// error string is not necessarily well-behaved: CSI non-SGR (cursor moves,
// erase), OSC (title/hyperlink — terminated by BEL or ST) and DCS are all
// live in a raw upstream payload, and a single stray CSI can repaint an
// operator's terminal straight out of persisted text.
const SGR_RE = /\x1b\[[0-9;]*m/g;
const CSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const DCS_RE = /\x1bP[^\x1b]*(?:\x1b\\)?/g;
const ESC_RE = /\x1b[ -/]*[0-~]/g;
// Every remaining C0 control. Tab survives (it is ordinary spacing); the rest go.
const C0_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Make a string print-safe for persistence. Newlines become spaces so one log
 * row stays one line; no marker characters are injected.
 */
export function scrubForPersistence(input) {
  if (input === null || input === undefined) return "";
  let s = String(input);
  // OSC before CSI: an OSC body may contain an ESC-terminated sequence, and
  // stripping CSI first would leave the OSC arm matching a mutilated string.
  s = s.replace(OSC_RE, "").replace(DCS_RE, "").replace(SGR_RE, "").replace(CSI_RE, "");
  s = s.replace(ESC_RE, "");
  s = s.replace(C0_RE, "");
  return s.replace(/\r\n|\r|\n/g, " ");
}

/** Scrub, then clamp — the order r3 fixes. Redaction happens upstream (§5). */
function scrubAndClamp(value, max) {
  const scrubbed = scrubForPersistence(value);
  if (scrubbed.length <= max) return { value: scrubbed, truncated: false };
  return { value: scrubbed.slice(0, max), truncated: true };
}

// ─── The harbor's live state ───────────────────────────────────────────────
const state = {
  transport: "worker", // 'worker' | 'degraded' | 'disabled'
  posture: "sqlite", // 'sqlite' | 'mirror' | 'mysql'
  driver: null,
  driverPin: null, // M4: the VELA_LOG_DRIVER pin, or null when following the chain
  worker: null,
  ring: null,
  degraded: false,
  droppedCount: 0, // degraded-mode pruning only; the ring counts its own
  rejectedMessages: 0,
  ready: false,
  bootError: null,
  degradedBuffer: [],
  degradedBytes: 0,
  degradedTimer: null,
  hold: false,
  held: [],
  booted: false,
  pin: null, // M4: { requested, honoured } as reported by the worker's `ready`
  shutdownPromise: null, // M4 §2.1: the ONE shared handshake (idempotency)
};

function currentPosture() {
  const mode = (process.env.VELA_DB_MODE || "sqlite").toLowerCase().trim();
  return mode === "mirror" ? "mirror" : mode === "mysql" ? "mysql" : "sqlite";
}

// ─── The one door ──────────────────────────────────────────────────────────

/**
 * Ship one durable log line.
 *
 * @param {{lvl:number, stream:string, reqId?:string, upstreamId?:string,
 *          provider?:string, tag?:string, msg:string, meta?:object}} entry
 * @returns {{accepted:boolean, truncMsg:boolean, truncMeta:boolean, held?:boolean}}
 */
export function shipLog(entry = {}) {
  // The level is an ENUM, not a number: `lvl` is declared INTEGER NOT NULL and
  // §1 names exactly five values. A caller passing 99 (or a string, or NaN)
  // must degrade to `info` rather than ride out and poison the ledger's
  // vocabulary — the one place a filter would then silently miss.
  const lvl = VALID_LEVELS.has(Number(entry.lvl)) ? Number(entry.lvl) : LOG_LEVELS.info;
  const stream = entry.stream === "container" || entry.stream === "request" ? entry.stream : "console";

  // §5 order law: REDACT → CLAMP. The shape scrub runs over the raw msg/meta
  // BEFORE any truncation, so a secret straddling the clamp boundary is still
  // caught whole — a clamp can never sever what the scrub has not yet seen.
  const { msg: rawMsg, meta: rawMeta } = redactEntry({ msg: entry.msg ?? "", meta: entry.meta });
  const msg = scrubAndClamp(rawMsg ?? "", MSG_MAX_CHARS);
  let metaValue = null;
  let truncMeta = false;
  if (rawMeta !== null && rawMeta !== undefined) {
    let json;
    if (typeof rawMeta === "string") {
      json = rawMeta;
    } else {
      try {
        json = JSON.stringify(rawMeta);
      } catch {
        json = String(rawMeta);
      }
    }
    const clamped = scrubAndClamp(json, META_MAX_CHARS);
    metaValue = clamped.value;
    truncMeta = clamped.truncated;
  }

  const row = {
    ts: Date.now(),
    lvl,
    stream,
    reqId: entry.reqId ?? null,
    upstreamId: entry.upstreamId ?? null,
    provider: entry.provider ?? null,
    tag: entry.tag ?? null,
    msg: msg.value,
    meta: metaValue,
    truncMsg: msg.truncated,
    truncMeta,
  };

  // The hold exists for §6's clear ordering: while held, lines buffer here and
  // are released as POST-clear evidence once the settle completes.
  if (state.hold) {
    state.held.push(row);
    return { accepted: true, truncMsg: row.truncMsg, truncMeta: row.truncMeta, held: true };
  }

  dispatch(row);
  return { accepted: true, truncMsg: row.truncMsg, truncMeta: row.truncMeta };
}

function dispatch(row) {
  if (state.transport === "disabled") return; // mysql posture — loud, not silent
  if (state.transport === "degraded") {
    enqueueDegraded(row);
    return;
  }
  if (!state.ring) return;
  // The ring counts its own evictions; a refused oversize frame is counted
  // inside enqueue() against the same slot, so nothing is double-counted.
  enqueue(state.ring, JSON.stringify(row));
}

// ─── Degraded mode (sql.js) ────────────────────────────────────────────────
// (a) batches in memory only, (b) persists at most once per 5s and only when
// non-empty, (c) hard 50 MB cap with prune-oldest on breach, (d) stats carry
// degraded + r4 "enqueue-only". The persist runs on the MAIN thread through the
// real adapter with bound params in ONE transaction — the O(file) pause is the
// accepted debt (sql.js persist = db.export() + whole-file write), never faked.
function enqueueDegraded(row) {
  const json = JSON.stringify(row);
  state.degradedBuffer.push(row);
  state.degradedBytes += json.length;
  while (state.degradedBytes > DEGRADED_MAX_BYTES && state.degradedBuffer.length > 1) {
    const evicted = state.degradedBuffer.shift();
    state.degradedBytes -= JSON.stringify(evicted).length;
    state.droppedCount += 1;
  }
  scheduleDegradedPersist();
}

function scheduleDegradedPersist() {
  if (state.degradedTimer) return; // an armed timer IS the cadence
  state.degradedTimer = setTimeout(() => {
    state.degradedTimer = null;
    void persistDegraded();
  }, DEGRADED_PERSIST_INTERVAL_MS);
  state.degradedTimer.unref?.();
}

/** (b) persists ONLY when non-empty. Returns rows written. */
export async function persistDegraded() {
  if (state.transport !== "degraded") return 0;
  if (state.degradedBuffer.length === 0) return 0; // an empty persist is skipped
  const batch = state.degradedBuffer.splice(0, state.degradedBuffer.length);
  const bytes = state.degradedBytes;
  state.degradedBytes = 0;
  try {
    const { getLogStore } = await import("../db/repos/sqlite/logStore.js");
    const store = await getLogStore();
    return store.insertBatch(batch) || 0;
  } catch (e) {
    // Refused to persist: return the rows to the buffer (newest kept) so the
    // next cadence retries, rather than losing them silently.
    state.degradedBuffer.unshift(...batch);
    state.degradedBytes += bytes;
    state.bootError = String(e?.message ?? e);
    return 0;
  }
}

// ─── Boot ───────────────────────────────────────────────────────────────────

/** Posture law: mysql disables durable logs LOUDLY, without booting a worker. */
function initMysqlPosture() {
  state.posture = "mysql";
  state.transport = "disabled";
  state.degraded = false;
  state.booted = true;
  console.warn(
    "[logshipper] VELA_DB_MODE=mysql — durable logEvents is DISABLED (no SQLite primary owns the table). " +
      "The memory rings and SSE continue; the harbor will show an honest empty state."
  );
}

/** Degraded posture: the driver is sql.js, so the worker is bypassed. */
function initDegraded(driverName) {
  state.posture = currentPosture();
  state.transport = "degraded";
  state.driver = driverName || "sql.js";
  state.degraded = true;
  state.booted = true;
  console.warn(
    "[logshipper] driver sql.js — the worker is bypassed. Degraded: batching in memory, " +
      `one persist per ${DEGRADED_PERSIST_INTERVAL_MS / 1000}s when non-empty, ` +
      `${DEGRADED_MAX_BYTES / (1024 * 1024)} MB cap. R4 holds for the enqueue only; ` +
      "the periodic persist pause is O(file) and real."
  );
}

/**
 * M4 — `VELA_LOG_DRIVER` ON THE MAIN THREAD pins the DRIVER POSTURE.
 *
 * THIS IS NOT THE SAME PIN AS workerDriver.js's. Two pins, two subjects:
 *   - index.js (here) answers "MAY A WORKER EXIST AT ALL?" and honours exactly
 *     ONE value: `sql.js`, meaning "do not spawn a worker, run degraded".
 *   - workerDriver.js answers "WHICH HANDLE DOES THE WORKER OPEN?" and honours
 *     any known driver name.
 * They cannot disagree: `sql.js` here wins before a worker is ever born, and
 * every other value passes through to the worker, which opens it.
 *
 * An unknown or empty value NEVER crashes and NEVER forces degraded posture: it
 * follows the main chain exactly as if unset. Only the exact string `sql.js`
 * (case-insensitive, trimmed) is honoured HERE. This is deliberately
 * conservative — widening the main-thread side to "any recognized driver" would
 * let a typo silently change posture without anyone asking for it.
 *
 * @returns {string|null} the pinned driver name, or null when following the chain
 */
export function resolveLogDriverPin(raw = process.env.VELA_LOG_DRIVER) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  return value === "sql.js" ? "sql.js" : null;
}

/** Bridge a worker notice into the harbor's own vocabulary. */
function bridgeWorkerMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "ready":
      state.ready = true;
      state.driver = msg.driver ?? state.driver;
      // M4: the worker reports whether the DECLARED pin is the OPENED driver.
      // Both facts are kept: a requested-but-unhonoured pin is a posture the
      // operator must be able to SEE, not one the harbor rounds away to null.
      if (msg.pin) state.pin = msg.pin;
      break;
    case "flushed":
      state.lastFlushed = { n: Number(msg.n) || 0, droppedSinceLast: Number(msg.droppedSinceLast) || 0 };
      break;
    case "rejected":
      state.rejectedMessages = Number(msg.count) || state.rejectedMessages + 1;
      break;
    case "error":
      state.bootError = String(msg.message ?? "worker error");
      if (msg.fatal) console.warn(`[logshipper] worker failed: ${msg.message}`);
      break;
    default:
      break; // the worker is the closed door; main is forgiving, not leaky
  }
}

/**
 * Probe which driver the chain WOULD pick, WITHOUT opening the main adapter —
 * logshipper must not be the thing that forces the main isolate into a
 * database. Mirrors the main chain's order for this runtime.
 *
 * VELA_DB_DRIVER IS HONOURED FIRST, and it must be: the pin is how the matrix
 * forces the fragile corners (Storage Covenant A4), and probing availability
 * instead would silently answer "better-sqlite3" on a machine pinned to
 * sql.js — booting a worker against a posture nobody asked for.
 */
export async function probeDriver() {
  const pinned = (process.env.VELA_DB_DRIVER || "").toLowerCase().trim();
  if (pinned) return pinned;
  if (process.versions.bun) {
    // Built under a variable specifier on purpose: a literal
    // `import("bun:sqlite")` is a static-analyzable reference to a builtin no
    // Node bundler knows, and both Vite ("Cannot bundle Node.js built-in
    // bun:sqlite") and Next's client bundler refuse it at BUILD time even
    // inside a never-taken branch — measured against log-harbor.test.jsx,
    // which pulls this module in through the console funnel. Under Bun the
    // specifier resolves normally.
    const BUN_SQLITE = "bun:sqlite";
    try {
      // Two ignore-comments, one for each bundler in the house: `@vite-ignore`
      // for vitest's Vite transform, `webpackIgnore` for `next build`'s webpack
      // (which otherwise emits "Critical dependency: the request of a
      // dependency is an expression" and builds a context module for a
      // specifier that must resolve at runtime). Same pattern as
      // src/lib/pxpipe/loader.js. Under Bun the specifier resolves normally;
      // on Node this branch is never entered (process.versions.bun is falsy).
      await import(/* @vite-ignore */ /* webpackIgnore: true */ BUN_SQLITE);
      return "bun:sqlite";
    } catch {}
  }
  try {
    await import("better-sqlite3");
    return "better-sqlite3";
  } catch {}
  try {
    const [maj, min] = process.versions.node.split(".").map(Number);
    if (maj > 22 || (maj === 22 && min >= 5)) {
      await import("node:sqlite");
      return "node:sqlite";
    }
  } catch {}
  return "sql.js";
}

/**
 * Boot the shipper. Safe to call repeatedly — only the first call boots.
 *
 * @param {{degraded?:boolean, driverName?:string, workerPath?:string}} [opts]
 *        `degraded` forces the sql.js posture (the degraded suite's seam);
 *        `workerPath` lets a test point at a real Worker file on disk.
 */
export async function initLogshipper(opts = {}) {
  if (state.booted) return state;
  state.posture = currentPosture();
  if (state.posture === "mysql") {
    initMysqlPosture();
    installBeforeExitBelt();
    return state;
  }

  // M4: the pin chooses the POSTURE before any worker spawns. `driverName` (an
  // explicit caller override, used by the test harness) still wins over the pin
  // so a suite can drive either posture directly without touching env.
  const pinned = resolveLogDriverPin();
  state.driverPin = pinned;

  const driverName = opts.driverName ?? (pinned ?? (opts.degraded ? "sql.js" : await probeDriver()));

  if (opts.degraded || driverName === "sql.js") {
    initDegraded(driverName);
    // Degraded mode still needs the table to exist for its persist.
    try {
      const { getLogStore } = await import("../db/repos/sqlite/logStore.js");
      const store = await getLogStore();
      store.ensureTable();
    } catch (e) {
      state.bootError = String(e?.message ?? e);
    }
    installBeforeExitBelt();
    return state;
  }

  // WORKER POSTURE.
  const ring = createRing();
  state.ring = ring;
  state.driver = driverName;

  // OWNERSHIP: flipped BEFORE the worker spawns and before any main handle is
  // created, so a handle born later is born opted out of the TRUNCATE timer.
  setCheckpointOwner("worker");

  const { Worker } = await import("worker_threads");
  const workerUrl = pathToFileURL(
    opts.workerPath ? path.resolve(opts.workerPath) : path.join(__dirname, "worker.js")
  );
  const worker = new Worker(workerUrl, {
    workerData: { sab: ring.sab, ringBytes: ring.capacityBytes },
  });
  state.worker = worker;
  state.transport = "worker";
  state.booted = true;
  installBeforeExitBelt();
  worker.on("message", bridgeWorkerMessage);
  worker.on("error", (e) => {
    state.bootError = String(e?.message ?? e);
    console.warn(`[logshipper] worker error: ${e?.message ?? e}`);
  });
  return state;
}

// ─── The consoleLogBuffer funnel half ──────────────────────────────────────
// consoleLogBuffer is the RING OWNER: it stamps the entry, appends it to its
// rings and queues the SSE batch. These two functions therefore DO NOT append —
// they carry the ALREADY-BUILT entry across the door and ship its durable
// twin. Re-appending here is exactly what double-captured every raw line
// (measured: one stdout write became two raw entries, breaking M1's and the
// harbor's stream filter). The seam is one append, one ship.

/**
 * The durable twin of a console.* entry the caller has already captured.
 * @param {{level:string, message:string, entry?:object}} spec
 */
export function shipConsoleLine({ level, message, entry }) {
  const lvl = CONSOLE_LEVEL_NUM[level] ?? LOG_LEVELS.info;
  shipLog({
    lvl,
    stream: "console",
    // M6 §3 voyage stamp, forwarded verbatim off the caller's ring entry. The
    // corridor is honest null: a raw stdout write from a child process carries
    // no ALS context, so `entry?.reqId ?? null` yields the truthful absence.
    reqId: entry?.reqId ?? null,
    upstreamId: entry?.upstreamId ?? null,
    provider: entry?.provider ?? null,
    tag: entry?.tags?.[0] ?? null,
    msg: message,
    meta: {
      level: entry?.level ?? String(level).toUpperCase(),
      time: entry?.time ?? null,
      tags: entry?.tags ?? [],
    },
  });
}

/**
 * The durable twin of a raw container entry the caller has already appended.
 * The RAW ring keeps its ANSI by design (the plan exempts the legacy raw view);
 * shipLog applies the control-char scrub to what is PERSISTED.
 */
export function shipContainerLine({ entry, isStderr }) {
  shipLog({
    lvl: containerLevelNum(entry.level),
    stream: "container",
    // A container line is FOREIGN by definition — it is a child process's
    // output with no harbor request context. These stay null even when the
    // entry happens to carry a topic tag; forging attribution is worse than an
    // honest absence.
    reqId: null,
    upstreamId: null,
    provider: null,
    tag: entry.tags?.[0] ?? null,
    msg: entry.message,
    meta: { level: entry.level, channel: isStderr ? "stderr" : "stdout", time: entry.time },
  });
}


/** The raw ring's LOG/INFO/WARN/ERROR vocabulary → the numeric enum. */
export function containerLevelNum(level) {
  if (level === "ERROR") return LOG_LEVELS.error;
  if (level === "WARN") return LOG_LEVELS.warn;
  return LOG_LEVELS.info;
}

// ─── Stats (M7's /api/logs/stats reads this) ───────────────────────────────

export function getLogshipperStats() {
  const base = {
    transport: state.transport,
    posture: state.posture,
    degraded: state.degraded,
    r4: state.degraded ? "enqueue-only" : "enqueue-and-drain",
    droppedCount: state.droppedCount + (state.ring ? ringStats(state.ring).droppedCount : 0),
    rejectedMessages: state.rejectedMessages,
    driver: state.driver,
    // M4: the hard-kill windows R3 asks to be NAMED, not implied. Surfaced on
    // every posture so /api/logs/stats can render the durability bound without
    // recomputing it from constants the harbor cannot see.
    shutdownFlushWindowMs: SHUTDOWN_FLUSH_WINDOW_MS,
    workerFlushCadenceMs: state.transport === "worker" ? WORKER_FLUSH_CADENCE_MS : null,
    degradedFlushLagMs: state.transport === "degraded" ? DEGRADED_FLUSH_LAG_MS : null,
    held: state.hold,
    bootError: state.bootError,
    lastFlushed: state.lastFlushed ?? null,
  };
  // The pin's honesty ledger: what was DECLARED vs what the worker OPENED.
  if (state.driverPin) base.driverPin = state.driverPin;
  if (state.pin) base.pin = state.pin;
  if (state.posture === "mysql") {
    base.twin = "not-applicable"; // there is no SQLite primary at all
    base.ring = null;
    return base;
  }
  if (state.posture === "mirror") {
    // ACCEPTED divergence, SURFACED: worker writes sit outside the main isolate
    // so withOutboxCapture cannot wrap them — logEvents is PRIMARY-ONLY and the
    // MariaDB twin never receives log rows.
    base.twin = "not-mirrored";
  }
  if (state.transport === "degraded") {
    base.ring = {
      usedBytes: state.degradedBytes,
      capacityBytes: DEGRADED_MAX_BYTES,
      fillRatio: Number((state.degradedBytes / DEGRADED_MAX_BYTES).toFixed(4)),
      pendingFrames: state.degradedBuffer.length,
      droppedCount: state.droppedCount,
      enqueuedTotal: null,
      drainedTotal: null,
    };
    return base;
  }
  base.ring = state.ring ? ringStats(state.ring) : null;
  base.checkpointOwner = workerOwnsCheckpointing() ? "worker" : "main";
  return base;
}

// ─── Control doors (M7 owns the full ordering; M3 ships the mechanism) ──────

/** Tell the worker to drain now. Resolves with its `flushed` notice. */
export function flushLogshipper() {
  return request({ type: "flush", data: { seq: Date.now() }, reply: "flushed" });
}

/** Tell the worker to DELETE. Resolves with `{deleted}`. */
export function clearPersistedLogs() {
  return request({ type: "clear", data: { seq: Date.now() }, reply: "cleared" });
}

/** Apply a retention posture. Only `mode`/`days`/`rows` are ever read. */
export function applyLogRetention(retention = {}) {
  const data = {};
  if (typeof retention.mode === "string") data.mode = retention.mode;
  if (typeof retention.days === "number") data.days = retention.days;
  if (typeof retention.rows === "number") data.rows = retention.rows;
  return request({ type: "retention", data, reply: "retention-applied" });
}

/** Begin the §6 hold — new lines buffer as post-clear evidence. */
export function holdLogshipper() {
  state.hold = true;
  return true;
}

/** Release the hold: held lines are dispatched as post-clear evidence. */
export function releaseLogshipper() {
  state.hold = false;
  const rows = state.held.splice(0, state.held.length);
  for (const row of rows) dispatch(row);
  return rows.length;
}

/** Send one allow-listed message and await its named reply. */
function request({ type, data, reply }) {
  const worker = state.worker;
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onMessage = (m) => {
      if (m?.type !== reply) return;
      worker.off("message", onMessage);
      resolve(m);
    };
    worker.on("message", onMessage);
    worker.postMessage({ type, data });
  });
}

/**
 * §2.1 THE SHUTDOWN HANDSHAKE (M4). Contract, in four laws:
 *
 *   1. IT NEVER REJECTS. Every failure path resolves — a wedged worker, a
 *      closed port, a throw inside the handler, a not-yet-booted shipper. The
 *      drain path calls this immediately before `process.exit(0)`; a rejected
 *      promise there would strand the process and turn a bounded 10s drain
 *      into an unbounded hang.
 *   2. IT IS BOUNDED. `SHUTDOWN_FLUSH_WINDOW_MS` (2s) is a ceiling, not an
 *      estimate. On timeout we resolve anyway and let the caller exit — the
 *      lost lines are the accepted cost, R3's "hard-kill window", named.
 *   3. IT IS IDEMPOTENT. Docker sends SIGTERM twice on a slow stop; a second
 *      call must not re-post `shutdown` to a worker that is already gone, and
 *      must not hang. One in-flight promise is shared by all callers.
 *   4. IT IS POSTURE-AWARE. Worker → handshake. Degraded → flush the buffer
 *      once, best-effort, bounded. Disabled (mysql) → resolve immediately.
 *
 * @returns {Promise<{posture:'worker'|'degraded'|'disabled', acked:boolean,
 *                    boundMs:number, elapsedMs:number, rows?:number}>}
 *          `acked:false` means the worker never answered inside the window —
 *          the honest verdict, NOT an exception.
 */
// NOT `async`: an async function wraps its return value in a FRESH promise, so
// two callers would each hold a different promise object wrapping the same
// work. Returning the shared one directly is what makes law 3's "one in-flight
// handshake" literally true — the identity is observable, not merely inferred.
export function shutdownLogshipper() {
  const startedAt = Date.now();


  // Law 3: one handshake, shared. A second caller awaits the FIRST promise
  // rather than starting a rival one against a worker that is already draining.
  if (state.shutdownPromise) return state.shutdownPromise;

  state.shutdownPromise = (async () => {
    // Never booted → nothing was ever accepted into a ring, so nothing is owed.
    if (!state.booted) {
      return { posture: "disabled", acked: false, boundMs: SHUTDOWN_FLUSH_WINDOW_MS, elapsedMs: 0 };
    }

    // Posture 3: mysql disables durable logs LOUDLY (§2 posture law). There is
    // no worker and no buffer, so the handshake is a no-op that must still be
    // SAFE TO CALL — the drain calls it unconditionally.
    if (state.transport === "disabled") {
      return { posture: "disabled", acked: false, boundMs: SHUTDOWN_FLUSH_WINDOW_MS, elapsedMs: Date.now() - startedAt };
    }

    // Posture 2: degraded. There is no worker to ack; the accepted rows sit in
    // `degradedBuffer` and §2 says a graceful shutdown flushes them once. This
    // is the O(file) sql.js persist — REAL, never faked, and bounded by the same
    // window because a wedged adapter must not strand the drain either.
    if (state.transport === "degraded") {
      const flushed = await bounded(persistDegraded(), SHUTDOWN_FLUSH_WINDOW_MS, null);
      if (state.degradedTimer) {
        clearTimeout(state.degradedTimer);
        state.degradedTimer = null;
      }
      return {
        posture: "degraded",
        acked: flushed !== null,
        boundMs: SHUTDOWN_FLUSH_WINDOW_MS,
        elapsedMs: Date.now() - startedAt,
        rows: flushed,
      };
    }

    // Posture 1: worker. 'shutdown' is already on the worker's CLOSED
    // allow-list with zero fields (worker.js ALLOWED_MESSAGES) — this posts the
    // schema as declared, never a spread.
    const worker = state.worker;
    if (!worker) {
      // Booted as worker posture but the handle is already gone (a previous
      // handshake took it). Resolve honestly rather than re-posting.
      return { posture: "worker", acked: false, boundMs: SHUTDOWN_FLUSH_WINDOW_MS, elapsedMs: Date.now() - startedAt };
    }

    const settled = await bounded(request({ type: "shutdown", data: {}, reply: "stopped" }), SHUTDOWN_FLUSH_WINDOW_MS, null);
    state.worker = null;

    try {
      // The worker's own `stop()` exits the thread ~50ms after posting `stopped`;
      // terminate() is the belt for the case where it did NOT get that far.
      await bounded(worker.terminate(), SHUTDOWN_FLUSH_WINDOW_MS, null);
    } catch {}

    return {
      posture: "worker",
      acked: settled !== null,
      boundMs: SHUTDOWN_FLUSH_WINDOW_MS,
      elapsedMs: Date.now() - startedAt,
    };
  })();

  return state.shutdownPromise;
}

/**
 * Await `promise`, but NEVER past `ms`. Resolves with the promise's value, or
 * with `fallback` on timeout — and never REJECTS, whatever the promise does.
 * This is the single place the bound is enforced, so "bounded" is one law in
 * one file rather than a timer hand-rolled at four call sites.
 */
function bounded(promise, ms, fallback) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    if (typeof timer.unref === "function") timer.unref();
    Promise.resolve(promise).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        // A rejection is information, not a fault to re-throw: the drain is
        // about to exit and there is nobody left to tell. It is recorded in
        // `ack` as `acked:false` and, for the worker, still terminates.
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** The belt (§2.1): registered at init, fires once, calls the same idempotent door. */
function installBeforeExitBelt() {
  process.once("beforeExit", () => {
    // `beforeExit` is only reached when the loop drains NATURALLY — never on
    // SIGTERM (which ends the process by signal, not by loop exhaustion). So
    // this belt covers the paths the SIGTERM handler never sees: `next dev`'s
    // own shutdown, a worker thread keeping the loop alive, or a plain `node
    // server.js` that simply runs out of work. It is a BELT, not the lock —
    // awaiting here cannot hold the event loop open (Node does not re-emit
    // beforeExit while one is inside).
    void shutdownLogshipper();
  });
}

/** Test/diagnostic seam — the live state (not the durable ledger). */
export function getLogshipperState() {
  return state;
}