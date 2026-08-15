// Storage Covenant Wave B1 — the sqlite backupRepo harbor.
// Plan line 420: exportDb/importDb/initDb move out of the raw-SQL barrel into
// repos/sqlite/backupRepo.js (+ repos/mysql/backupRepo.js twin behind the
// facade bind) — restore-into-any-posture dispatches through the SAME contract.
//
// This is the sqlite implementation, relocated VERBATIM from src/lib/db/index.js
// (the staged barrel debt). The posture gate (assertHarborBound) now lives in
// the facade (repos/backupRepo.js), so this module is pure sqlite SQL.
//
// Export completeness law (Storage Covenant Wave A3, plans/storage-covenant.md):
// exportDb() covers EVERY table in TABLES and EVERY kv scope. The kv export is
// GENERIC — it enumerates `SELECT DISTINCT scope FROM kv` rather than a
// hardcoded scope list — so a newly added scope flows into every
// artifact/resync by construction instead of being lost on import.
//
// `requestDetails` is opt-in (observability log, large, reproducible).
// The `_meta` field is export PROVENANCE — {schemaVersion, exportedAt,
// sourceDriver, sourceMode}.
//
// S1 restore-quarantine + S2 secret redaction are layered on top by the
// backup engine (Wave B) — see repos/backupRepo.js.
import { getAdapter } from "../../driver.js";
import { stringifyJson, parseJson } from "../../helpers/jsonCol.js";
import { tombstoneLegacyKeys } from "../../migrations/002-apikey-governance.js";
import { SCHEMA_VERSION } from "../../schema.js";
import { getDbMode } from "../bind.js";

export async function exportDb({ includeRequestDetails = false } = {}) {
  const db = await getAdapter();
  const { exportSettings } = await import("../settingsRepo.js");
  const settings = await exportSettings();

  // One read transaction so the table snapshot is not torn by concurrent
  // writes (Performance fix, plans line 444).
  let tables;
  db.transaction(() => {
    tables = {
      providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      // keyHash (never the raw key) is the identity; the legacy `key` column
      // holds sentinels only post-W1 but must survive for UNIQUE NOT NULL.
      apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({
        id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt,
        // Governance columns — must survive backup/restore (plan §3.7)
        keyVersion: r.keyVersion ?? null, keyHash: r.keyHash ?? null, keyPrefix: r.keyPrefix ?? null,
        description: r.description ?? null, allowedModels: r.allowedModels ?? null,
        isInternal: r.isInternal === 1 || r.isInternal === true, deletedAt: r.deletedAt ?? null,
        expiresAt: r.expiresAt ?? null, lastUsedAt: r.lastUsedAt ?? null,
        rotatedFrom: r.rotatedFrom ?? null, rotationPrevHash: r.rotationPrevHash ?? null,
        rotationPrevKeyId: r.rotationPrevKeyId ?? null, rotationGraceUntil: r.rotationGraceUntil ?? null,
        tokenBudgetDaily: r.tokenBudgetDaily ?? null, spendCapDailyCents: r.spendCapDailyCents ?? null,
        budgetScope: r.budgetScope ?? null, rateLimitRpm: r.rateLimitRpm ?? null, ipAllowlist: r.ipAllowlist ?? null,
        // Free-form key category (migration 003) — must survive restore
        category: r.category ?? null,
      })),
      combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
      usageHistory: db.all(`SELECT * FROM usageHistory ORDER BY id ASC`).map((r) => ({
        id: r.id, timestamp: r.timestamp,
        // Dedupe columns store '' as "unset" from migration 004 onward —
        // normalize back to null so artifact shapes are unchanged.
        provider: r.provider || null, model: r.model || null,
        connectionId: r.connectionId || null,
        // The legacy plaintext apiKey column is banned from artifacts.
        apiKey: null,
        keyId: r.keyId || null, keyPrefix: r.keyPrefix, endpoint: r.endpoint,
        promptTokens: r.promptTokens, completionTokens: r.completionTokens,
        cost: r.cost, status: r.status, tokens: parseJson(r.tokens, null), meta: parseJson(r.meta, null),
      })),
      usageDaily: db.all(`SELECT * FROM usageDaily ORDER BY dateKey ASC`).map((r) => ({ dateKey: r.dateKey, data: parseJson(r.data, {}) })),
    };

    if (includeRequestDetails) {
      tables.requestDetails = db.all(`SELECT * FROM requestDetails ORDER BY timestamp DESC`).map((r) => ({
        id: r.id, timestamp: r.timestamp, provider: r.provider, model: r.model,
        connectionId: r.connectionId, status: r.status, data: parseJson(r.data, {}),
      }));
    }
  });

  // Generic-scope kv export — every scope, no hardcoded list. This is the
  // completeness law's core: disabledModels (and any future scope) is covered
  // by construction.
  const kvScopes = {};
  db.transaction(() => {
    for (const { scope } of db.all(`SELECT DISTINCT scope FROM kv ORDER BY scope ASC`)) {
      const entries = {};
      for (const r of db.all(`SELECT key, value FROM kv WHERE scope = ? ORDER BY key ASC`, [scope])) {
        entries[r.key] = parseJson(r.value, null);
      }
      kvScopes[scope] = entries;
    }
  });

  const out = {
    settings,
    ...tables,
    kvScopes,
    // Legacy named kv views — kept so pre-A3 consumers keep working.
    modelAliases: kvScopes.modelAliases || {},
    customModels: Object.values(kvScopes.customModels || {}),
    mitmAlias: kvScopes.mitmAlias || {},
    pricing: kvScopes.pricing || {},
    pricingSync: kvScopes.pricing_sync || {},
    disabledModels: kvScopes.disabledModels || {},
    // Export provenance
    _meta: {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      sourceDriver: db.driver,
      sourceMode: getDbMode(),
    },
  };

  return out;
}

