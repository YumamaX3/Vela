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
// Mirror posture still refuses LOUD (Wave C). sqlite binds its harbor; mysql
// binds repos/mysql/backupRepo.js (the twin lands here, criterion 7:
// restore-into-any-posture rides the SAME contract).
import { getDbMode } from "./bind.js";

async function dispatchData() {
  const mode = getDbMode();
  if (mode === "sqlite") return await import("./sqlite/backupRepo.js");
  if (mode === "mysql") {
    // Validate reachability (fail loud, never silent downgrade) before the
    // twin binds — an unreachable MariaDB must refuse, not half-restore.
    const { assertMysqlReachable } = await import("./bind.js");
    await assertMysqlReachable();
    return await import("./mysql/backupRepo.js");
  }
  // mirror: Wave C — primary sqlite + pump. Not yet forged.
  throw new Error(
    `[DB] VELA_DB_MODE=mirror — backupRepo binds in Storage Covenant Wave C — boot refusal (fail loud, never silent downgrade)`
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
