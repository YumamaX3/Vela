// Storage Covenant Wave C3 — the mirror pump (seq-ordered single writer).
//
// The outbox (C1) records every classified writer's mutation; the decorator
// (C2) fills it atomically; THIS layer drains it into the mysql twin:
//
//   • seq-ordered single writer — pending rows apply in commit order, one at
//     a time; the apply cursor (mirrorSeq / twin seq-dedupe table) advances
//     monotonically.
//   • replay by class — idempotent-upsert + rmw-stale-hazard dispatch to the
//     twin repo writers the parity harness proves; identity-carrying replays
//     insert the CAPTURED identity (re-minting would poison UNIQUE); exempt
//     rows never reach the twin.
//   • backoff retry — a degraded twin backs the pump off exponentially
//     (5s → 5min cap); the primary keeps serving, the outbox accumulates.
//   • boot catch-up — startMirrorPump fires an immediate drain, so a restart
//     after an outage drains the backlog before the first interval tick.
//   • poison policy — a deterministic replay failure poisons IMMEDIATELY
//     (markOutboxPoison + backup-ledger alert + skip); an infra failure burns
//     a 5-attempt retry budget, then poisons. Poison NEVER head-of-line-blocks
//     the queue. Surfaced for manual replay via the ledger + status.
//   • retention — applied rows prune after 24h; S3 ages ALL rows out after
//     7 days regardless of status.
//
// S3 clause three shapes the retry contract: args are redacted once the twin
// has answered (applied or terminal poison) — and every row ages out after 7
// days regardless of status, so an outage window can never become an
// unbounded plaintext token journal. An INFRA failure (twin unreachable) is
// the mirror's reason to exist: the args survive for the retry, the outbox
// accumulates, the pump backs off, and boot catch-up drains on recovery.
// The retry budget bounds per-op churn; exceeding it poisons loudly (ledger
// alert) and the Wave C4 divergence sweep reconciles the twin.
//
// Census ratchet: this orchestration layer never touches the driver — sqlite
// access rides repos/sqlite/outboxRepo.js + backupRepo.js, twin access rides
// repos/mysql/mirrorApplyRepo.js.
import {
  fetchPendingOutbox,
  markOutboxApplied,
  markOutboxFailed,
  markOutboxPoison,
  markOutboxSkipped,
  redactOutboxArgs,
  pruneAppliedOutbox,
  pruneOutboxWindow,
  getMirrorCursor,
  setMirrorCursor,
} from "../repos/sqlite/outboxRepo.js";
import { REDACTED_SENTINEL } from "../repos/backupSecurity.js";

const PUMP_BATCH = 100;
const HEALTHY_TICK_MS = 15_000;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const POISON_MAX_RETRIES = 5;
const APPLIED_RETENTION_MS = 24 * 60 * 60 * 1000;
const OUTBOX_WINDOW_DAYS = 7;

function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** The pump's global state — the backupScheduler singleton pattern, so the
 *  pump survives Next.js dev hot-reload exactly one instance at a time. */
if (!global.__velaMirror) {
  global.__velaMirror = {
    timer: null,
    running: false, // the single-writer lock — never two drains at once
    stopped: true,
    degraded: false,
    failures: 0, // consecutive failed/degraded runs → backoff exponent
    lastRunAt: null,
    lastResult: null,
    lastError: null,
    nextDelayMs: HEALTHY_TICK_MS,
  };
}
function getState() { return global.__velaMirror; }

// ─── The applier seam ────────────────────────────────────────────────────
// Tests inject a fake twin here; production resolves the real apply repo
// lazily (the mysql2 import only loads when mirror posture actually pumps).
let _applierOverride = null;
export function setMirrorApplier(fn) { _applierOverride = fn; }
async function resolveApplier() {
  if (_applierOverride) return _applierOverride;
  const { applyOutboxRow } = await import("../repos/mysql/mirrorApplyRepo.js");
  return applyOutboxRow;
}

