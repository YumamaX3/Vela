/**
 * worker.js — the drainer (sealed plan r3 §2).
 *
 * A REAL `worker_threads` Worker. It:
 *   - opens its OWN driver handle (workerDriver.js — relative imports, because
 *     the `@/` alias does not resolve in a spawned thread);
 *   - drains the 4 MB SAB ring in batches and inserts each batch in ONE
 *     transaction, with every value bound;
 *   - OWNS checkpointing — its handle is the only one left running the 60s
 *     TRUNCATE cadence, so the main thread can never wait on a checkpoint lock;
 *   - owns the retention sweep, prune-on-boot, drop-counter reporting and the
 *     clear execution;
 *   - posts `{type:'flushed', n, droppedSinceLast}` notices for main to bridge.
 *
 * ═══ THE MESSAGE CHANNEL LAW (r3) ═══
 *   A closed allow-list of FOUR types with fixed field schemas. Anything else
 *   is ignored AND counted — the channel guards a component holding direct
 *   write authority over the durable store, so it must not be an open door.
 *   No message may carry SQL, a filesystem path, or an object spread into a
 *   settings write. `handleMessage` therefore never spreads `data` into
 *   anything; it reads named fields off a validated shape.
 */

import { parentPort, workerData } from "worker_threads";
import { createRing, drain, ringStats, SLOT_DROPPED } from "./writer.js";
import { openWorkerDriver } from "./workerDriver.js";
import { createLogStore } from "../db/repos/sqlite/logStore.js";
import {
  coerceLogRetention,
  RETENTION_SWEEP_INTERVAL_MS,
  defaultLogRetention,
  readRetentionSettings,
  sweepOnce,
} from "./retention.js";

/** 250ms — the plan's named batch interval (part of the 2.5s durability bound). */
const BATCH_INTERVAL_MS = 250;
/** 60s — the worker keeps the main handle's TRUNCATE cadence. */
const CHECKPOINT_INTERVAL_MS = 60 * 1000;
/** Rows per transaction. The plan measured 17ms per 500-row batch. */
const MAX_BATCH_ROWS = 500;

/**
 * The posture the worker enforces until the stored settings say otherwise.
 * The SOURCE OF TRUTH is `settings.logRetention` (read through
 * retention.js at boot and on every `retention` message) — this constant is
 * only the fallback for a settings row that is absent or unreadable, and it
 * mirrors `DEFAULT_SETTINGS.logRetention` exactly. Both are exported from the
 * same seam for that reason; re-typing 14 here is how a default starts lying.
 */
const DEFAULT_RETENTION = defaultLogRetention();

/** The closed allow-list. `fields` names the ONLY keys read off the message. */
const ALLOWED_MESSAGES = Object.freeze({
  flush: Object.freeze({ fields: ["seq"], required: [] }),
  clear: Object.freeze({ fields: ["seq"], required: [] }),
  // M8: `maxRows` joins `rows` because `rows` was the M3 wire name and a
  // posture still in flight must not silently prune by a default ceiling. Both
  // are read, neither is spread, and retention.js resolves the precedence once.
  retention: Object.freeze({ fields: ["mode", "days", "maxRows", "rows"], required: [] }),
  shutdown: Object.freeze({ fields: [], required: [] }),
});

const ring = {
  sab: workerData.sab,
  state: new Int32Array(workerData.sab, 0, 16),
  bytes: new Uint8Array(workerData.sab, 64, workerData.ringBytes),
  capacityBytes: workerData.ringBytes,
};

let store = null;
let timer = null;
let checkpointTimer = null;
let adapter = null;
let stopped = false;
let retentionTimer = null;
let lastSweep = null;
let retention = { ...DEFAULT_RETENTION };
let rejectedMessages = 0;
let lastDropped = 0;

/** Post a notice to main. Structured clone only — no functions, no handles. */
function post(msg) {
  try { parentPort.postMessage(msg); } catch {}
}

