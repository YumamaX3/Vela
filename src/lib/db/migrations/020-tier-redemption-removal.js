/**
 * Migration 020: tier/redemption/events removal (Key Domain Ascension, reverted)
 * (v0.9.24, Stillwater Mirror — the Tiers/Redemptions/Events removal plan)
 *
 * The Star's decree (sealed in the Mirror): fully remove the three surfaces —
 * Tiers (saved ACL+limits presets), Redemptions (the spendable-balance credit
 * economy), and Events (redundant with the mutation ledger). The runtime
 * balance gate in keyGate dies with them; existing tracked-balance keys become
 * untracked (unrestricted). requestCapDaily is NOT part of this removal — it
 * stays a first-class limit.
 *
 * Drops, PRAGMA-guarded + idempotent (a crash between DDL and version-meta
 * re-runs cleanly):
 *   1. keyTiers table      (the presets)
 *   2. redemptions table   (the credit codes)
 *   3. apiKeys.tierId      (the snapshot reference)
 *   4. apiKeys.balanceCents (the runtime gate's column)
 *
 * ADAPTER CONTRACT (v0.9.20 lesson): run/get/all/exec/transaction — NO raw
 * prepare(). All statements below use db.exec / db.all exactly like migration
 * 002/013/016/019.
 *
 * Mirror note: the MariaDB twin (bootstrap.js) never drops — it keeps the
 * columns/rows dormant. This is the accepted, documented divergence of the
 * Storage Covenant (additive-only twin).
 *
 * ⚠️ schema.js TABLES must ALSO drop keyTiers/redemptions/tierId/balanceCents,
 * or syncSchemaFromTables re-creates the dropped tables every boot — the
 * silent-undone trap this migration's plan calls out.
 */

function columnNames(db, table) {
  return new Set(db.all(`PRAGMA table_info(${table})`).map((r) => r.name));
}

const up = (db) => {
  // 1. Tables — plain drop (keyTiers/redemptions carry no foreign keys).
  db.exec(`DROP TABLE IF EXISTS keyTiers`);
  db.exec(`DROP TABLE IF EXISTS redemptions`);

  // 2. apiKeys columns — guarded (older sqlite lacks DROP COLUMN; on adapters
  //    that refuse, the nullable columns stay dormant and harmless).
  const cols = columnNames(db, "apiKeys");
  if (cols.has("tierId")) {
    try { db.exec(`ALTER TABLE apiKeys DROP COLUMN tierId`); } catch {}
  }
  if (cols.has("balanceCents")) {
    try { db.exec(`ALTER TABLE apiKeys DROP COLUMN balanceCents`); } catch {}
  }
};

const down = (db) => {
  // Rollback path — re-create the two tables + the two columns. Additive and
  // nullable (no row breaks); the seed data is not restored (that was 019's
  // concern and the plan accepts data loss on reversion).
  db.exec(`CREATE TABLE IF NOT EXISTS keyTiers (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    description     TEXT,
    aclJson         TEXT,
    limitsJson      TEXT,
    categoryDefault TEXT,
    builtIn         INTEGER NOT NULL DEFAULT 0,
    isDefault       INTEGER NOT NULL DEFAULT 0,
    createdAt       TEXT NOT NULL,
    updatedAt       TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS redemptions (
    id          TEXT PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL DEFAULT 'credit',
    valueCents  INTEGER NOT NULL DEFAULT 0,
    balanceTopUp INTEGER NOT NULL DEFAULT 0,
    maxUses     INTEGER,
    uses        INTEGER NOT NULL DEFAULT 0,
    expiresAt   TEXT,
    createdBy   TEXT,
    createdAt   TEXT NOT NULL,
    data        TEXT
  )`);
  const cols = columnNames(db, "apiKeys");
  if (!cols.has("tierId")) db.exec(`ALTER TABLE apiKeys ADD COLUMN tierId TEXT`);
  if (!cols.has("balanceCents")) db.exec(`ALTER TABLE apiKeys ADD COLUMN balanceCents INTEGER`);
};

export default { version: 20, name: "tier-redemption-removal", up, down };
export { up, down };
