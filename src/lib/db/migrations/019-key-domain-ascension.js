/**
 * Migration 019: key domain ascension — tiers, request caps, balance economy
 * (v0.9.24, Key Domain Ascension plan §W1)
 *
 * The Key Domain Ascension's data seam (Stillwater Mirror, sealed plan):
 *   1. keyTiers        — saved ACL+limits presets with snapshot semantics
 *                        (a tier's ACL/limits are COPIED into the key row at
 *                        mint/apply time; editing a tier never silently
 *                        changes live keys — the operator re-syncs explicitly)
 *   2. apiKeys         — +tierId, +requestCapDaily, +balanceCents
 *   3. redemptions     — the spendable-balance economy (one-api redemption
 *                        codes): batch-minted credit codes, single-use by
 *                        default, atomic redeem → key balance credit
 *
 * SCHEMA_VERSION moves 18 → 19 (Covenant M1 — both numbers move together).
 *
 * ADAPTER CONTRACT (v0.9.20 lesson): run/get/all/exec/transaction — NO raw
 * prepare(). All statements below use db.exec / db.all / db.run exactly like
 * migration 002/013/016.
 *
 * Idempotency: every statement is guarded (IF NOT EXISTS / PRAGMA presence
 * checks) so a crash between DDL and version-meta re-runs cleanly (H2).
 */

const TABLES_DDL = [
  // Saved key-configuration tiers. aclJson/limitsJson hold CONFIGURATION
  // (never secrets); snapshot semantics per the sealed plan. builtIn rows are
  // immutable at repo level; isDefault singles out the create-form default.
  `CREATE TABLE IF NOT EXISTS keyTiers (
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
  )`,
  `CREATE INDEX IF NOT EXISTS idx_key_tiers_default ON keyTiers(isDefault)`,
  `CREATE INDEX IF NOT EXISTS idx_key_tiers_builtin ON keyTiers(builtIn)`,

  // Spendable-balance economy — batch-minted credit codes. amountCents is the
  // credit; maxUses/remainingUses bound redemptions (single-use by default);
  // redeemedByKeyId/redeemedAt record the last redemption. Codes are unique
  // by construction and shown once at mint.
  `CREATE TABLE IF NOT EXISTS redemptions (
    id               TEXT PRIMARY KEY,
    code             TEXT NOT NULL UNIQUE,
    amountCents      INTEGER NOT NULL,
    note             TEXT,
    maxUses          INTEGER NOT NULL DEFAULT 1,
    remainingUses    INTEGER NOT NULL DEFAULT 1,
    expiresAt        TEXT,
    createdAt        TEXT NOT NULL,
    createdBy        TEXT,
    redeemedByKeyId  TEXT,
    redeemedAt       TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_redemptions_created ON redemptions(createdAt DESC)`,
];

/** Guarded ALTERs — a crash between DDL and version-meta re-runs cleanly. */
function ensureColumn(db, table, column, ddl) {
  const cols = db.all(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) db.exec(ddl);
}

const up = (db) => {
  for (const ddl of TABLES_DDL) db.exec(ddl);

  // apiKeys additions — all nullable (no existing row breaks; NULL = unset).
  ensureColumn(db, "apiKeys", "tierId", `ALTER TABLE apiKeys ADD COLUMN tierId TEXT`);
  ensureColumn(db, "apiKeys", "requestCapDaily", `ALTER TABLE apiKeys ADD COLUMN requestCapDaily INTEGER`);
  ensureColumn(db, "apiKeys", "balanceCents", `ALTER TABLE apiKeys ADD COLUMN balanceCents INTEGER`);

  // Seed built-in tiers — guarded by count so re-runs never duplicate.
  const existing = db.all(`SELECT COUNT(*) AS n FROM keyTiers WHERE builtIn = 1`);
  if (!existing.length || existing[0].n === 0) {
    const now = new Date().toISOString();
    const seed = (name, description, acl, limits, isDefault) => {
      db.run(
        `INSERT OR IGNORE INTO keyTiers
           (id, name, description, aclJson, limitsJson, categoryDefault, builtIn, isDefault, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?, ?)`,
        [`builtin-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, description,
          acl ? JSON.stringify(acl) : null, limits ? JSON.stringify(limits) : null,
          isDefault ? 1 : 0, now, now]
      );
    };
    seed("Default", "The standard tier — broad access, generous caps.", {
      allowedKinds: ["llm", "embedding", "image", "webSearch", "webFetch", "tts", "stt", "video", "web"],
      allowedProviders: null,
      allowedCombos: null,
      allowedModels: null,
    }, {
      rateLimitRpm: 60,
      tokenBudget: 1_000_000,
      budgetScope: "daily",
      spendCapCents: null,
      requestCapDaily: null,
      expiresAt: null,
      ipAllowlist: null,
    }, true);
    seed("Power User", "High RPM, no token cap — for heavy local coding.", {
      allowedKinds: null,
      allowedProviders: null,
      allowedCombos: null,
      allowedModels: null,
    }, {
      rateLimitRpm: 600,
      tokenBudget: null,
      budgetScope: "daily",
      spendCapCents: null,
      requestCapDaily: null,
      expiresAt: null,
      ipAllowlist: null,
    }, false);
    seed("Guest", "Scoped + capped — share with friends.", {
      allowedKinds: ["llm", "web"],
      allowedProviders: null,
      allowedCombos: null,
      allowedModels: null,
    }, {
      rateLimitRpm: 15,
      tokenBudget: 100_000,
      budgetScope: "daily",
      spendCapCents: 50,
      requestCapDaily: 200,
      expiresAt: null,
      ipAllowlist: null,
    }, false);
  }
};

const down = (db) => {
  // Rollback path — drop the two new tables and the three apiKeys columns.
  // The sqlite adapter surface has no DROP COLUMN in older versions; the
  // columns are additive + nullable, so a full rollback recreates apiKeys.
  db.exec(`DROP TABLE IF EXISTS redemptions`);
  db.exec(`DROP TABLE IF EXISTS keyTiers`);
  try {
    db.exec(`ALTER TABLE apiKeys DROP COLUMN tierId`);
    db.exec(`ALTER TABLE apiKeys DROP COLUMN requestCapDaily`);
    db.exec(`ALTER TABLE apiKeys DROP COLUMN balanceCents`);
  } catch {
    /* DROP COLUMN unsupported on this adapter — columns stay, harmless + nullable */
  }
};

export default { version: 19, name: "key-domain-ascension", up, down };
export { up, down };
