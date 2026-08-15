// Storage Covenant Wave B4 — the sqlite backupRepo data twin.
// B1 relocated exportDb/importDb here; B2 layered S1/S2 + the engine; B4 lifts
// the posture-independent ENGINE (crypto/artifacts/fs/drill/retention) into
// repos/backupEngine.js. This module is now the sqlite DATA twin: exportDb /
// importDb / writeLedger / listBackupLedger / purgeOldUsage — the statements
// the parity suite proves against the mysql twin (criterion 7).
//
// S1 — restore is a trust crossing. importDb() treats the payload as HOSTILE:
// max-payload bounds + shape validation BEFORE any write; RESTORE-QUARANTINED
// fields restore only under an explicit adoptSecrets flag; the DEFAULT
// preserves CURRENT values (captured pre-wipe, stitched back).
// S2 — secret-field redaction BELOW the completeness law (repos/backupSecurity.js).
// S3 — backupLedger + the future outbox excluded from exportDb BY NAME.
//
// The engine surface is re-exported so callers that import this module keep
// working unchanged.
import crypto from "node:crypto";
import { getAdapter } from "../../driver.js";
import { stringifyJson, parseJson } from "../../helpers/jsonCol.js";
import { tombstoneLegacyKeys } from "../../migrations/002-apikey-governance.js";
import { SCHEMA_VERSION } from "../../schema.js";
import { getDbMode } from "../bind.js";
import {
  quarantineSettingsPayload,
  quarantineKeyRow,
  RESTORE_QUARANTINED_SETTING_KEYS,
} from "../backupSecurity.js";

// The engine — re-exported for backward-compatible imports.
export {
  runBackup,
  restoreBackup,
  runRestoreDrill,
  pruneBackupArtifacts,
  sealArtifact,
  openArtifact,
  getBackupEncryptionKey,
  artifactsDir,
  findLatestArtifact,
  captureSecretBundle,
  restoreSecretBundle,
} from "../backupEngine.js";

// S1 bounds + S3 exclusions (identical law to the mysql twin).
export const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;
export const EXPORT_EXCLUDED_TABLES = ["backupLedger", "outbox", "mirrorSeq"];

// ─── exportDb — completeness + S2 redaction + S3 exclusions ──────────────
export async function exportDb({ includeRequestDetails = false } = {}) {
  const db = await getAdapter();
  const { exportSettings } = await import("../settingsRepo.js");
  const settings = await exportSettings(); // S2 — redacted at the source

  let tables;
  db.transaction(() => {
    tables = {
      providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({
        id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt,
        keyVersion: r.keyVersion ?? null, keyHash: r.keyHash ?? null, keyPrefix: r.keyPrefix ?? null,
        description: r.description ?? null, allowedModels: r.allowedModels ?? null,
        isInternal: r.isInternal === 1 || r.isInternal === true, deletedAt: r.deletedAt ?? null,
        expiresAt: r.expiresAt ?? null, lastUsedAt: r.lastUsedAt ?? null,
        rotatedFrom: r.rotatedFrom ?? null, rotationPrevHash: r.rotationPrevHash ?? null,
        rotationPrevKeyId: r.rotationPrevKeyId ?? null, rotationGraceUntil: r.rotationGraceUntil ?? null,
        tokenBudgetDaily: r.tokenBudgetDaily ?? null, spendCapDailyCents: r.spendCapDailyCents ?? null,
        budgetScope: r.budgetScope ?? null, rateLimitRpm: r.rateLimitRpm ?? null, ipAllowlist: r.ipAllowlist ?? null,
        category: r.category ?? null,
      })),
      combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
      usageHistory: db.all(`SELECT * FROM usageHistory ORDER BY id ASC`).map((r) => ({
        id: r.id, timestamp: r.timestamp,
        provider: r.provider || null, model: r.model || null,
        connectionId: r.connectionId || null,
        apiKey: null,
        keyId: r.keyId || null, keyPrefix: r.keyPrefix, endpoint: r.endpoint,
        promptTokens: r.promptTokens, completionTokens: r.completionTokens,
        cost: r.cost, status: r.status, tokens: parseJson(r.tokens, null), meta: parseJson(r.meta, null),
      })),
      usageDaily: db.all(`SELECT * FROM usageDaily ORDER BY dateKey ASC`).map((r) => ({ dateKey: r.dateKey, data: parseJson(r.data, {}) })),
      // S3 — backupLedger + outbox EXCLUDED BY NAME (EXPORT_EXCLUDED_TABLES).
    };

    if (includeRequestDetails) {
      tables.requestDetails = db.all(`SELECT * FROM requestDetails ORDER BY timestamp DESC`).map((r) => ({
        id: r.id, timestamp: r.timestamp, provider: r.provider, model: r.model,
        connectionId: r.connectionId, status: r.status, data: parseJson(r.data, {}),
      }));
    }
  });

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

  return {
    settings,
    ...tables,
    kvScopes,
    modelAliases: kvScopes.modelAliases || {},
    customModels: Object.values(kvScopes.customModels || {}),
    mitmAlias: kvScopes.mitmAlias || {},
    pricing: kvScopes.pricing || {},
    pricingSync: kvScopes.pricing_sync || {},
    disabledModels: kvScopes.disabledModels || {},
    _meta: {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      sourceDriver: db.driver,
      sourceMode: getDbMode(),
    },
  };
}

