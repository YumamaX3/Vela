// Storage Covenant Wave B3 — the backup scheduler.
// Plan: plans/storage-covenant.md line 286-288 (scheduler) + line 300-302
// (usage purge runs AFTER the scheduled backup so purged rows live in the
// artifact).
//
// Precedent: quotaAutoPing.js — global.__velaBackup singleton (survives
// Next.js hot reload, one per server process), start/stop/configure surface,
// tick with a `running` guard, .unref() so the timer never holds the process
// open. FAIL-OPEN by law: an error in the tick writes a `failed` ledger row
// + sets the degraded flag, but NEVER throws out to the routing hot path.
//
// Env contract (all opt-in, default OFF):
//   VELA_BACKUP_ENABLED=false          — master switch
//   VELA_BACKUP_INTERVAL_HOURS=24      — tick interval
//   VELA_BACKUP_RETAIN_DAILY=7         — retention tier
//   VELA_BACKUP_RETAIN_WEEKLY=4        — retention tier
//   VELA_USAGE_RETENTION_DAYS=90       — purge window (0 = forever)
//   VELA_BACKUP_ENCRYPTION_KEY         — required for any backup to run

const TICK_MS_DEFAULT = 24 * 60 * 60 * 1000;
const JITTER_MS = 10 * 60 * 1000; // spread fleet ticks off the exact hour

// One scheduler per server process — survives hot reload.
const g = (global.__velaBackup ??= {
  timer: null,
  running: false,
  lastResult: null, // {ok, artifactId?, error?, at}
  degraded: false,
  nextRunAt: null,
});

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true" || raw === "1";
}

function envInt(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** The enabled flag — env-only (secrets + policy never in settings JSON). */
export function isBackupEnabled() {
  return envBool("VELA_BACKUP_ENABLED", false);
}

/** Default deps — the live backupRepo facade (dynamic import keeps the
 *  scheduler light until it actually runs). Tests inject fakes instead. */
async function defaultDeps() {
  return await import("@/lib/db/repos/backupRepo.js");
}

/** One backup cycle: backup → retention prune → usage purge (in that order —
 *  purge AFTER backup so purged rows live in the artifact). Fail-open.
 *  @param deps injectable — {runBackup, pruneBackupArtifacts, purgeOldUsage}
 *  (quotaAutoPing precedent: the tick takes its deps, tests inject fakes). */
export async function runBackupTick(deps = null) {
  if (g.running) return { skipped: "already-running" };
  if (!isBackupEnabled()) return { skipped: "disabled" };
  g.running = true;
  try {
    const mod = deps ?? (await defaultDeps());

    const backup = await mod.runBackup({ trigger: "scheduler" });

    const retainDaily = envInt("VELA_BACKUP_RETAIN_DAILY", 7);
    const retainWeekly = envInt("VELA_BACKUP_RETAIN_WEEKLY", 4);
    // The facade's prune is async (posture dispatch) — await it, never read
    // .removed off an unresolved promise.
    const pruned = await mod.pruneBackupArtifacts({ retainDaily, retainWeekly });

    const purged = await mod.purgeOldUsage();

    g.lastResult = {
      ok: true,
      artifactId: backup.artifactId,
      pruned: pruned.removed.length,
      purged,
      at: new Date().toISOString(),
    };
    g.degraded = false;
    return g.lastResult;
  } catch (err) {
    // FAIL-OPEN: record the failure, set degraded, never throw to the caller.
    g.degraded = true;
    g.lastResult = {
      ok: false,
      error: err?.message || String(err),
      at: new Date().toISOString(),
    };
    console.warn("[backup] scheduler tick failed (fail-open):", err?.message);
    return g.lastResult;
  } finally {
    g.running = false;
  }
}

function scheduleNext() {
  if (g.timer) clearInterval(g.timer);
  const intervalMs = envInt("VELA_BACKUP_INTERVAL_HOURS", 24) * 60 * 60 * 1000;
  const jitter = Math.floor(Math.random() * JITTER_MS);
  g.nextRunAt = Date.now() + intervalMs + jitter;
  g.timer = setInterval(() => {
    runBackupTick().catch(() => {}); // fail-open: never let a tick throw out
  }, intervalMs + jitter);
  if (g.timer.unref) g.timer.unref(); // never hold the process open
}

/** Start the scheduler (idempotent). Returns immediately. */
export function startBackupScheduler() {
  if (g.timer) return; // already running — idempotent
  if (!isBackupEnabled()) return; // master switch off — no timer
  console.log("[backup] scheduler started");
  // One tick shortly after boot (not immediately — let the app settle), then
  // on interval. The boot tick catches up if the last scheduled run was missed.
  const bootDelayMs = Math.floor(Math.random() * JITTER_MS);
  // The boot tick IS the next run — report it from arm time (status honesty).
  g.nextRunAt = Date.now() + bootDelayMs;
  g.timer = setTimeout(() => {
    runBackupTick().catch(() => {});
    scheduleNext();
  }, bootDelayMs);
  if (g.timer.unref) g.timer.unref();
}

/** Stop the scheduler (idempotent). */
export function stopBackupScheduler() {
  if (!g.timer) return;
  clearTimeout(g.timer);
  clearInterval(g.timer);
  g.timer = null;
  g.nextRunAt = null;
  console.log("[backup] scheduler stopped");
}

/** Re-read env policy + start/stop accordingly. Called from settings changes
 *  and boot. Env-only policy — there is no settings JSON to pass. */
export function configureBackupScheduler() {
  if (isBackupEnabled()) startBackupScheduler();
  else stopBackupScheduler();
}

/** Status snapshot for GET /api/backup/status. Metadata only (S4). */
export function getBackupStatus() {
  return {
    enabled: isBackupEnabled(),
    running: g.running,
    degraded: g.degraded,
    lastResult: g.lastResult,
    nextRunAt: g.nextRunAt ? new Date(g.nextRunAt).toISOString() : null,
    intervalHours: envInt("VELA_BACKUP_INTERVAL_HOURS", 24),
    retainDaily: envInt("VELA_BACKUP_RETAIN_DAILY", 7),
    retainWeekly: envInt("VELA_BACKUP_RETAIN_WEEKLY", 4),
    retentionDays: envInt("VELA_USAGE_RETENTION_DAYS", 90),
  };
}
