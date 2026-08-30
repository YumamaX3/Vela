// ⚠️ AGENT/DEV: Bump this by +1 EVERY TIME you change the schema below
// (add/remove/alter a table, column, or index in TABLES). It drives the
// pre-change safety backup in migrate.js: when the stored version is lower,
// one lightweight DB backup is taken before applying schema changes. Forgetting
// to bump only skips that backup — it does NOT break the additive auto-sync.
export const SCHEMA_VERSION = 15;

export const PRAGMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 30000000;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;

// Declarative current schema. Used by syncSchemaFromTables() to
// auto-add missing tables/columns/indexes after versioned migrations.
// For destructive changes (drop/rename/type-change), write a migration file.
export const TABLES = {
  _meta: {
    columns: {
      key: "TEXT PRIMARY KEY",
      value: "TEXT NOT NULL",
    },
  },
  settings: {
    columns: {
      id: "INTEGER PRIMARY KEY CHECK (id = 1)",
      data: "TEXT NOT NULL",
    },
  },
  providerConnections: {
    columns: {
      id: "TEXT PRIMARY KEY",
      provider: "TEXT NOT NULL",
      authType: "TEXT NOT NULL",
      name: "TEXT",
      email: "TEXT",
      priority: "INTEGER",
      isActive: "INTEGER DEFAULT 1",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider)",
      "CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority)",
    ],
  },
  providerNodes: {
    columns: {
      id: "TEXT PRIMARY KEY",
      type: "TEXT",
      name: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_pn_type ON providerNodes(type)"],
  },
  proxyPools: {
    columns: {
      id: "TEXT PRIMARY KEY",
      isActive: "INTEGER DEFAULT 1",
      testStatus: "TEXT",
      data: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pp_active ON proxyPools(isActive)",
      "CREATE INDEX IF NOT EXISTS idx_pp_status ON proxyPools(testStatus)",
    ],
  },
  apiKeys: {
    columns: {
      id: "TEXT PRIMARY KEY",
      key: "TEXT UNIQUE NOT NULL",
      name: "TEXT",
      machineId: "TEXT",
      isActive: "INTEGER DEFAULT 1",
      createdAt: "TEXT NOT NULL",
      // Governance columns (migration 002; mirrored here for fresh installs + auto-sync)
      keyVersion: "TEXT",
      keyHash: "TEXT",
      keyPrefix: "TEXT",
      description: "TEXT",
      allowedModels: "TEXT",
      // Per-key ACL (migration 013; mirrored here for fresh installs + auto-sync)
      allowedKinds: "TEXT",
      allowedProviders: "TEXT",
      allowedCombos: "TEXT",
      isInternal: "INTEGER DEFAULT 0",
      deletedAt: "TEXT",
      expiresAt: "TEXT",
      lastUsedAt: "TEXT",
      rotatedFrom: "TEXT",
      rotationPrevHash: "TEXT",
      rotationPrevKeyId: "TEXT",
      rotationGraceUntil: "TEXT",
      tokenBudgetDaily: "INTEGER",
      spendCapDailyCents: "INTEGER",
      budgetScope: "TEXT",
      rateLimitRpm: "INTEGER",
      ipAllowlist: "TEXT",
      // Free-form key category (migration 003; mirrored here for fresh installs + auto-sync)
      category: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_ak_key ON apiKeys(key)",
      // UNIQUE lives in the index list too (self-healing via auto-sync);
      // migration 002 creates it on the upgrade path where auto-sync strips UNIQUE
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_ak_key_hash ON apiKeys(keyHash)",
      // Migration 003's partial index — declared here so auto-sync can heal it
      // if it is ever dropped (plain TEXT column in TABLES cannot carry WHERE).
      "CREATE INDEX IF NOT EXISTS idx_ak_category ON apiKeys(category) WHERE category IS NOT NULL",
    ],
  },
  combos: {
    columns: {
      id: "TEXT PRIMARY KEY",
      name: "TEXT UNIQUE NOT NULL",
      kind: "TEXT",
      models: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: ["CREATE INDEX IF NOT EXISTS idx_combo_name ON combos(name)"],
  },
  kv: {
    columns: {
      scope: "TEXT NOT NULL",
      key: "TEXT NOT NULL",
      value: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (scope, key)",
    indexes: ["CREATE INDEX IF NOT EXISTS idx_kv_scope ON kv(scope)"],
  },
  usageHistory: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      timestamp: "TEXT NOT NULL",
      // Dedupe columns (migration 004): NOT NULL DEFAULT '' — '' is the
      // normalized form of "unset" so the UNIQUE dedupe index treats absent
      // values identically in SQLite and MySQL (NULLs are DISTINCT in UNIQUE
      // indexes). Fresh installs get the constraint here; upgraded DBs keep
      // nullable columns (auto-sync never alters columns) — migration 004
      // backfilled NULL→'' and writers write '' from A5 onward.
      provider: "TEXT NOT NULL DEFAULT ''",
      model: "TEXT NOT NULL DEFAULT ''",
      connectionId: "TEXT NOT NULL DEFAULT ''",
      apiKey: "TEXT", // legacy plaintext column — masked-only from W1, NULLed by migration 002
      keyId: "TEXT NOT NULL DEFAULT ''",
      keyPrefix: "TEXT",
      endpoint: "TEXT",
      promptTokens: "INTEGER DEFAULT 0",
      completionTokens: "INTEGER DEFAULT 0",
      cost: "REAL DEFAULT 0",
      status: "TEXT",
      tokens: "TEXT",
      meta: "TEXT",
      // Usage Observatory migration 008 — telemetry columns. NULL means
      // pre-instrumentation (never 0-faked); statusClass is the normalized,
      // indexable slug from src/lib/usageStatus.js ('' = unknown).
      latencyMs: "INTEGER",
      ttftMs: "INTEGER",
      httpStatus: "INTEGER",
      statusClass: "TEXT DEFAULT ''",
      // Migration 015 — combo attribution. The requested combo name when the
      // request arrived via a combo (member + judge rows carry it); NULL for
      // direct provider/model requests. NULL is safe here — combo is never
      // part of the uq_uh_dedupe identity. Declared so auto-sync + the mysql
      // bootstrap diff heal the column on fresh installs and the twin.
      combo: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_uh_ts ON usageHistory(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_uh_provider ON usageHistory(provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_model ON usageHistory(model)",
      "CREATE INDEX IF NOT EXISTS idx_uh_conn ON usageHistory(connectionId)",
      "CREATE INDEX IF NOT EXISTS idx_uh_keyId ON usageHistory(keyId)",
      // Migration 008's Observatory composites — mirror of the migration's
      // CREATE INDEX set so auto-sync heals them if ever dropped (the m004
      // uq_uh_dedupe precedent below).
      "CREATE INDEX IF NOT EXISTS idx_uh_ts_provider ON usageHistory(timestamp, provider)",
      "CREATE INDEX IF NOT EXISTS idx_uh_ts_keyId ON usageHistory(timestamp, keyId)",
      "CREATE INDEX IF NOT EXISTS idx_uh_ts_status ON usageHistory(timestamp, statusClass)",
      "CREATE INDEX IF NOT EXISTS idx_uh_ts_latency ON usageHistory(timestamp, latencyMs)",
      // Migration 015 — the per-combo aggregation path (combos page usage
      // sparklines + totals query combo within a time window).
      "CREATE INDEX IF NOT EXISTS idx_uh_combo ON usageHistory(combo, timestamp DESC)",
      // Migration 004's dedupe identity — declared here so auto-sync heals it
      // if it is ever dropped (mirrors the uq_ak_key_hash pattern in apiKeys).
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_uh_dedupe ON usageHistory(timestamp, provider, model, connectionId, keyId, promptTokens, completionTokens)",
    ],
  },
  usageDaily: {
    columns: {
      dateKey: "TEXT PRIMARY KEY",
      data: "TEXT NOT NULL",
    },
  },
  // Usage Observatory W4-A (migration 009) — saved compass views. `params`
  // is the full compass query string (tab + every facet); applying a view
  // is a plain `router.replace("?" + params)`. UNIQUE(name) lets the API
  // upsert; idx_uv_created serves the newest-first list. Declared here so
  // the mysql twin's additive TABLES diff and the backup drill both see it.
  usageViews: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      name: "TEXT NOT NULL",
      params: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
      updatedAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_uv_name ON usageViews(name)",
      "CREATE INDEX IF NOT EXISTS idx_uv_created ON usageViews(createdAt DESC)",
    ],
  },
  // Usage Observatory W4-C (migration 010) — request tags, an annotation
  // layer OVER usageHistory (no foreign key — the schema's cross-table
  // style). The ledger's batch tag lookup rides idx_urt_usageId; the
  // PUT-replace API rides uq_urt_usageId_name.
  usageRequestTags: {
    columns: {
      id: "INTEGER PRIMARY KEY AUTOINCREMENT",
      usageId: "INTEGER NOT NULL",
      name: "TEXT NOT NULL",
      createdAt: "TEXT NOT NULL",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_urt_usageId ON usageRequestTags(usageId)",
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_urt_usageId_name ON usageRequestTags(usageId, name)",
    ],
  },
  requestDetails: {
    columns: {
      id: "TEXT PRIMARY KEY",
      timestamp: "TEXT NOT NULL",
      provider: "TEXT",
      model: "TEXT",
      connectionId: "TEXT",
      status: "TEXT",
      data: "TEXT NOT NULL",
      // Migration 015 — combo attribution (NULL = direct request). Kept in
      // parity with usageHistory.combo so both ledgers tell the same story.
      combo: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_rd_ts ON requestDetails(timestamp DESC)",
      "CREATE INDEX IF NOT EXISTS idx_rd_provider ON requestDetails(provider)",
      "CREATE INDEX IF NOT EXISTS idx_rd_model ON requestDetails(model)",
      "CREATE INDEX IF NOT EXISTS idx_rd_conn ON requestDetails(connectionId)",
    ],
  },
  // Storage Covenant Wave B2 — the backup ledger. Rows record backup/restore/
  // drill events. S2 law: this table joins the export-exclusion registry — its
  // error strings carry paths/driver names/SQL errors, an information channel
  // that must never flow into an artifact or a resync.
  backupLedger: {
    columns: {
      id: "TEXT PRIMARY KEY",
      createdAt: "TEXT NOT NULL",
      kind: "TEXT NOT NULL", // backup | restore | drill | purge | failed
      status: "TEXT NOT NULL", // ok | failed
      artifactId: "TEXT",
      sizeBytes: "INTEGER",
      schemaVersion: "INTEGER",
      sourceMode: "TEXT",
      targetMode: "TEXT",
      error: "TEXT", // metadata-only surface; never leaves the ledger (S2)
      meta: "TEXT",
    },
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_bl_created ON backupLedger(createdAt DESC)",
    ],
  },
  // Proxy Covenant — migration 011. fitness table for fleet intelligence.
  // PK = (poolId, provider) per decree C14. unfitUntil TTL enables geo-blocks
  // that self-heal. egressCountry seeded by probes and stamped on country_blocked.
  // joins TABLES for export completeness + mysql twin DDL via bootstrap diff.
  proxyFitness: {
    columns: {
      poolId: "TEXT NOT NULL",
      provider: "TEXT NOT NULL DEFAULT ''",
      successCount: "INTEGER NOT NULL DEFAULT 0",
      failureCount: "INTEGER NOT NULL DEFAULT 0",
      successEwma: "REAL NOT NULL DEFAULT 0.5",
      latencyEwmaMs: "INTEGER NOT NULL DEFAULT 0",
      lastOutcomeAt: "TEXT",
      unfit: "INTEGER NOT NULL DEFAULT 0",
      unfitReason: "TEXT",
      unfitUntil: "TEXT",
      egressIp: "TEXT",
      egressCountry: "TEXT",
      updatedAt: "TEXT NOT NULL",
    },
    primaryKey: "PRIMARY KEY (poolId, provider)",
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_pf_pool ON proxyFitness(poolId)",
    ],
  },
};

export function buildCreateTableSql(name, def) {
  const cols = Object.entries(def.columns).map(([k, v]) => `${k} ${v}`);
  if (def.primaryKey) cols.push(def.primaryKey);
  return `CREATE TABLE IF NOT EXISTS ${name} (${cols.join(", ")})`;
}
