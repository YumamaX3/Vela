/**
 * Migration 018: combo context length (v0.9.26 — VansRouter lineage import)
 *
 * VansRouter's `combos` table carries a `context_length` INTEGER column —
 * the dashboard-set context-window hint per combo (v0.9.90 changelog). A
 * VansRouter SQLite DB migrating into Vela keeps that column if Vela's
 * TABLES declares it; this migration guarantees it exists on Vela-native
 * DBs too, and the combos repo round-trips the field.
 *
 * SCHEMA_VERSION moves 17 → 18 in schema.js (Covenant M1 — both numbers move
 * together; this migration carries version:18 so latestVersion() returns 18).
 *
 * ADAPTER CONTRACT (the v0.9.19/20/22 lesson): the adapter surface is
 * run/get/all/exec/transaction — NO raw prepare(). Use PRAGMA presence
 * checks + db.exec exactly like migration 002/013/017.
 *
 * Idempotency: the ALTER is guarded by a PRAGMA presence check so a crash
 * between DDL and version-meta re-runs cleanly (Covenant H2).
 */

const up = (db) => {
  const cols = db.all(`PRAGMA table_info(combos)`);
  const existing = new Set((cols || []).map((c) => c.name));
  if (!existing.has("context_length")) {
    db.exec(`ALTER TABLE combos ADD COLUMN context_length INTEGER`);
  }
};

const down = (db) => {
  const cols = db.all(`PRAGMA table_info(combos)`);
  const existing = new Set((cols || []).map((c) => c.name));
  if (existing.has("context_length")) {
    db.exec(`ALTER TABLE combos DROP COLUMN context_length`);
  }
};

export default { version: 18, name: "combo-context-length", up, down };
export { up, down };
