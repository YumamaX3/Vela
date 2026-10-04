/**
 * retention.js — the SWEEP POLICY (sealed plan r3 §8, M8).
 *
 * The plan gives the knob one sentence of behaviour — "Worker sweep applies
 * age/rows; unbounded honors manual clear only" — and everything load-bearing
 * lives in what that sentence must NOT quietly become:
 *
 *   1. **`unbounded` IS NOT "OFF", IT IS "MANUAL ONLY".** It prunes nothing on
 *      its own and the clear door still empties the table. That distinction is
 *      the operator's whole reason for choosing it: an unbounded ledger is
 *      still an erasable one.
 *   2. **THE DEGRADED 50 MB CAP OUTRANKS EVERY MODE.** §8 states it ("in the
 *      degraded (sql.js) posture the hard 50 MB cap applies REGARDLESS of
 *      mode") and it lives in index.js's degraded buffer, upstream of the
 *      worker — the two mechanisms meet at the same table and never fight,
 *      because only one of them is ever armed. `retentionPosture()` says so
 *      out loud rather than leaving the harbor to infer it.
 *   3. **THE SWEEP IS CHUNKED, SO IT CANNOT OWN THE LEDGER'S WRITE LOCK.**
 *      A 40M-row DELETE holds SQLite's single writer for seconds — on the same
 *      database a request is trying to use. Each pass removes a bounded number
 *      of rows and STOPS; whatever the chunk leaves behind is finished on the
 *      next cadence. The cost is stated, not hidden: an over-budget ledger
 *      converges over several passes rather than one.
 *   4. **EVERY KNOB IS DATA.** The cutoff, the ceilings and the chunk size are
 *      bound parameters, never concatenated into SQL. This file lives inside
 *      the logshipper directory, which `logshipper-worker.test.js` greps for
 *      concatenated SQL as a standing ratchet — the law is enforced here.
 *
 * WHY THIS IS ITS OWN FILE (and not logStore.js or worker.js):
 *   - worker.js is the THREAD; it must stay a transport, not a policy.
 *   - logStore.js is the raw SQL door, and `db-contract-census.test.js` keeps
 *     raw-adapter access inside `repos/sqlite/`. The STATEMENTS for the sweep
 *     live there; this file owns the DECISION and the CHUNKING, and reaches the
 *     ledger only through the store's existing parameterized surface. No
 *     adapter is imported here.
 */

// Relatives, never `@/` — a spawned Worker does not resolve the alias
// (measured: ERR_MODULE_NOT_FOUND from src/lib/db/paths.js).
import {
  LOG_RETENTION_KEYS,
  LOG_RETENTION_MAX_DAYS,
  LOG_RETENTION_MAX_ROWS,
  LOG_RETENTION_MIN_DAYS,
  LOG_RETENTION_MIN_ROWS,
  LOG_RETENTION_MODES,
  coerceLogRetention,
  defaultLogRetention,
  resolveLogRetention,
} from "../db/repos/settingsDefaults.js";

// Re-exported so the worker, the stats door and the suites read ONE set of
// numbers. Re-typing `14` in a second file is how a default starts lying.
export {
  LOG_RETENTION_KEYS,
  LOG_RETENTION_MAX_DAYS,
  LOG_RETENTION_MAX_ROWS,
  LOG_RETENTION_MIN_DAYS,
  LOG_RETENTION_MIN_ROWS,
  LOG_RETENTION_MODES,
  coerceLogRetention,
  defaultLogRetention,
  resolveLogRetention,
};

/** Rows removed per DELETE — bounded so no statement can stall the ledger. */
export const RETENTION_CHUNK_ROWS = 20_000;
/**
 * Passes per sweep. 40 × 20k = 800k rows retired in one cadence; a ledger past
 * that converges on the next hour rather than in one long-held write lock.
 */
export const RETENTION_MAX_PASSES = 40;
/**
 * The sweep's CADENCE. An hour: at 60s a quiescent gateway pays a pointless
 * DELETE every minute, and at 250ms the sweep would join the batch loop's
 * thread. An hour still bounds a secret's lifetime to one hour past its
 * horizon, which is the promise the knob makes.
 */
export const RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** The fixed SELECT the worker reads the stored posture through (bound id). */
const SETTINGS_SELECT_SQL = "SELECT data FROM settings WHERE id = ?";

/**
 * The legacy on-disk shape. `rows` was the wire field before `maxRows` was the
 * settings name; a posture arriving on the old shape is translated here, once,
 * rather than in every reader.
 */
function normalizeInput(input) {
  if (!input || typeof input !== "object") return defaultLogRetention();
  const maxRows = input.maxRows ?? input.rows;
  return coerceLogRetention({ ...input, maxRows });
}

