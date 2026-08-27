/**
 * Migration 016: key governance v2 — Endpoint Observatory (v0.9.25)
 *
 * The Governance Center's data seam (Shorekeeper-Sealed Plan §W1):
 *   1. keyTemplates     — saved key-configuration presets (builtIn-immutable)
 *   2. keyTags          — free-form tags per key (plain table, app-level scrub,
 *                         NO FK cascade — see Covenant M5: the app scrub owns
 *                         referential cleanup so mirror/outbox/ledger stay coherent)
 *   3. key_mutation_ledger — append-only attribution ledger written at the
 *                         mintKey() chokepoint (Covenant S3)
 *
 * SCHEMA_VERSION moves 14 → 15 (Covenant M1 — both numbers move together).
 *
 * ADAPTER CONTRACT (learned the hard way, v0.9.19/20/22 boot storms): the
 * adapter surface is run/get/all/exec/transaction — NO raw prepare(). Use
 * db.all(`PRAGMA table_info(...)`) + db.exec(...) exactly like migration 002/013.
 *
 * Idempotency: every statement is guarded (IF NOT EXISTS / PRAGMA presence
 * checks) so a crash between DDL and version-meta re-runs cleanly (Covenant H2).
 */

const TABLES_DDL = [
  // Saved key-configuration presets. aclJson/limitsJson hold CONFIGURATION,
  // never secrets (Covenant: hash-at-rest; no new column stores key material).
  `CREATE TABLE IF NOT EXISTS keyTemplates (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL UNIQUE,
    description      TEXT,
    aclJson          TEXT,
    limitsJson       TEXT,
    categoryDefault  TEXT,
    builtIn          INTEGER NOT NULL DEFAULT 0,
    createdAt        TEXT NOT NULL,
    updatedAt        TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_key_templates_builtin ON keyTemplates(builtIn)`,

  // Free-form per-key tags. Plain table — referential cleanup is application
  // level (deleteWithScrub in apiKeysRepo), NOT FK cascade (Covenant M5).
  `CREATE TABLE IF NOT EXISTS keyTags (
    keyId     TEXT NOT NULL,
    tag       TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    PRIMARY KEY (keyId, tag)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_key_tags_tag ON keyTags(tag)`,

  // Append-only key-mutation ledger — attribution for every mint/rotate/
  // revoke/duplicate/revive/import/template-apply (Covenant S3). Written at
  // the mintKey() chokepoint; never edited after insert.
  `CREATE TABLE IF NOT EXISTS key_mutation_ledger (
    id         TEXT PRIMARY KEY,
    surface    TEXT NOT NULL,
    keyId      TEXT,
    sourceRowId TEXT,
    outcome    TEXT NOT NULL,
    actorClass TEXT NOT NULL,
    createdAt  TEXT NOT NULL,
    detail     TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_created ON key_mutation_ledger(createdAt)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_key ON key_mutation_ledger(keyId)`,
];

/**
 * Seed four built-in templates. Guarded so re-runs never duplicate.
 * builtIn = 1 rows are immutable at repo level (update/delete → 409).
 */
const BUILTIN_TEMPLATES = [
  {
    name: "Blank",
    description: "No preset configuration — every field unrestricted.",
    aclJson: null,
    limitsJson: null,
    categoryDefault: null,
  },
  {
    name: "Claude Code Workstation",
    description: "LLM + webFetch, 60 RPM, 1M tokens/day.",
    aclJson: JSON.stringify({ allowedKinds: ["llm", "web"], allowedProviders: null, allowedCombos: null, allowedModels: null }),
    limitsJson: JSON.stringify({ rateLimitRpm: 60, tokenBudget: 1_000_000, budgetScope: "daily", spendCapCents: null, expiresAt: null, ipAllowlist: null }),
    categoryDefault: "workstation",
  },
  {
    name: "Embeddings Batch",
    description: "Embedding-only, high token cap, no spend cap.",
    aclJson: JSON.stringify({ allowedKinds: ["embedding"], allowedProviders: null, allowedCombos: null, allowedModels: null }),
    limitsJson: JSON.stringify({ rateLimitRpm: 120, tokenBudget: 5_000_000, budgetScope: "daily", spendCapCents: null, expiresAt: null, ipAllowlist: null }),
    categoryDefault: "batch",
  },
  {
    name: "Read-Only Observer",
    description: "LLM whitelist, low caps — for monitoring/read-only tools.",
    aclJson: JSON.stringify({ allowedKinds: ["llm"], allowedProviders: null, allowedCombos: null, allowedModels: null }),
    limitsJson: JSON.stringify({ rateLimitRpm: 30, tokenBudget: 200_000, budgetScope: "daily", spendCapCents: null, expiresAt: null, ipAllowlist: null }),
    categoryDefault: "observer",
  },
];

const up = (db) => {
  for (const ddl of TABLES_DDL) db.exec(ddl);

  // Seed built-ins — guarded by count so re-runs never duplicate.
  const existing = db.all(`SELECT COUNT(*) AS n FROM keyTemplates WHERE builtIn = 1`);
  if (!existing.length || existing[0].n === 0) {
    const now = new Date().toISOString();
    for (const t of BUILTIN_TEMPLATES) {
      db.run(
        `INSERT OR IGNORE INTO keyTemplates
           (id, name, description, aclJson, limitsJson, categoryDefault, builtIn, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [`builtin-${t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, t.name, t.description, t.aclJson, t.limitsJson, t.categoryDefault, now, now]
      );
    }
  }
};

const down = (db) => {
  // Rollback path: drop the three new tables. Data loss on rollback is the
  // documented standard migration covenant (H5); operator-authored templates/
  // tags are not preserved by design.
  db.exec(`DROP TABLE IF EXISTS key_mutation_ledger`);
  db.exec(`DROP TABLE IF EXISTS keyTags`);
  db.exec(`DROP TABLE IF EXISTS keyTemplates`);
};

export default { version: 16, name: "key-governance-v2", up, down };
export { up, down };
