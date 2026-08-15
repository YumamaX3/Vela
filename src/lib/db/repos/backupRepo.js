// Storage Covenant Wave B1 — the backupRepo facade (posture dispatcher).
// Plan line 420: exportDb/importDb/initDb harbor-home. The sqlite twin is
// repos/sqlite/backupRepo.js (relocated verbatim from the raw-SQL barrel —
// the STAGED_DEBT=1 census debt is paid). The mysql twin lands as part of the
// backup engine; until then, a mysql/mirror posture refuses LOUD here.
//
// Unlike the pure repo facades (bindFacade), backupRepo carries Wave B's
// security layers ON TOP of the twins (S1 restore-quarantine, S2 secret
// redaction, max-payload bounds) — so this module dispatches explicitly.
//
// Contract law (bind.js): sqlite re-exports the harbor verbatim (sync fns
// stay sync); mysql binds repos/mysql/backupRepo.js (async); the barrel's
// exportDb/importDb/initDb re-export from HERE.
import { assertHarborBound, getDbMode } from "./bind.js";

async function dispatch() {
  // The boot gate runs FIRST — identical semantics to Wave A (fail loud,
  // never silent downgrade; Wave B lifts the mysql posture once the twin +
  // trust-crossing layers land below).
  await assertHarborBound();
  if (getDbMode() === "mysql") {
    // The mysql backupRepo twin is the backup engine's home — it lands WITH
    // the S1/S2 layers, never before. Until then: loud refusal.
    throw new Error(
      `[DB] VELA_DB_MODE=mysql — backupRepo (export/import) lands with the Storage Covenant backup engine (Wave B) — boot refusal (fail loud, never silent downgrade).`
    );
  }
  return await import("./sqlite/backupRepo.js");
}

export async function exportDb(opts) {
  const mod = await dispatch();
  return mod.exportDb(opts);
}

export async function importDb(payload) {
  const mod = await dispatch();
  return mod.importDb(payload);
}

export async function initDb() {
  const mod = await dispatch();
  return mod.initDb();
}