// ─── importDb — S1 trust crossing ────────────────────────────────────────
// adoptSecrets  — restore the payload's RESTORE-QUARANTINED settings + key
//                 identity (hostile-input restore; requires re-confirm).
// adoptKeys     — Wave C4 mirror full-resync: adopt the payload's KEY identity
//                 (keyHash/isInternal/deletedAt) while settings still ride the
//                 safe quarantine path. A primary→twin resync is the primary's
//                 own truth flowing to its replica — NOT hostile input — so key
//                 identity must land verbatim or key-gated traffic breaks. The
//                 twin's mirror-minted rows use `mirror:${keyHash}` ids, so the
//                 by-id quarantine re-stitch would otherwise null the keyHash.
export async function importDb(payload, { adoptSecrets = false, adoptKeys = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`[backup] payload exceeds the ${MAX_PAYLOAD_BYTES}-byte restore bound (S1)`);
  }
  const TABLE_FIELDS = [
    "providerConnections", "providerNodes", "proxyPools", "apiKeys",
    "combos", "usageHistory", "usageDaily", "requestDetails",
  ];
  for (const f of TABLE_FIELDS) {
    if (payload[f] !== undefined && !Array.isArray(payload[f])) {
      throw new Error(`[backup] payload field "${f}" must be an array (S1 shape bound)`);
    }
  }
  if (payload.settings !== undefined && (typeof payload.settings !== "object" || Array.isArray(payload.settings))) {
    throw new Error("[backup] payload field \"settings\" must be an object (S1 shape bound)");
  }

  const db = await getAdapter();

  let currentQuarantined = { settings: {}, keys: new Map() };
  if (!adoptSecrets) {
    const curSettings = db.get(`SELECT data FROM settings WHERE id = 1`);
    const curSettingsObj = curSettings ? parseJson(curSettings.data, {}) : {};
    for (const k of RESTORE_QUARANTINED_SETTING_KEYS) {
      if (k in curSettingsObj) currentQuarantined.settings[k] = curSettingsObj[k];
    }
    for (const r of db.all(`SELECT id, keyHash, isInternal, deletedAt FROM apiKeys`)) {
      currentQuarantined.keys.set(r.id, {
        keyHash: r.keyHash ?? null,
        isInternal: r.isInternal === 1 || r.isInternal === true,
        deletedAt: r.deletedAt ?? null,
      });
    }
  }

  const settingsToRestore = adoptSecrets
    ? payload.settings
    : quarantineSettingsPayload(payload.settings);
  const keysToRestore = (payload.apiKeys || []).map((k) =>
    adoptSecrets || adoptKeys ? k : quarantineKeyRow(k)
  );

  db.transaction(() => {
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

    if (settingsToRestore) {
      const merged = adoptSecrets
        ? settingsToRestore
        : { ...settingsToRestore, ...currentQuarantined.settings };
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(merged)]);
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
    for (const k of keysToRestore) {
      const cur = adoptSecrets || adoptKeys ? null : currentQuarantined.keys.get(k.id);
      const keyHash = adoptSecrets || adoptKeys ? (k.keyHash ?? null) : (cur?.keyHash ?? null);
      const isInternal = adoptSecrets || adoptKeys ? (k.isInternal === true || k.isInternal === 1) : (cur?.isInternal ?? false);
      const deletedAt = adoptSecrets || adoptKeys ? (k.deletedAt ?? null) : (cur?.deletedAt ?? null);
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
          k.keyVersion ?? null, keyHash, k.keyPrefix ?? null,
          k.description ?? null, k.allowedModels ?? null,
          isInternal ? 1 : 0, deletedAt,
          k.expiresAt ?? null, k.lastUsedAt ?? null,
          k.rotatedFrom ?? null, k.rotationPrevHash ?? null, k.rotationPrevKeyId ?? null, k.rotationGraceUntil ?? null,
          k.tokenBudgetDaily ?? null, k.spendCapDailyCents ?? null, k.budgetScope ?? null,
          k.rateLimitRpm ?? null, k.ipAllowlist ?? null, k.category ?? null,
        ]
      );
    }
    tombstoneLegacyKeys(db);
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }

    const kvRows = [];
    if (payload.kvScopes && typeof payload.kvScopes === "object") {
      for (const [scope, entries] of Object.entries(payload.kvScopes)) {
        if (!entries || typeof entries !== "object") continue;
        for (const [key, value] of Object.entries(entries)) kvRows.push([scope, key, value]);
      }
    } else {
      for (const [a, m] of Object.entries(payload.modelAliases || {})) kvRows.push(["modelAliases", a, m]);
      for (const m of payload.customModels || []) {
        kvRows.push(["customModels", `${m.providerAlias}|${m.id}|${m.type || "llm"}`, m]);
      }
      for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) kvRows.push(["mitmAlias", tool, mappings]);
      for (const [provider, models] of Object.entries(payload.pricing || {})) kvRows.push(["pricing", provider, models]);
      for (const [provider, models] of Object.entries(payload.pricingSync || {})) kvRows.push(["pricing_sync", provider, models]);
      for (const [providerAlias, models] of Object.entries(payload.disabledModels || {})) kvRows.push(["disabledModels", providerAlias, models]);
    }
    for (const [scope, key, value] of kvRows) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES(?, ?, ?)`, [scope, key, stringifyJson(value)]);
    }

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

export async function initDb() {
  await getAdapter();
}

export async function writeLedger(kind, fields = {}) {
  try {
    const db = await getAdapter();
    db.run(
      `INSERT INTO backupLedger(id, createdAt, kind, status, artifactId, sizeBytes, schemaVersion, sourceMode, targetMode, error, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        new Date().toISOString(),
        kind,
        fields.status || "ok",
        fields.artifactId ?? null,
        fields.sizeBytes ?? null,
        fields.schemaVersion ?? null,
        fields.sourceMode ?? null,
        fields.targetMode ?? null,
        fields.error ? String(fields.error).slice(0, 500) : null,
        stringifyJson(fields.meta ?? null),
      ]
    );
  } catch (err) {
    console.warn("[backup] ledger write failed (fail-open):", err?.message);
  }
}