export async function importDb(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const db = await getAdapter();

  db.transaction(() => {
    // Wipe all data tables (keep _meta — migration-internal state is not
    // round-tripped). importDb is a FULL restore: wipe, then restore.
    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM kv`);
    db.run(`DELETE FROM usageHistory`);
    db.run(`DELETE FROM usageDaily`);
    db.run(`DELETE FROM requestDetails`);

    // Settings
    if (payload.settings) {
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of payload.apiKeys || []) {
      db.run(
        `INSERT OR REPLACE INTO apiKeys(
          id, key, name, machineId, isActive, createdAt,
          keyVersion, keyHash, keyPrefix, description, allowedModels, isInternal, deletedAt,
          expiresAt, lastUsedAt, rotatedFrom, rotationPrevHash, rotationPrevKeyId, rotationGraceUntil,
          tokenBudgetDaily, spendCapDailyCents, budgetScope, rateLimitRpm, ipAllowlist, category
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          k.id, k.key || `restored-${k.id}`, k.name || null, k.machineId || null,
          k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(),
          k.keyVersion ?? null, k.keyHash ?? null, k.keyPrefix ?? null,
          k.description ?? null, k.allowedModels ?? null,
          k.isInternal === true || k.isInternal === 1 ? 1 : 0, k.deletedAt ?? null,
          k.expiresAt ?? null, k.lastUsedAt ?? null,
          k.rotatedFrom ?? null, k.rotationPrevHash ?? null, k.rotationPrevKeyId ?? null, k.rotationGraceUntil ?? null,
          k.tokenBudgetDaily ?? null, k.spendCapDailyCents ?? null, k.budgetScope ?? null,
          k.rateLimitRpm ?? null, k.ipAllowlist ?? null, k.category ?? null,
        ]
      );
    }
    // Legacy-import closure (same law as migrate.js): a pre-W1 payload may carry
    // plaintext sk- keys in the legacy column — tombstone them inside this transaction.
    tombstoneLegacyKeys(db);
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }

    // kv restore: prefer the generic kvScopes map; fall back to the legacy
    // named fields for pre-A3 payloads.
    const kvRows = [];
    if (payload.kvScopes && typeof payload.kvScopes === "object") {
      for (const [scope, entries] of Object.entries(payload.kvScopes)) {
        if (!entries || typeof entries !== "object") continue;
        for (const [key, value] of Object.entries(entries)) {
          kvRows.push([scope, key, value]);
        }
      }
    } else {
      for (const [a, m] of Object.entries(payload.modelAliases || {})) kvRows.push(["modelAliases", a, m]);
      for (const m of payload.customModels || []) {
        const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
        kvRows.push(["customModels", k, m]);
      }
      for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) kvRows.push(["mitmAlias", tool, mappings]);
      for (const [provider, models] of Object.entries(payload.pricing || {})) kvRows.push(["pricing", provider, models]);
      for (const [provider, models] of Object.entries(payload.pricingSync || {})) kvRows.push(["pricing_sync", provider, models]);
      for (const [providerAlias, models] of Object.entries(payload.disabledModels || {})) kvRows.push(["disabledModels", providerAlias, models]);
    }
    for (const [scope, key, value] of kvRows) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES(?, ?, ?)`, [scope, key, stringifyJson(value)]);
    }

    // Usage ledger restore (completeness law) — idempotent upserts preserve ids.
    // Dedupe columns write '' as "unset" (migration 004 contract).
    for (const h of payload.usageHistory || []) {
      db.run(
        `INSERT OR REPLACE INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [h.id, h.timestamp, h.provider || "", h.model || "", h.connectionId || "", h.keyId || "", h.keyPrefix ?? null, h.endpoint ?? null, h.promptTokens ?? 0, h.completionTokens ?? 0, h.cost ?? 0, h.status ?? null, stringifyJson(h.tokens ?? null), stringifyJson(h.meta ?? null)]
      );
    }
    for (const d of payload.usageDaily || []) {
      db.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [d.dateKey, stringifyJson(d.data ?? {})]);
    }
    if (Array.isArray(payload.requestDetails)) {
      for (const rd of payload.requestDetails) {
        db.run(
          `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [rd.id, rd.timestamp, rd.provider ?? null, rd.model ?? null, rd.connectionId ?? null, rd.status ?? null, stringifyJson(rd.data ?? {})]
        );
      }
    }
  });

  return await exportDb({ includeRequestDetails: Array.isArray(payload.requestDetails) });
}

// Eager init helper (optional) — warms the sqlite adapter.
export async function initDb() {
  await getAdapter();
}