function parseRow(row) {
  let args = [];
  let argsRedacted = false;
  if (row.args === REDACTED_SENTINEL) {
    argsRedacted = true;
  } else {
    try {
      const parsed = JSON.parse(row.args || "[]");
      args = Array.isArray(parsed) ? parsed : [];
    } catch { args = []; }
  }
  let identity = null;
  try { identity = row.identity ? JSON.parse(row.identity) : null; } catch { identity = null; }
  return { seq: row.seq, replayClass: row.replayClass, fnName: row.fnName, args, argsRedacted, identity };
}

/** Loud, ledgered alert for a poisoned op — surfaced for manual replay. */
async function poisonAlert(op, error, retries) {
  const { writeLedger } = await import("../repos/sqlite/backupRepo.js");
  await writeLedger("mirrorPoison", {
    status: "failed",
    sourceMode: "sqlite",
    targetMode: "mysql",
    error,
    meta: { seq: op.seq, fnName: op.fnName, replayClass: op.replayClass, retries },
  });
  console.warn(
    `[mirror] POISON — outbox seq=${op.seq} ${op.fnName} (${op.replayClass}) exceeded its retry budget; skipped, twin reconciliation owed: ${String(error).slice(0, 200)}`
  );
}

/** One full drain pass. Never head-of-line-blocks: every row resolves to
 *  applied / skipped / poison this pass (infra failures mark retry + backoff
 *  but the loop moves to the next row). Returns the run statistics. */
export async function runMirrorPumpOnce({ maxRetries } = {}) {
  const budget = maxRetries ?? envInt("VELA_MIRROR_MAX_RETRIES", POISON_MAX_RETRIES);
  const apply = await resolveApplier();
  const stats = { drained: 0, applied: 0, poisoned: 0, skipped: 0, retried: 0, redacted: 0, pruned: 0 };

  // Each row is attempted ONCE per pass — a row still retryable at pass end
  // waits for the NEXT pass (backoff spaces the retries; burning the whole
  // retry budget inside one drain would defeat the outage-recovery design).
  const seen = new Set();
  let batch = await fetchPendingOutbox(PUMP_BATCH);
  batch = batch.filter((r) => !seen.has(r.seq));
  while (batch.length) {
    for (const row of batch) {
      const op = parseRow(row);
      seen.add(row.seq);
      stats.drained++;

      // Exempt rows never mirror — terminal, honest, audited.
      if (op.replayClass === "exempt") {
        await redactOutboxArgs(row.seq);
        await markOutboxSkipped(row.seq, "exempt-class — usage flows via the divergence sweep, never arg-replay");
        stats.redacted++;
        stats.skipped++;
        continue;
      }

      // S3 — a row whose cargo was burned may still be a REDELIVERY of an
      // already-applied op (the twin's seq-dedupe answers without needing the
      // args). So redacted rows still reach apply: the dedupe guard decides
      // applied, the apply layer returns poison for anything it cannot prove.
      op.redacted = op.argsRedacted;

      let verdict = null;
      let infraError = null;
      try {
        verdict = await apply(op);
      } catch (e) {
        infraError = e;
      }

      if (infraError) {
        // The twin never answered — the attempt does NOT count as a reached
        // apply. The args survive for the retry (outage → accumulate → catch-up
        // drains is the mirror's core promise); S3's journal bound is the
        // 7-day age-out that removes rows regardless of status. The retry
        // budget bounds per-op churn; exceeding it poisons + alerts + burns
        // the cargo (C4 sweep reconciles).
        const retries = row.retries + 1;
        if (retries >= budget) {
          await redactOutboxArgs(row.seq);
          await markOutboxPoison(row.seq, infraError, retries);
          await poisonAlert(op, infraError, retries);
          await setMirrorCursor(null, row.seq);
          stats.redacted++;
          stats.poisoned++;
        } else {
          await markOutboxFailed(row.seq, infraError, retries);
          stats.retried++;
        }
        continue;
      }

      if (verdict === "applied") {
        // S3 — the cargo reached the twin; burn it the moment it lands.
        await redactOutboxArgs(row.seq);
        await markOutboxApplied(row.seq);
        await setMirrorCursor(row.seq, null);
        stats.applied++;
        stats.redacted++;
      } else {
        // A deterministic poison verdict (lost identity, registry drift,
        // UNIQUE-structural) can never succeed on retry — terminal at once.
        const retries = row.retries + 1;
        await redactOutboxArgs(row.seq);
        await markOutboxPoison(row.seq, "replay verdict: poison", retries);
        await poisonAlert(op, "replay verdict: poison", retries);
        await setMirrorCursor(null, row.seq);
        stats.poisoned++;
      }
    }

    batch = (await fetchPendingOutbox(PUMP_BATCH)).filter((r) => !seen.has(r.seq));
  }

  // Retention runs once per pass — ALSO when nothing is pending (aged applied
  // rows prune after 24h; the S3 window ages ALL rows out regardless of
  // status). An aged-out still-unapplied op is a lost replication — loud.
  const { pruned } = await pruneAppliedOutbox(APPLIED_RETENTION_MS);
  const aged = await pruneOutboxWindow(OUTBOX_WINDOW_DAYS);
  stats.pruned += pruned;
  if (aged.agedPending > 0) {
    const { writeLedger } = await import("../repos/sqlite/backupRepo.js");
    await writeLedger("mirrorAgeOut", {
      status: "failed",
      sourceMode: "sqlite",
      targetMode: "mysql",
      error: `${aged.agedPending} op(s) aged out of the outbox window still unapplied`,
      meta: { rows: aged.agedPending },
    });
    console.warn(`[mirror] ${aged.agedPending} outbox op(s) aged out still unapplied — twin reconciliation owed (Wave C4 sweep)`);
  }

  const cursor = await getMirrorCursor();
  stats.lastAppliedSeq = cursor.lastAppliedSeq;
  stats.lastFailedSeq = cursor.lastFailedSeq;
  return stats;
}