/**
 * Adopt a posture from the stored settings — the worker's source of truth.
 * This runs through its OWN handle (`SELECT data FROM settings WHERE id = ?`),
 * because a spawned Worker cannot reach `@/lib/localDb` (the alias law, and
 * a second connection to the same ledger). A failure returns the DECLARED
 * default rather than leaving the previous posture in force: a sweep that
 * kept running on a stale rule after the operator changed it is worse than
 * one that reverts to the documented default.
 */
function readStoredRetention() {
  // The ADAPTER, not the store wrapper: the settings read is a fixed SELECT
  // on this handle, and the store deliberately never sees SQL it does not own.
  const found = readRetentionSettings(adapter);
  retention = { ...found.retention };
  return { retention: { ...retention }, source: found.source };
}

/**
 * Named fields ONLY — no spread of the incoming message into this object.
 * An unknown mode or a bad number is ignored here and refused at the seam
 * (resolveLogRetention), because the channel guards a component holding
 * direct write authority over the durable store.
 */
function readMessageRetention(fields) {
  const patch = {};
  if (typeof fields.mode === "string") patch.mode = fields.mode;
  if (typeof fields.days === "number") patch.days = fields.days;
  const maxRows = typeof fields.maxRows === "number" ? fields.maxRows : fields.rows;
  if (typeof maxRows === "number") patch.maxRows = maxRows;
  const next = coerceLogRetention({ ...retention, ...patch });
  retention = next;
  return next;
}

/**
 * Run one sweep and report it. The notice carries the POSTURE the sweep
 * actually applied — never the request that produced it — so main's stats
 * cannot report a policy the ledger was never pruned by.
 */
function runSweep(reason) {
  if (!store) return null;
  const outcome = sweepOnce(store, retention);
  lastSweep = { reason, ...outcome };
  if (outcome.removed > 0) post({ type: "pruned", ...outcome, reason });
  return outcome;
}

/** Drain the ring, insert what we read, in ONE transaction. */
function flushBatch() {
  if (!store) return 0;
  const rows = drain(ring, MAX_BATCH_ROWS);
  if (!rows.length) return 0;
  try {
    return store.insertBatch(rows) || 0;
  } catch (e) {
    // A batch that fails to commit is reported, never silently swallowed —
    // and never re-read from the ring (the cursor has moved; re-reading would
    // resurrect a half-written state). The rows are lost, and lost is counted.
    post({ type: "error", message: String(e?.message ?? e), dropped: rows.length });
    return 0;
  }
}

/** Drain until the ring is empty — the bounded shutdown/clear handshake. */
function drainToEmpty(maxPasses = 64) {
  let inserted = 0;
  for (let i = 0; i < maxPasses; i += 1) {
    const n = flushBatch();
    inserted += n;
    if (n === 0 && ringStats(ring).pendingFrames === 0) break;
  }
  return inserted;
}

function reportFlushed(n, extra = {}) {
  const dropped = Atomics.load(ring.state, SLOT_DROPPED);
  const droppedSinceLast = dropped - lastDropped;
  lastDropped = dropped;
  post({ type: "flushed", n, droppedSinceLast, ...extra });
}

