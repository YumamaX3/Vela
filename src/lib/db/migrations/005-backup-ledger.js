// Storage Covenant Wave B2 — the backup ledger table.
// migration 004 sealed the dedupe UNIQUE; 005 adds the ledger the backup
// engine writes its event rows into (backup | restore | drill | purge | failed).
// The additive auto-sync would also create it from TABLES, but the versioned
// migration pins the ordering contract (schemaVersion 4 → 5) so both engines
// agree on provenance and the pre-change safety backup fires on upgrade.
//
// S2 law: backupLedger is excluded from exportDb() BY NAME — its error strings
// carry paths/driver names/SQL errors (an information channel into artifacts).
import { buildCreateTableSql, TABLES } from "../schema.js";

export default {
  version: 5,
  name: "backup-ledger",
  up(db) {
    db.exec(buildCreateTableSql("backupLedger", TABLES.backupLedger));
  },
};