// ─── Lifecycle (backupScheduler precedent) ──────────────────────────────

function computeDelay(state) {
  if (state.degraded && state.failures > 0) {
    const exp = Math.min(state.failures - 1, 20);
    return Math.min(BACKOFF_BASE_MS * 2 ** exp, BACKOFF_MAX_MS);
  }
  return state.nextDelayMs;
}

async function tick() {
  const state = getState();
  if (state.running || state.stopped) return; // single writer + stop honored
  state.running = true;
  try {
    const stats = await runMirrorPumpOnce();
    state.lastRunAt = new Date().toISOString();
    state.lastResult = stats;
    state.lastError = null;
    // Degraded when the drain left rows unapplied (twin unreachable or
    // retrying) — the mode NEVER downgrades; the pump just backs off.
    const unapplied = stats.retried > 0 || stats.poisoned > 0;
    if (unapplied) {
      state.degraded = true;
      state.failures++;
    } else {
      state.degraded = false;
      state.failures = 0;
    }
  } catch (e) {
    // Fail-open: the primary keeps serving; the pump retries on backoff.
    state.degraded = true;
    state.failures++;
    state.lastError = e?.message || String(e);
    console.warn(`[mirror] pump run failed (fail-open, primary keeps serving): ${state.lastError}`);
  } finally {
    state.running = false;
    if (!state.stopped) {
      const delay = computeDelay(state);
      state.timer = setTimeout(() => { state.timer = null; void tick(); }, delay);
      if (typeof state.timer.unref === "function") state.timer.unref();
    }
  }
}

/** Boot catch-up: fire an immediate drain, then schedule the rhythm. Safe to
 *  call repeatedly — the first live pump wins (single writer). */
export function startMirrorPump({ tickMs, healthyTickMs } = {}) {
  const state = getState();
  if (tickMs || healthyTickMs) state.nextDelayMs = tickMs || healthyTickMs;
  if (!state.stopped) return state; // already pumping
  state.stopped = false;
  state.degraded = false;
  state.failures = 0;
  void tick(); // boot catch-up — drains the outage backlog immediately
  return state;
}

export function stopMirrorPump() {
  const state = getState();
  state.stopped = true;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  return state;
}

export function configureMirrorPump({ tickMs, healthyTickMs } = {}) {
  const state = getState();
  if (tickMs || healthyTickMs) state.nextDelayMs = tickMs || healthyTickMs;
  return state;
}

export function getMirrorPumpStatus() {
  const state = getState();
  return {
    running: !state.stopped,
    draining: state.running,
    degraded: state.degraded,
    failures: state.failures,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult,
    lastError: state.lastError,
    nextDelayMs: computeDelay(state),
  };
}
