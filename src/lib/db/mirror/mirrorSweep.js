// Storage Covenant Wave C4 — the divergence sweep + full resync conductor.
//
// Plan (plans/storage-covenant.md): "Divergence sweep: per-table normalized
// fingerprints — COUNT + checksum of sorted pk hashes with a named exclusion
// list… Mismatch > threshold → ledger alert + full-resync via complete
// export→import (safe ONLY because the export is generic-scope — revision 5)."
//
// The sweep fingerprints every FINGERPRINT_TABLES table on BOTH harbors (raw
// SELECT * through the two sweep read seams — census ratchet) and compares via
// mirrorFingerprint.js. Any mismatch above the threshold writes a LOUD
// mirrorDivergence ledger alert and (by default) runs the full resync.
//
// ─── The full-resync trust model (C4 decision, memory crystallized) ──────
// A primary→twin resync is the primary's own truth flowing to its replica —
// NOT hostile input. Two seams make it mirror-faithful:
//
//   1. adoptKeys:true on importDb — the payload's KEY identity (keyHash/
//      isInternal/deletedAt) lands verbatim, while settings still ride the
//      safe quarantine path. A mirror-faithful twin needs the real keyHashes
//      or key-gated traffic breaks on failover. (The twin's mirror-minted
//      rows use `mirror:${keyHash}` ids, so the by-id quarantine re-stitch
//      would null the keyHash.)
//
//   2. Secret preservation — exportDb S2-redacts SECRET_SETTING_KEYS to the
//      "[REDACTED]" sentinel. mitmSudoEncrypted is redacted but NOT in the
//      RESTORE_QUARANTINED list, so a naive resync would install the literal
//      sentinel into the twin. Before importDb, the twin's own current secret
//      values are stitched back over any sentinel, so the twin keeps its
//      secrets. (S6 secret-bundle recovery is the only path that MOVES
//      secrets between stores.)
//
// ─── The drain-window guard ────────────────────────────────────────────────
// A pump that is mid-drain (pending outbox rows / degraded backoff) carries
// INTENTIONAL lag — not divergence. The sweep refuses to fingerprint while
// rows are still in flight, so an outage window never reads as drift and never
// triggers a wasteful full resync.
//
// Census ratchet: reads ride repos/*/mirrorSweepRepo.js; the resync reaches
// the DATA twins directly (repos/sqlite/backupRepo.js + repos/mysql/
// backupRepo.js) because the backupRepo facade's mirror bind lands in Wave C5.
import { FINGERPRINT_TABLES, fingerprintRows, compareFingerprints } from "./mirrorFingerprint.js";
import { REDACTED_SENTINEL, SECRET_SETTING_KEYS } from "../repos/backupSecurity.js";
import { fetchPendingOutbox } from "../repos/sqlite/outboxRepo.js";

const DIVERGENCE_SWEEP_TICK_MS = 6 * 60 * 60 * 1000; // 6h default rhythm

function envInt(name, fallback) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true" || raw === "1";
}

/** The sweep's global state — backupScheduler singleton pattern. */
const g = (global.__velaMirrorSweep ??= {
  timer: null,
  running: false,
  stopped: true,
  degraded: false,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
});

// ─── Test seams (C4 tests inject a shadow twin; default = real repos) ────
// The sqlite leg must prove "drift → flag → resync restores" WITHOUT ever
// touching the Star's parity twin — tests inject shadow-harbor readers, a
// shadow importDb, and a recording ledger writer.
let seams = null;
export function setMirrorSweepSeams(overrides) {
  seams = overrides || null;
}

// ─── The sweep proper ────────────────────────────────────────────────────

/** Fingerprint one table on both harbors and compare. */
async function sweepTable(table) {
  let primaryRows, twinRows;
  if (seams?.fetchRows) {
    [primaryRows, twinRows] = await Promise.all([
      seams.fetchRows("sqlite", table),
      seams.fetchRows("mysql", table),
    ]);
  } else {
    const [primaryRepo, twinRepo] = await Promise.all([
      import("../repos/sqlite/mirrorSweepRepo.js"),
      import("../repos/mysql/mirrorSweepRepo.js"),
    ]);
    [primaryRows, twinRows] = await Promise.all([
      primaryRepo.fetchSweepRows(table),
      twinRepo.fetchSweepRows(table),
    ]);
  }
  return compareFingerprints(
    table,
    fingerprintRows(table, primaryRows),
    fingerprintRows(table, twinRows)
  );
}

async function writeSweepLedger(kind, fields) {
  if (seams?.writeLedger) return seams.writeLedger(kind, fields);
  return (await import("../repos/sqlite/backupRepo.js")).writeLedger(kind, fields);
}

/** One full sweep pass. Returns {swept, matched, divergent[], skipped?}.
 *  autoResync (default ON) triggers the full resync when divergence clears
 *  the threshold. The drain-window guard refuses while rows are in flight. */
