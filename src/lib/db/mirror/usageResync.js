// Storage Covenant Wave C4 — the usage-resync conductor (incremental watermark).
//
// Plan (plans/storage-covenant.md): "incremental watermark append (last-synced
// usageHistory.id, bounded batch, scheduled interval) — NOT periodic full
// export; usageDaily + usage `_meta` counters ride the same watermark."
//
// Usage is the EXEMPT class — saveRequestUsage never rides outbox arg-replay
// (its cost/keyId resolve against eventually-consistent shadows and are
// engine-divergent by nature). So usage crosses to the twin through THIS
// conductor alone: read a bounded id-ordered batch BEYOND the watermark from
// the primary (repos/sqlite/usageResyncRepo.js), apply it VERBATIM to the twin
// (repos/mysql/usageResyncRepo.js — no re-costing, no re-resolving), then
// advance the watermark. usageDaily aggregates + the totalRequestsLifetime
// counter ride the same pass (they are aggregates of the very rows carried).
//
// Idempotence law: the watermark advances ONLY after a successful apply, and
// only FORWARD, so a redelivered id is a no-op and a rerun never double-appends.
// A full export→import resync bulk-copies usage with the primary's ids and then
// advances the watermark to the copied max (see mirrorSweep.runFullResync), so
// the routine pass here picks up only what is NEW.
//
// Census ratchet: this conductor never touches a driver — it reaches the primary
// through repos/sqlite/usageResyncRepo.js and the twin through
// repos/mysql/usageResyncRepo.js.
import {
  getUsageWatermark,
  setUsageWatermark,
  fetchUsageBatch,
  fetchUsageDailyForTimestamps,
  fetchTotalRequestsLifetime,
} from "../repos/sqlite/usageResyncRepo.js";

function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** The conductor's global state — backupScheduler singleton pattern. */
const g = (global.__velaUsageResync ??= {
  timer: null,
  running: false,
  stopped: true,
  degraded: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
});

// ─── Test seams (C4 tests inject a recording twin; default = real repos) ──
let seams = null;
export function setUsageResyncSeams(overrides) {
  seams = overrides || null;
}
async function applyBatch(rows) {
  if (seams?.applyUsageBatch) return seams.applyUsageBatch(rows);
  return (await import("../repos/mysql/usageResyncRepo.js")).applyUsageBatch(rows);
}
async function applyDaily(rows) {
  if (seams?.applyUsageDaily) return seams.applyUsageDaily(rows);
  return (await import("../repos/mysql/usageResyncRepo.js")).applyUsageDaily(rows);
}
async function applyLifetime(value) {
  if (seams?.applyLifetimeCounter) return seams.applyLifetimeCounter(value);
  return (await import("../repos/mysql/usageResyncRepo.js")).applyLifetimeCounter(value);
}

// ─── One resync pass ────────────────────────────────────────────────────

/** One bounded incremental pass. Drains batches beyond the watermark until
 *  caught up (or the per-pass row cap is reached), applying each VERBATIM and
 *  advancing the watermark only after a successful apply. usageDaily + the
 *  lifetime counter ride the pass. Returns
 *  {synced, appended, watermark, dailyApplied}. */
export async function runUsageResyncOnce({ batchSize } = {}) {
  const size = Math.max(1, batchSize ?? envInt("VELA_MIRROR_USAGE_BATCH_SIZE", 500));
  const maxRows = Math.max(size, envInt("VELA_MIRROR_USAGE_RESYNC_MAX_ROWS", 5000));

  let watermark = await getUsageWatermark();
  let appended = 0;
  const touchedTimestamps = [];

  while (appended < maxRows) {
    const want = Math.min(size, maxRows - appended);
    const batch = await fetchUsageBatch(watermark, want);
    if (!batch.length) break;
    await applyBatch(batch); // verbatim — the rows are already costed + key-resolved
    for (const r of batch) touchedTimestamps.push(r.timestamp);
    // Advance only FORWARD, only after a successful apply (idempotence law).
    watermark = await setUsageWatermark(batch[batch.length - 1].id);
    appended += batch.length;
    if (batch.length < want) break; // short batch = caught up
  }

  const result = { synced: appended > 0, appended, watermark, dailyApplied: 0 };
  if (!appended) return result;

  // usageDaily + the lifetime counter ride the same watermark.
  const daily = await fetchUsageDailyForTimestamps(touchedTimestamps);
  if (daily.length) {
    await applyDaily(daily);
    result.dailyApplied = daily.length;
  }
  await applyLifetime(await fetchTotalRequestsLifetime());

  g.lastRunAt = new Date().toISOString();
  g.lastResult = { ...result, at: g.lastRunAt };
  return result;
}

// ─── Lifecycle (backupScheduler precedent) ──────────────────────────────

async function tick() {
  if (g.running || g.stopped) return;
  g.running = true;
  try {
    await runUsageResyncOnce();
    g.degraded = false;
    g.lastError = null;
  } catch (e) {
    // Fail-open: usage resync is observability plumbing — the primary keeps
    // serving; the pass retries next tick and redelivery is a no-op.
    g.degraded = true;
    g.lastError = e?.message || String(e);
    console.warn(`[mirror] usage resync failed (fail-open): ${g.lastError}`);
  } finally {
    g.running = false;
    if (!g.stopped) {
      const delay = envInt("VELA_MIRROR_USAGE_RESYNC_INTERVAL_SECONDS", 60) * 1000;
      g.timer = setTimeout(() => { g.timer = null; void tick(); }, delay);
      if (typeof g.timer.unref === "function") g.timer.unref();
    }
  }
}

/** Start the usage-resync rhythm (idempotent). Fires one pass shortly after
 *  boot, then every interval. */
export function startUsageResync({ tickMs } = {}) {
  if (!g.stopped) return g; // already running
  g.stopped = false;
  g.degraded = false;
  const bootDelay = Math.min(tickMs ?? 5_000, 30_000); // settle, then resync
  g.timer = setTimeout(() => { g.timer = null; void tick(); }, bootDelay);
  if (typeof g.timer.unref === "function") g.timer.unref();
  return g;
}

export function stopUsageResync() {
  g.stopped = true;
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  return g;
}

export function getUsageResyncStatus() {
  return {
    running: !g.stopped,
    resyncing: g.running,
    degraded: g.degraded,
    lastRunAt: g.lastRunAt,
    lastResult: g.lastResult,
    lastError: g.lastError,
  };
}
