// Storage Covenant Wave B4 — the mysql twin of sqlite/backupRepo.js.
// Plan line 284: "MySQL posture: JSON export is the artifact (engine-portable
// by construction)" — the SAME exportDb payload shape serves both engines, so
// a restore can cross postures. The data twins here mirror the sqlite harbor
// statement-for-statement in MySQL dialect; the S1/S2 security layers ride the
// SHARED pure functions in repos/backupSecurity.js (no drift between twins).
//
// Dialect rules (Wave A forge law): `key` backticked; ON DUPLICATE KEY UPDATE
// col = VALUES(col) (MariaDB compat); Number() normalization where BIGINT may
// surface; connection-bound transactions; the purge DELETE rides native LIMIT.
import { getMysqlAdapter } from "../../mysql/adapter.js";
import { stringifyJson, parseJson } from "../../helpers/jsonCol.js";
import { SCHEMA_VERSION } from "../../schema.js";
import { getDbMode } from "../bind.js";
import {
  quarantineSettingsPayload,
  quarantineKeyRow,
  RESTORE_QUARANTINED_SETTING_KEYS,
} from "../backupSecurity.js";

// S1 bounds + S3 exclusions — identical law to the sqlite twin.
export const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;
export const EXPORT_EXCLUDED_TABLES = ["backupLedger", "outbox"];

