// Migration 010 — request tags (Usage Observatory W4-C).
//
// Sealed plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL):
// "request tags (≤64 chars, charset allow-list, parameterized endpoint,
// escape-on-render + CSV)".
//
// What this seals:
//   1. usageRequestTags — one row per (usageHistory id, tag name). Tags are
//      an annotation layer OVER usageHistory: no foreign key (the schema's
//      cross-table style), so a tag whose request was purged simply never
//      renders — the ledger query is authoritative.
//   2. idx_urt_usageId — the ledger's batch tag lookup (one IN query per page).
//   3. uq_urt_usageId_name — a tag name is unique per request; the API's
//      PUT-replace rides this without a read-before-write.
//
// Validation (length ≤64, charset allow-list, per-request cap) rides
// src/lib/requestTagDef.js — this migration only forges the shape.
//
// MySQL twin: bootstrap.js brings the table/columns/indexes via the additive
// TABLES diff (schema.js is the single source of truth). No backfill — the
// table is born empty.
//
// Idempotent on any prior state.
const migration = {
  version: 10,
  name: "usage request tags",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS usageRequestTags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usageId INTEGER NOT NULL,
      name TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_urt_usageId ON usageRequestTags(usageId)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_urt_usageId_name ON usageRequestTags(usageId, name)`);
  },
};

export default migration;
