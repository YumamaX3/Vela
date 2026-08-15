// Storage Covenant Wave B2 — the backupRepo facade (posture dispatcher).
// B1 moved exportDb/importDb/initDb here (plan line 420). B2 grows the
// surface into the full backup engine: the S1/S2 security layers live in the
// twins (repos/backupSecurity.js + each harbor's export/import), and the
// artifact pipeline (runBackup / restoreBackup / runRestoreDrill / ledger /
// retention / purge) lives in the sqlite harbor until its mysql twin lands
// (Wave B4 — restore-into-any-posture rides the SAME contract, criterion 7).
//
// Dispatch is explicit (not bindFacade): Wave B layers security ON TOP of the
// twins and the engine functions are posture-scoped. Contract law (bind.js):
// sqlite re-exports the harbor; mysql/mirror refuse LOUD until the twin binds.
import { assertHarborBound, getDbMode } from "./bind.js";

async function dispatch() {
  // The boot gate runs FIRST — identical semantics to Wave A (fail loud,
  // never silent downgrade).
  await assertHarborBound();
  if (getDbMode() === "mysql") {
    throw new Error(
      `[DB] VELA_DB_MODE=mysql — backupRepo lands with the Storage Covenant backup engine twins (Wave B4) — boot refusal (fail loud, never silent downgrade).`
    );
  }
  return await import("./sqlite/backupRepo.js");
}

// The engine surface — today sqlite-only. Under mysql/mirror these refuse
// loud at the seam (the engine functions call dispatch() just like export/
// import), never silently exporting the wrong engine.
export async function exportDb(opts) {
  const mod = await dispatch();
  return mod.exportDb(opts);
}

export async function importDb(payload, opts) {
  const mod = await dispatch();
  return mod.importDb(payload, opts); // S1 adoptSecrets rides opts
}

export async function initDb() {
  const mod = await dispatch();
  return mod.initDb();
}

export async function runBackup(opts) {
  const mod = await dispatch();
  return mod.runBackup(opts);
}

export async function restoreBackup(opts) {
  const mod = await dispatch();
  return mod.restoreBackup(opts);
}

export async function runRestoreDrill() {
  const mod = await dispatch();
  return mod.runRestoreDrill();
}

export async function writeLedger(kind, fields) {
  const mod = await dispatch();
  return mod.writeLedger(kind, fields);
}

export async function listBackupLedger(opts) {
  const mod = await dispatch();
  return mod.listBackupLedger(opts);
}

export async function pruneBackupArtifacts(opts) {
  const mod = await dispatch();
  return mod.pruneBackupArtifacts(opts);
}

export async function purgeOldUsage(opts) {
  const mod = await dispatch();
  return mod.purgeOldUsage(opts);
}