function handleMessage(msg) {
  const type = msg?.type;
  if (!type || !Object.prototype.hasOwnProperty.call(ALLOWED_MESSAGES, type)) {
    rejectedMessages += 1;
    post({ type: "rejected", messageType: typeof type === "string" ? type : null, count: rejectedMessages });
    return;
  }
  // Named fields only — never a spread of the incoming message.
  const data = msg.data && typeof msg.data === "object" ? msg.data : {};
  const fields = {};
  for (const key of ALLOWED_MESSAGES[type].fields) {
    if (Object.prototype.hasOwnProperty.call(data, key)) fields[key] = data[key];
  }

  switch (type) {
    case "flush": {
      const n = drainToEmpty();
      reportFlushed(n, { seq: fields.seq });
      break;
    }
    case "clear": {
      // §6 ordering step 3 — the ring is already drained by the flush that
      // precedes this message; DELETE then ack with the deleted count.
      const deleted = store ? store.clear() : 0;
      post({ type: "cleared", deleted, seq: fields.seq });
      break;
    }
    case "retention": {
      // §8: the message carries a posture, but the SETTINGS are the source of
      // truth. The stored row is re-read first so a stale in-memory rule can
      // never outlive the operator's change; the message's fields then patch
      // that (this is what a test — and a future settings hook — drives).
      readStoredRetention();
      const applied = readMessageRetention(fields);
      const outcome = runSweep("retention-message");
      post({
        type: "retention-applied",
        removed: outcome ? outcome.removed : 0,
        mode: applied.mode,
        days: applied.days,
        maxRows: applied.maxRows,
        strategy: outcome ? outcome.strategy : "manual-only",
      });
      break;
    }
    case "shutdown": {
      stop({ reason: "shutdown" });
      break;
    }
    default:
      rejectedMessages += 1;
      break;
  }
}

function stop() {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  clearInterval(checkpointTimer);
  clearInterval(retentionTimer);
  let inserted = 0;
  let deleted = 0;
  try { inserted = drainToEmpty(); } catch {}
  reportFlushed(inserted, { reason: "shutdown" });
  try { store?.close(); } catch {}
  post({ type: "stopped" });
  // Give main its ack before the thread goes away.
  setTimeout(() => process.exit(0), 50);
}

async function main() {
  try {
    const { adapter: opened, driver, pinned, pinnedDriver } = await openWorkerDriver();
    adapter = opened;
    store = createLogStore(adapter);
    store.ensureTable();

    // M8 §8 — THE STORED POSTURE IS THE SOURCE OF TRUTH. The worker's own
    // default (DEFAULT_RETENTION) applies only when the settings row is absent
    // or unreadable, and an unreadable row reverts to that documented default
    // rather than keeping a stale rule.
    let retentionSource = "default";
    try {
      retentionSource = readStoredRetention().source;
    } catch {}

    // Prune-on-boot: one retention sweep before the first batch, so a process
    // that was down over the horizon starts already bounded.
    try {
      const boot = runSweep("boot");
      if (boot && boot.removed > 0) post({ type: "pruned-on-boot", removed: boot.removed, mode: boot.mode });
    } catch {}

    // OWNERSHIP: this handle keeps the 60s TRUNCATE cadence. The main handle's
    // is suppressed (checkpointOwner.js), so the freeze cannot recur.
    store.disableAutoCheckpoint();
    checkpointTimer = setInterval(() => {
      try { store.checkpoint(); } catch {}
    }, CHECKPOINT_INTERVAL_MS);
    if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();

    parentPort.on("message", handleMessage);
    timer = setInterval(() => {
      const n = flushBatch();
      if (n > 0) reportFlushed(n);
    }, BATCH_INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();

    // §8's periodic sweep. The cadence lives in retention.js and is unref'd, so
    // it never holds the thread open — the sweep runs on the worker's OWN
    // thread, never on the serving path, and the chunked delete bounds the
    // write lock it holds (§2's R4: logging never blocks a request).
    retentionTimer = setInterval(() => {
      try { runSweep("interval"); } catch {}
    }, RETENTION_SWEEP_INTERVAL_MS);
    if (typeof retentionTimer.unref === "function") retentionTimer.unref();

    // `pin` rides the ready notice so main's stats can report whether the
    // declared driver is the OPENED one — the plan's "made TRUE, not inferred".
    post({
      type: "ready",
      driver,
      ring: ringStats(ring),
      retention,
      retentionSource,
      retentionSweepMs: RETENTION_SWEEP_INTERVAL_MS,
      pin: { requested: pinnedDriver ?? null, honoured: Boolean(pinned) },
    });
  } catch (e) {
    post({ type: "error", message: String(e?.message ?? e), fatal: true });
    setTimeout(() => process.exit(1), 50);
  }
}

main();