export async function runDivergenceSweepOnce({ autoResync } = {}) {
  const threshold = envInt("VELA_MIRROR_DIVERGENCE_THRESHOLD", 0);
  const shouldResync = autoResync ?? envBool("VELA_MIRROR_SWEEP_AUTORESYNC", true);

  // The drain-window guard: pending outbox rows are intentional lag, not
  // drift. A fingerprint taken mid-drain would be a false alarm.
  const pending = await fetchPendingOutbox(1);
  if (pending.length > 0) {
    return { swept: false, skipped: "drain-in-progress", matched: [], divergent: [] };
  }

  const matched = [];
  const divergent = [];
  for (const table of Object.keys(FINGERPRINT_TABLES)) {
    const verdict = await sweepTable(table);
    (verdict.match ? matched : divergent).push(verdict);
  }

  const result = { swept: true, matched, divergent, resynced: null };

  if (divergent.length > threshold) {
    await writeSweepLedger("mirrorDivergence", {
      status: "failed",
      sourceMode: "sqlite",
      targetMode: "mysql",
      error: `${divergent.length} table(s) diverged from the primary`,
      meta: {
        tables: divergent.map((d) => ({
          table: d.table,
          countPrimary: d.countPrimary,
          countTwin: d.countTwin,
          rowDrift: d.rowDrift,
        })),
      },
    });
    console.warn(
      `[mirror] DIVERGENCE — ${divergent.map((d) => d.table).join(", ")} — ` +
      `${shouldResync ? "full resync engaged" : "autoResync off; twin reconciliation owed"}`
    );
    if (shouldResync) result.resynced = await runFullResync();
  }

  g.lastRunAt = new Date().toISOString();
  g.lastResult = {
    ok: divergent.length === 0,
    divergent: divergent.map((d) => d.table),
    resynced: result.resynced,
    at: g.lastRunAt,
  };
  g.degraded = divergent.length > 0;
  return result;
}

// ─── The full resync (complete export → import) ──────────────────────────

/** Stitch the twin's own secret settings back over any S2 sentinel in the
 *  payload, so a resync never installs "[REDACTED]" as a live secret. */
async function preserveTwinSecrets(payload) {
  if (!payload.settings || typeof payload.settings !== "object") return payload;
  const current = seams?.getTwinSettings
    ? await seams.getTwinSettings()
    : await (await import("../repos/mysql/settingsRepo.js")).getSettings();
  for (const key of SECRET_SETTING_KEYS) {
    if (payload.settings[key] === REDACTED_SENTINEL) {
      const live = current[key];
      if (live !== undefined && live !== null && live !== "") payload.settings[key] = live;
      else delete payload.settings[key]; // the twin has none — drop the sentinel
    }
  }
  return payload;
}

/** Full resync from the primary: generic-scope export → secret stitch →
 *  adoptKeys import into the twin → usage watermark advanced to the copied
 *  max id (the routine incremental pass must not re-append what the bulk copy
 *  already carried). Returns {resynced:true, tables, watermark}. */
export async function runFullResync() {
  const usageResync = await import("../repos/sqlite/usageResyncRepo.js");

  // Generic-scope export of the PRIMARY (revision 5 law — this is what makes
  // the full export→import resync safe).
  const payload = seams?.exportDb
    ? await seams.exportDb()
    : await (await import("../repos/sqlite/backupRepo.js")).exportDb({ includeRequestDetails: false });
  await preserveTwinSecrets(payload);

  // adoptKeys — the primary's key identity lands verbatim (mirror-faithful);
  // settings still ride the safe quarantine path (see header).
  if (seams?.importDb) {
    await seams.importDb(payload, { adoptKeys: true });
  } else {
    await (await import("../repos/mysql/backupRepo.js")).importDb(payload, { adoptKeys: true });
  }

  // The bulk copy carried usageHistory with the primary's ids — advance the
  // watermark to the copied max id so the incremental pass picks up only NEW.
  const watermark = await usageResync.setUsageWatermark(await usageResync.getMaxUsageId());

  await writeSweepLedger("mirrorResync", {
    status: "ok",
    sourceMode: "sqlite",
    targetMode: "mysql",
    meta: { tables: Object.keys(FINGERPRINT_TABLES), watermark },
  });

  return { resynced: true, tables: Object.keys(FINGERPRINT_TABLES), watermark };
}

// ─── Lifecycle (backupScheduler precedent) ──────────────────────────────

async function tick() {
  if (g.running || g.stopped) return;
  g.running = true;
  try {
    await runDivergenceSweepOnce();
    g.lastError = null;
  } catch (e) {
    // Fail-open: the primary keeps serving; the sweep retries next tick.
    g.degraded = true;
    g.lastError = e?.message || String(e);
    console.warn(`[mirror] divergence sweep failed (fail-open): ${g.lastError}`);
  } finally {
    g.running = false;
    if (!g.stopped) {
      const delay = envInt("VELA_MIRROR_SWEEP_INTERVAL_MINUTES", DIVERGENCE_SWEEP_TICK_MS / 60000) * 60000;
      g.timer = setTimeout(() => { g.timer = null; void tick(); }, delay);
      if (typeof g.timer.unref === "function") g.timer.unref();
    }
  }
}

/** Start the sweep rhythm (idempotent). Boot fires one pass shortly after —
 *  a restart after an outage catches drift the pump alone could not heal. */
export function startMirrorSweep({ tickMs } = {}) {
  if (!g.stopped) return g; // already sweeping
  g.stopped = false;
  g.degraded = false;
  const bootDelay = Math.min(tickMs ?? 10_000, 60_000); // settle, then sweep
  g.timer = setTimeout(() => { g.timer = null; void tick(); }, bootDelay);
  if (typeof g.timer.unref === "function") g.timer.unref();
  return g;
}

export function stopMirrorSweep() {
  g.stopped = true;
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  return g;
}

export function getMirrorSweepStatus() {
  return {
    running: !g.stopped,
    sweeping: g.running,
    degraded: g.degraded,
    lastRunAt: g.lastRunAt,
    lastResult: g.lastResult,
    lastError: g.lastError,
  };
}