export async function listBackupLedger({ limit = 50, offset = 0 } = {}) {
  const db = await getAdapter();
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const off = Math.max(0, Number(offset) || 0);
  return db
    .all(`SELECT * FROM backupLedger ORDER BY createdAt DESC, id LIMIT ? OFFSET ?`, [lim, off])
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      kind: r.kind,
      status: r.status,
      artifactId: r.artifactId ?? null,
      sizeBytes: r.sizeBytes ?? null,
      schemaVersion: r.schemaVersion ?? null,
      sourceMode: r.sourceMode ?? null,
      targetMode: r.targetMode ?? null,
      meta: parseJson(r.meta, null),
      // S4 — error omitted from every ledger surface.
    }));
}

export async function purgeOldUsage({ retentionDays = Number(process.env.VELA_USAGE_RETENTION_DAYS ?? 90) } = {}) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return { purged: false, usageHistory: 0, requestDetails: 0 };
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const db = await getAdapter();
  const BATCH = 5000;
  let usageRemoved = 0;
  let detailsRemoved = 0;
  for (;;) {
    const r = db.run(`DELETE FROM usageHistory WHERE id IN (SELECT id FROM usageHistory WHERE timestamp < ? LIMIT ?)`, [cutoff, BATCH]);
    const n = r.changes ?? 0;
    usageRemoved += n;
    if (n < BATCH) break;
  }
  for (;;) {
    const r = db.run(`DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails WHERE timestamp < ? LIMIT ?)`, [cutoff, BATCH]);
    const n = r.changes ?? 0;
    detailsRemoved += n;
    if (n < BATCH) break;
  }
  await writeLedger("purge", {
    meta: { retentionDays: days, cutoff, usageHistory: usageRemoved, requestDetails: detailsRemoved },
  });
  return { purged: true, usageHistory: usageRemoved, requestDetails: detailsRemoved };
}