export async function exportDb({ includeRequestDetails = false } = {}) {
  const db = await getMysqlAdapter();
  const { exportSettings } = await import("./settingsRepo.js");
  const settings = await exportSettings(); // S2 — redacted at the source

  const tables = {
    providerConnections: (await db.all(`SELECT * FROM providerConnections`)).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1 || r.isActive === true, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: (await db.all(`SELECT * FROM providerNodes`)).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: (await db.all(`SELECT * FROM proxyPools`)).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1 || r.isActive === true, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    apiKeys: (await db.all(`SELECT * FROM apiKeys`)).map((r) => ({
      id: r.id, key: r.key, name: r.name, machineId: r.machineId, isActive: r.isActive === 1 || r.isActive === true, createdAt: r.createdAt,
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
    combos: (await db.all(`SELECT * FROM combos`)).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    usageHistory: (await db.all(`SELECT * FROM usageHistory ORDER BY id ASC`)).map((r) => ({
      id: r.id, timestamp: r.timestamp,
      // '' is the normalized "unset" form on BOTH engines (migration 004 law).
      provider: r.provider || null, model: r.model || null,
      connectionId: r.connectionId || null,
      apiKey: null, // legacy plaintext column banned from artifacts
      keyId: r.keyId || null, keyPrefix: r.keyPrefix, endpoint: r.endpoint,
      promptTokens: Number(r.promptTokens ?? 0), completionTokens: Number(r.completionTokens ?? 0),
      cost: r.cost == null ? null : Number(r.cost), status: r.status,
      tokens: parseJson(r.tokens, null), meta: parseJson(r.meta, null),
    })),
    usageDaily: (await db.all(`SELECT * FROM usageDaily ORDER BY dateKey ASC`)).map((r) => ({ dateKey: r.dateKey, data: parseJson(r.data, {}) })),
    // S3 — backupLedger + outbox excluded BY NAME (EXPORT_EXCLUDED_TABLES).
  };

  if (includeRequestDetails) {
    tables.requestDetails = (await db.all(`SELECT * FROM requestDetails ORDER BY timestamp DESC`)).map((r) => ({
      id: r.id, timestamp: r.timestamp, provider: r.provider, model: r.model,
      connectionId: r.connectionId, status: r.status, data: parseJson(r.data, {}),
    }));
  }

  // Generic-scope kv export — completeness law, same as sqlite.
  const kvScopes = {};
  for (const { scope } of await db.all(`SELECT DISTINCT scope FROM kv ORDER BY scope ASC`)) {
    const entries = {};
    for (const r of await db.all(`SELECT \`key\`, value FROM kv WHERE scope = ? ORDER BY \`key\` ASC`, [scope])) {
      entries[r.key] = parseJson(r.value, null);
    }
    kvScopes[scope] = entries;
  }

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
      sourceDriver: "mysql2",
      sourceMode: getDbMode(),
    },
  };
}

/** Tombstone pre-W1 plaintext keys — MySQL dialect of the sqlite closure. */
function tombstoneLegacyKeysMysql(tx) {
  return tx.run(
    `UPDATE apiKeys
     SET isActive = 0,
         \`key\` = CONCAT('revoked-', id),
         name = CONCAT(COALESCE(name, 'Key'), ' [legacy]'),
         keyVersion = 'legacy'
     WHERE keyHash IS NULL AND \`key\` IS NOT NULL AND \`key\` != '' AND \`key\` NOT LIKE 'revoked-%'`
  );
}

/** Restore a payload into the live mysql harbor — S1 trust crossing, same
 *  law as the sqlite twin (bounds + shape before any write; quarantined
 *  fields preserve CURRENT values unless adoptSecrets). */
export async function importDb(payload, { adoptSecrets = false } = {}) {
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

  const db = await getMysqlAdapter();

  // S1 default path — capture CURRENT quarantined values before the wipe.
  let currentQuarantined = { settings: {}, keys: new Map() };
  if (!adoptSecrets) {
    const curSettings = await db.get(`SELECT data FROM settings WHERE id = 1`);
    const curSettingsObj = curSettings ? parseJson(curSettings.data, {}) : {};
    for (const k of RESTORE_QUARANTINED_SETTING_KEYS) {
      if (k in curSettingsObj) currentQuarantined.settings[k] = curSettingsObj[k];
    }
    for (const r of await db.all(`SELECT id, keyHash, isInternal, deletedAt FROM apiKeys`)) {
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
    adoptSecrets ? k : quarantineKeyRow(k)
  );

  await db.transaction(async (tx) => {
    await tx.run(`DELETE FROM settings`);
    await tx.run(`DELETE FROM providerConnections`);
    await tx.run(`DELETE FROM providerNodes`);
    await tx.run(`DELETE FROM proxyPools`);
    await tx.run(`DELETE FROM apiKeys`);
    await tx.run(`DELETE FROM combos`);
    await tx.run(`DELETE FROM kv`);
    await tx.run(`DELETE FROM usageHistory`);
    await tx.run(`DELETE FROM usageDaily`);
    await tx.run(`DELETE FROM requestDetails`);

    if (settingsToRestore) {
      const merged = adoptSecrets
        ? settingsToRestore
        : { ...settingsToRestore, ...currentQuarantined.settings };
      await tx.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`, [stringifyJson(merged)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      await tx.run(
        `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      await tx.run(
        `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      await tx.run(
        `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const k of keysToRestore) {
      const cur = adoptSecrets ? null : currentQuarantined.keys.get(k.id);
      const keyHash = adoptSecrets ? (k.keyHash ?? null) : (cur?.keyHash ?? null);
      const isInternal = adoptSecrets ? (k.isInternal === true || k.isInternal === 1) : (cur?.isInternal ?? false);
      const deletedAt = adoptSecrets ? (k.deletedAt ?? null) : (cur?.deletedAt ?? null);
      await tx.run(
        `INSERT INTO apiKeys(
          id, \`key\`, name, machineId, isActive, createdAt,
          keyVersion, keyHash, keyPrefix, description, allowedModels, isInternal, deletedAt,
          expiresAt, lastUsedAt, rotatedFrom, rotationPrevHash, rotationPrevKeyId, rotationGraceUntil,
          tokenBudgetDaily, spendCapDailyCents, budgetScope, rateLimitRpm, ipAllowlist, category
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE name = VALUES(name)`,
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
    await tombstoneLegacyKeysMysql(tx);
    for (const c of payload.combos || []) {
      await tx.run(
        `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE models = VALUES(models)`,
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
      await tx.run(`INSERT INTO kv(scope, \`key\`, value) VALUES(?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`, [scope, key, stringifyJson(value)]);
    }

    for (const h of payload.usageHistory || []) {
      await tx.run(
        `INSERT INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE status = VALUES(status)`,
        [h.id, h.timestamp, h.provider || "", h.model || "", h.connectionId || "", h.keyId || "", h.keyPrefix ?? null, h.endpoint ?? null, h.promptTokens ?? 0, h.completionTokens ?? 0, h.cost ?? 0, h.status ?? null, stringifyJson(h.tokens ?? null), stringifyJson(h.meta ?? null)]
      );
    }
    for (const d of payload.usageDaily || []) {
      await tx.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`, [d.dateKey, stringifyJson(d.data ?? {})]);
    }
    if (Array.isArray(payload.requestDetails)) {
      for (const rd of payload.requestDetails) {
        await tx.run(
          `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)`,
          [rd.id, rd.timestamp, rd.provider ?? null, rd.model ?? null, rd.connectionId ?? null, rd.status ?? null, stringifyJson(rd.data ?? {})]
        );
      }
    }
  });

  return await exportDb({ includeRequestDetails: Array.isArray(payload.requestDetails) });
}

export async function initDb() {
  await getMysqlAdapter();
}

export async function writeLedger(kind, fields = {}) {
  try {
    const db = await getMysqlAdapter();
    await db.run(
      `INSERT INTO backupLedger(id, createdAt, kind, status, artifactId, sizeBytes, schemaVersion, sourceMode, targetMode, error, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        (await import("node:crypto")).randomUUID(),
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
  const db = await getMysqlAdapter();
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const off = Math.max(0, Number(offset) || 0);
  const rows = await db.all(`SELECT * FROM backupLedger ORDER BY createdAt DESC, id LIMIT ? OFFSET ?`, [lim, off]);
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    kind: r.kind,
    status: r.status,
    artifactId: r.artifactId ?? null,
    sizeBytes: r.sizeBytes == null ? null : Number(r.sizeBytes),
    schemaVersion: r.schemaVersion == null ? null : Number(r.schemaVersion),
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
  const db = await getMysqlAdapter();
  const BATCH = 5000;
  let usageRemoved = 0;
  let detailsRemoved = 0;
  for (;;) {
    const r = await db.run(`DELETE FROM usageHistory WHERE timestamp < ? LIMIT ?`, [cutoff, BATCH]);
    const n = r.changes ?? 0;
    usageRemoved += n;
    if (n < BATCH) break;
  }
  for (;;) {
    const r = await db.run(`DELETE FROM requestDetails WHERE timestamp < ? LIMIT ?`, [cutoff, BATCH]);
    const n = r.changes ?? 0;
    detailsRemoved += n;
    if (n < BATCH) break;
  }
  await writeLedger("purge", {
    meta: { retentionDays: days, cutoff, usageHistory: usageRemoved, requestDetails: detailsRemoved },
  });
  return { purged: true, usageHistory: usageRemoved, requestDetails: detailsRemoved };
}
