// Migration 009 — saved views (Usage Observatory W4-A).
//
// Sealed plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL):
// "Saved views (migration 009 usage_views table + schema.js mirror +
// SCHEMA_VERSION bump, posture-bound, ALWAYS_PROTECTED write endpoint)".
//
// What this seals:
//   1. usageViews — one row per saved compass view. `params` carries the FULL
//      compass query string (tab + every facet), so applying a view is
//      `router.replace("?" + params)` — no client-side reconstruction.
//   2. UNIQUE on name — duplicate saves update the stored params (the API
//      upserts; the UI offers the overwrite explicitly).
//   3. idx_uv_created — the API serves views newest-first.
//
// Security note (phase13 discipline): `params` is operator-supplied and rides
// a URL one day; it is stored verbatim but never interpolated — no renderer
// trusts it (the client parses it with URLSearchParams, which never executes).
//
// MySQL twin: bootstrap.js brings the table/columns/indexes via the additive
// TABLES diff (schema.js is the single source of truth). No backfill — the
// table is born empty.
//
// Idempotent on any prior state.
const migration = {
  version: 9,
  name: "saved views",
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS usageViews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      params TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_uv_name ON usageViews(name)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_uv_created ON usageViews(createdAt DESC)`);
  },
};

export default migration;
