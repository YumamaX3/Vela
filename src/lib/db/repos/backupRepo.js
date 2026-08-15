// Storage Covenant Wave B4 — the backupRepo facade (posture dispatcher).
// B1 moved exportDb/importDb here; B2 layered S1/S2 + the engine; B4 splits
// the surface in two:
//
//   ENGINE (posture-independent, re-exported from backupEngine.js): the crypto,
//   artifact file I/O, secret-file bundle, restore drill, retention pruning.
//   runBackup/restoreBackup/runRestoreDrill dispatch the DATA calls through
//   THIS facade, so they work under sqlite AND mysql alike (plan line 284).
//
//   DATA (posture twins, dispatched here): exportDb/importDb/initDb/writeLedger/
//   listBackupLedger/purgeOldUsage — sqlite re-exports repos/sqlite/backupRepo.js;
//   mysql binds repos/mysql/backupRepo.js (the twin lands here, criterion 7:
//   restore-into-any-posture rides the SAME contract).
//
// Mirror posture (Wave C5): the PRIMARY serves — export/import/ledger/purge all
// ride the sqlite harbor (the primary is the truth; the twin follows through
// the pump/sweep/resync). Storm 1's hidden blessing lives here: a mirror's
// MariaDB replica is itself a recovery SOURCE (export from the twin via
// repos/mysql/backupRepo.js directly, restore into any posture).
import { getDbMode } from "./bind.js";

async function dispatchData() {
  const mode = getDbMode();
  if (mode === "sqlite" || mode === "mirror") {
    // mirror: the primary (sqlite) serves the backup contract — the twin is
    // kept faithful by the pump (C3) + sweep/resync (C4), never by backups.
    return await import("./sqlite/backupRepo.js");
  }
  if (mode === "mysql") {
    // Validate reachability (fail loud, never silent downgrade) before the
    // twin binds — an unreachable MariaDB must refuse, not half-restore.
    const { assertMysqlReachable } = await import("./bind.js");
    await assertMysqlReachable();
    return await import("./mysql/backupRepo.js");
  }
  throw new Error(
    `[DB] unknown posture "${mode}" — dispatchData refuses (fail loud, never silent downgrade)`
  );
}

// ─── The DATA twin surface (posture-scoped) ──────────────────────────────
export async function exportDb(opts) {
  const mod = await dispatchData();
  return mod.exportDb(opts);
}

export async function importDb(payload, opts) {
  const mod = await dispatchData();
  return mod.importDb(payload, opts); // S1 adoptSecrets rides opts
}

export async function initDb() {
  const mod = await dispatchData();
  return mod.initDb();
}

export async function writeLedger(kind, fields) {
  const mod = await dispatchData();
  return mod.writeLedger(kind, fields);
}

export async function listBackupLedger(opts) {
  const mod = await dispatchData();
  return mod.listBackupLedger(opts);
}

export async function purgeOldUsage(opts) {
  const mod = await dispatchData();
  return mod.purgeOldUsage(opts);
}

// ─── The ENGINE surface (posture-independent, re-exported) ───────────────
export {
  runBackup,
  restoreBackup,
  runRestoreDrill,
  pruneBackupArtifacts,
} from "./backupEngine.js";