/**
 * Read the stored posture for the sweep.
 *
 * The worker holds its OWN driver handle and cannot reach `@/lib/localDb` (the
 * alias law again), so it reads the same `settings` row through the same JSON
 * contract the repos use — a fixed SELECT and a bound id, never SQL from a
 * caller. A failure is NEVER fatal and NEVER permissive: the sweep falls back
 * to the DECLARED DEFAULT, so a missing table or a corrupt row leaves the
 * ledger bounded instead of un-bounded.
 *
 * @param {object} db an adapter (run/get/all/exec — never db.prepare)
 * @returns {{retention:object, source:"settings"|"default"}}
 */
export function readRetentionSettings(db) {
  const fallback = defaultLogRetention();
  try {
    const row = db.get(SETTINGS_SELECT_SQL, [1]);
    const raw = row?.data;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const stored = parsed && typeof parsed === "object" ? parsed.logRetention : null;
    if (!stored) return { retention: fallback, source: "default" };
    return { retention: coerceLogRetention(stored, fallback), source: "settings" };
  } catch {
    return { retention: fallback, source: "default" };
  }
}

/** The instant older than which a row is out of horizon: `now - days*86_400_000`. */
export function ageCutoffMs(retention, now = Date.now()) {
  const days = Number(retention?.days);
  const safe = Number.isFinite(days) && days >= LOG_RETENTION_MIN_DAYS ? days : defaultLogRetention().days;
  return now - safe * 86_400_000;
}

/** The newest N rows the rows-mode keeps. */
export function rowCeiling(retention) {
  const n = Number(retention?.maxRows);
  return Number.isFinite(n) && n >= LOG_RETENTION_MIN_ROWS ? Math.floor(n) : defaultLogRetention().maxRows;
}

/**
 * Run the sweep to (near) exhaustion, in bounded passes.
 *
 * `input` is UNTRUSTED and is coerced here — the worker is the component with
 * direct write authority over the durable store, so the posture it deletes on
 * is validated at the point of use, not merely validated on the way in.
 *
 * Returns the posture actually applied plus what the sweep retired, because
 * "the sweep ran and removed nothing" and "the sweep could not run" are
 * different facts and the harbor must be able to tell them apart.
 *
 * @param {object} store the logStore (driver / count / applyRetention)
 * @param {object} input `{mode, days, maxRows}` — untrusted
 * @param {{now?:number, maxPasses?:number, chunkRows?:number}} [opts]
 */
export function sweepOnce(store, input, opts = {}) {
  const retention = normalizeInput(input);
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const chunkRows = Number.isFinite(opts.chunkRows) && opts.chunkRows >= 1
    ? Math.min(Math.floor(opts.chunkRows), 200_000)
    : RETENTION_CHUNK_ROWS;
  const maxPasses = Number.isFinite(opts.maxPasses) ? Math.max(1, Math.floor(opts.maxPasses)) : RETENTION_MAX_PASSES;

  const result = {
    removed: 0,
    mode: retention.mode,
    days: retention.days,
    maxRows: retention.maxRows,
    strategy: "manual-only",
    passes: 0,
    exhausted: true,
    removedOverChunk: false,
    driver: store?.driver ?? null,
  };

  // UNBOUNDED: prune nothing, honor the clear door. Stated, never implied.
  if (retention.mode === "unbounded") return result;

  const cutoff = retention.mode === "age" ? ageCutoffMs(retention, now) : null;
  if (cutoff !== null) result.cutoffMs = cutoff;
  result.strategy = retention.mode === "age" ? "age-chunked" : "rows-chunked";

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const removed = Number(
      store.applyRetention(
        cutoff === null
          ? { mode: "rows-chunked", maxRows: rowCeiling(retention), chunkRows }
          : { mode: "age-chunked", cutoffMs: cutoff, chunkRows }
      ) || 0
    );
    result.removed += removed;
    result.passes += 1;
    if (removed < chunkRows) return result; // nothing left this cadence can reach
    result.removedOverChunk = true;
  }

  // The pass budget ran out with a FULL chunk still coming back: say so. A
  // ledger that reports "bounded" while a backlog is waiting is the exact
  // dishonesty this posture exists to prevent.
  result.exhausted = false;
  return result;
}

/**
 * The posture `/api/logs/stats` and the clear trail report: what the sweep IS
 * enforcing, whether it ran, and whether the degraded 50 MB cap outranks it.
 */
export function retentionPosture(retention, { degraded = false, active = true, last = null } = {}) {
  const policy = normalizeInput(retention);
  return {
    mode: policy.mode,
    days: policy.days,
    maxRows: policy.maxRows,
    source: "settings",
    sweepIntervalMs: RETENTION_SWEEP_INTERVAL_MS,
    active,
    degradedCapBytes: degraded ? 50 * 1024 * 1024 : null,
    degradedCapOverrides: degraded,
    last,
  };
}
