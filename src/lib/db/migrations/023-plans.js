/**
 * Migration 023: plans — reusable key-policy templates.
 * (Ported from 9router-go `plans` / dashboard `plans.go`.)
 *
 * A plan is a TEMPLATE: assigning one to a key supplies defaults for the
 * fields a key leaves unset. The key's own columns always win where set, so a
 * plan can be tightened per key without editing the template. Deleting a plan
 * that keys still reference is refused (route-level 409), never cascaded —
 * a cascade would silently change the limits of every key on it.
 *
 * Vela's shape carries only what the legacy key gate can actually enforce:
 * token/spend budgets, a period, RPM, and a model allowlist. Go's
 * limitMicros is stored here as `spendCapCents` (Vela's cost unit) so no
 * conversion sits between the template and the gate.
 *
 * plans is replicated state (TABLES), unlike semanticCacheEntries: a template
 * edited on the primary must reach the mirror harbor.
 */

const PLANS = `
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    limitTokens INTEGER,
    spendCapCents INTEGER,
    rpmLimit INTEGER,
    period TEXT NOT NULL DEFAULT 'monthly',
    allowedModels TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`;

function existingColumns(db, table) {
  return new Set(db.all(`PRAGMA table_info(${table})`).map((r) => r.name));
}

const up = (db) => {
  db.exec(PLANS);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_name ON plans(name)`);
  if (!existingColumns(db, "apiKeys").has("planId")) {
    db.exec(`ALTER TABLE apiKeys ADD COLUMN planId TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ak_plan ON apiKeys(planId) WHERE planId IS NOT NULL`);
};

const down = (db) => {
  db.exec(`DROP INDEX IF EXISTS idx_ak_plan`);
  db.exec(`DROP INDEX IF EXISTS uq_plan_name`);
  db.exec(`DROP TABLE IF EXISTS plans`);
  // SQLite cannot drop a column on older engines; planId stays as a harmless
  // null column on downgrade, which is the safe direction.
};

const migration = { version: 23, name: "plans", up, down };
export default migration;
export { up, down };
