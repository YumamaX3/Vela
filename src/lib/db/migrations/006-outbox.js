// Storage Covenant Wave C1 — the mirror's outbox (migration 006).
// The plan named it "migration 005 (outbox)" before Wave B2 landed; 005 became
// the backup ledger, so the outbox takes 006 (schemaVersion 5 → 6).
//
// The outbox is SQLITE-ONLY by construction: it is the mirror pump's LOGICAL
// OP-LOG — the sqlite primary records what the mysql twin must replay. It is
// deliberately NOT added to TABLES: syncSchemaFromTables() would then replicate
// it onto the mysql twin via bootstrap.js, where it has no meaning. Fresh
// installs still receive it — runVersionedMigrations() applies every migration
// from version 0.
//
// Columns beyond the plan's base shape: retries + error — the Phase-10
// poison-op policy (per-op retry count, default cap 5 → mark failed + ledger
// alert + skip) needs them; adding them now avoids a second migration.
//
// S3 law sealed in Wave B2 already names it: EXPORT_EXCLUDED_TABLES contains
// "outbox" — its rows (writer args, captured identity) never flow into an
// artifact or a resync payload.
export default {
  version: 6,
  name: "mirror-outbox",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS outbox (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      replayClass TEXT NOT NULL,
      fnName TEXT NOT NULL,
      args TEXT NOT NULL,
      identity TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      retries INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      createdAt TEXT NOT NULL,
      appliedAt TEXT
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(status, seq)`);
  },
};
