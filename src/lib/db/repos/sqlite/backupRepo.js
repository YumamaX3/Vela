// Storage Covenant Wave B2 — the sqlite backupRepo harbor + backup engine.
//
// B1 relocated exportDb/importDb/initDb verbatim from the raw-SQL barrel.
// B2 layers the Tidebreaker's S1–S7 security laws on top and forges the
// encrypted artifact engine:
//
//   S1 — restore is a trust crossing. importDb() treats the payload as HOSTILE:
//        max-payload bounds + shape validation BEFORE any write; RESTORE-
//        QUARANTINED fields (settings.password/requireLogin/authMode/oidc*,
//        apiKeys.keyHash/isInternal/deletedAt) restore only under an explicit
//        adoptSecrets flag. The DEFAULT preserves CURRENT values (read before
//        the wipe, stitched back after).
//   S2 — secret-field redaction BELOW the completeness law. exportSettings()
//        redacts SECRET_SETTING_KEYS (repos/backupSecurity.js); backupLedger +
//        the future outbox are excluded from exportDb() BY NAME.
//   S3 — outbox excluded by name (migration 005 is the ledger; Wave C adds the
//        outbox — both are named here before they exist).
//   S5 — crypto spec pinned: scrypt N=2^17/r=8/p=1, per-artifact 16-byte salt +
//        12-byte IV in the header, AES-256-GCM tag verified BEFORE any restore
//        step, key material from VELA_BACKUP_ENCRYPTION_KEY only (env), with
//        minimum-entropy validation.
//   S6 — secret-bundle restore returns restartRequired (dashboardSession's
//        SECRET is captured at module load; B4 surfaces + enforces it).
//   S7 — artifact files chmod 0600 where honored (Node ignores mode on Windows
//        — documented fallback: local-dev posture runs world-readable).
//
// Engine portability: the JSON payload is the artifact for EVERY posture; the
// sqlite posture additionally keeps the VACUUM-INTO-style hot copy via
// backupDbLite as the pre-restore safety net. MySQL posture rides the same
// runBackup/restoreBackup surface (its importDb twin lands in B4).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { getAdapter } from "../../driver.js";
import { stringifyJson, parseJson } from "../../helpers/jsonCol.js";
import { tombstoneLegacyKeys } from "../../migrations/002-apikey-governance.js";
import { SCHEMA_VERSION, TABLES } from "../../schema.js";
import { getDbMode } from "../bind.js";
import { BACKUPS_DIR, ensureDirs } from "../../paths.js";
import { makeBackupDir, backupDbLite } from "../../backup.js";
import { getDataDir } from "@/lib/dataDir.js";
import {
  redactSecretSettings,
  quarantineSettingsPayload,
  quarantineKeyRow,
  RESTORE_QUARANTINED_SETTING_KEYS,
} from "../backupSecurity.js";

// ─── S1 bounds ────────────────────────────────────────────────────────────
// Max serialized payload (bytes, approximated by string length — ASCII-bound
// JSON; multibyte only makes the real byte count larger, so the bound holds
// as a ceiling check before any write touches the database).
export const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;

// S3 — tables excluded from exportDb BY NAME. backupLedger rows carry error
// strings with paths/driver names/SQL detail (an information channel into
// every artifact); the Wave C outbox will carry pending secrets. Both named
// here before the outbox exists — the pin test enforces it.
export const EXPORT_EXCLUDED_TABLES = ["backupLedger", "outbox"];

// ─── S5 crypto spec (pinned — plan line 499) ─────────────────────────────
const KDF = { N: 2 ** 17, r: 8, p: 1, keyLen: 32 };
const ARTIFACT_MAGIC = "VELABAK1";
const MIN_KEY_ENTROPY_CHARS = 16; // ~80+ bits for any non-trivial passphrase

export function artifactsDir() {
  ensureDirs();
  const dir = path.join(BACKUPS_DIR, "artifacts");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** S5 — resolve + validate the backup encryption key. Env-only, loud refusal. */
export function getBackupEncryptionKey() {
  const raw = process.env.VELA_BACKUP_ENCRYPTION_KEY;
  if (!raw || !raw.trim()) {
    throw new Error(
      "[backup] VELA_BACKUP_ENCRYPTION_KEY is not set — the backup engine refuses to run (key loss = unrecoverable backups; set it deliberately)."
    );
  }
  const key = raw.trim();
  if (key.length < MIN_KEY_ENTROPY_CHARS) {
    throw new Error(
      `[backup] VELA_BACKUP_ENCRYPTION_KEY is too short (< ${MIN_KEY_ENTROPY_CHARS} chars) — minimum-entropy validation failed.`
    );
  }
  return key;
}

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, KDF.keyLen, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    maxmem: 256 * 1024 * 1024,
  });
}

/** AES-256-GCM seal. Layout: MAGIC(8) | headerLen(4 BE) | headerJSON | ciphertext | tag(16). */
export function sealArtifact(plainBuffer, passphrase, manifest) {
  const salt = crypto.randomBytes(16); // S5 — per-artifact salt
  const iv = crypto.randomBytes(12); // S5 — per-artifact IV
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBuffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.from(
    JSON.stringify({
      v: 1,
      algo: "aes-256-gcm",
      kdf: "scrypt",
      N: KDF.N,
      r: KDF.r,
      p: KDF.p,
      salt: salt.toString("hex"),
      iv: iv.toString("hex"),
      manifest, // provenance: schemaVersion, sourceMode, secretBundle, created
    }),
    "utf8"
  );
  const out = Buffer.concat([
    Buffer.from(ARTIFACT_MAGIC, "ascii"),
    headerLenBuf(header.length),
    header,
    ciphertext,
    tag,
  ]);
  return out;
}

function headerLenBuf(len) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(len, 0);
  return b;
}

/** AES-256-GCM open — the auth tag is verified BEFORE any restore step (S5).
 *  Throws loud on tamper, truncation, or wrong key. */
export function openArtifact(artifactBuffer, passphrase) {
  if (!Buffer.isBuffer(artifactBuffer) || artifactBuffer.length < 8 + 4 + 16) {
    throw new Error("[backup] artifact is truncated or malformed");
  }
  const magic = artifactBuffer.subarray(0, 8).toString("ascii");
  if (magic !== ARTIFACT_MAGIC) {
    throw new Error("[backup] artifact magic mismatch — not a Vela backup artifact");
  }
  const headerLen = artifactBuffer.readUInt32BE(8);
  if (headerLen <= 0 || 12 + headerLen + 16 > artifactBuffer.length) {
    throw new Error("[backup] artifact header is truncated");
  }
  const header = JSON.parse(artifactBuffer.subarray(12, 12 + headerLen).toString("utf8"));
  if (header.algo !== "aes-256-gcm" || header.kdf !== "scrypt") {
    throw new Error(`[backup] unsupported artifact crypto "${header.algo}/${header.kdf}"`);
  }
  const salt = Buffer.from(header.salt, "hex");
  const iv = Buffer.from(header.iv, "hex");
  const tag = artifactBuffer.subarray(artifactBuffer.length - 16);
  const ciphertext = artifactBuffer.subarray(12 + headerLen, artifactBuffer.length - 16);
  const key = deriveKey(passphrase, salt);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag); // tag verified inside final() — BEFORE any restore
  let plain;
  try {
    plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new Error(
      "[backup] artifact authentication failed — wrong key or tampered ciphertext (GCM tag mismatch)"
    );
  }
  return { plain, header };
}

// ─── Secret-file bundle (plan line 279, S6) ──────────────────────────────
// The three per-install secrets that live as files under DATA_DIR. They ship
// inside the encrypted artifact so a bare-metal restore reproduces the SAME
// key identities (rotating them would revoke every minted API key + session).
const SECRET_FILE_NAMES = ["jwt-secret", "api-key-secret", "machine-id"];

export function captureSecretBundle() {
  const files = {};
  for (const name of SECRET_FILE_NAMES) {
    try {
      const p = path.join(getDataDir(), name);
      if (fs.existsSync(p)) files[name] = fs.readFileSync(p).toString("base64");
    } catch {
      // fail-open: a missing/unreadable secret file is not a backup failure
    }
  }
  return { capturedAt: new Date().toISOString(), files };
}

/** Write bundle files back (0600 where honored). Returns the names written. */
export function restoreSecretBundle(bundle) {
  if (!bundle || typeof bundle !== "object" || typeof bundle.files !== "object") return [];
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  const written = [];
  for (const name of SECRET_FILE_NAMES) {
    const b64 = bundle.files[name];
    if (typeof b64 !== "string" || !b64) continue;
    const dest = path.join(dataDir, name);
    const tmp = `${dest}.restore-tmp`;
    fs.writeFileSync(tmp, Buffer.from(b64, "base64"), { mode: 0o600 });
    try { fs.chmodSync(tmp, 0o600); } catch {} // S7 — Windows ignores mode
    fs.renameSync(tmp, dest);
    written.push(name);
  }
  return written;
}

// ─── The backup ledger repo (engine-private until Wave C mirrors it) ─────
// Writes are fail-open: a ledger failure must never break the backup itself.
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
      // error is deliberately OMITTED — S4: ledger surfaces return metadata
      // only; error strings carry paths/SQL detail and stay inside the DB.
    }));
}

// ─── exportDb — completeness + S2 redaction + S3 exclusions ──────────────
export async function exportDb({ includeRequestDetails = false } = {}) {
  const db = await getAdapter();
  const { exportSettings } = await import("../settingsRepo.js");
  const settings = await exportSettings(); // S2 — redacted at the source

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
      // S3 — backupLedger and outbox are EXPORT-EXCLUDED BY NAME (see
      // EXPORT_EXCLUDED_TABLES). The ledger's error strings and the outbox's
      // pending secrets never flow into an artifact or a resync.
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

// ─── importDb — S1 trust crossing ────────────────────────────────────────
/** Restore a payload into the live sqlite harbor.
 *  @param payload hostile input — bounds + shape validated before any write
 *  @param opts.adoptSecrets S1 — only under this explicit flag do the
 *         RESTORE-QUARANTINED fields restore from the payload. The default
 *         preserves CURRENT values (read before the wipe, stitched back). */
export async function importDb(payload, { adoptSecrets = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }

  // S1 — max-payload bounds BEFORE any write.
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `[backup] payload exceeds the ${MAX_PAYLOAD_BYTES}-byte restore bound (S1)`
    );
  }

  // S1 — shape validation: every table field present must be an array.
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

  // S1 default path — capture CURRENT quarantined values before the wipe so
  // they survive the restore ("the DEFAULT preserves current values").
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

  // S1 — quarantine the payload's settings + apiKeys rows.
  const settingsToRestore = adoptSecrets
    ? payload.settings
    : quarantineSettingsPayload(payload.settings);
  const keysToRestore = (payload.apiKeys || []).map((k) =>
    adoptSecrets ? k : quarantineKeyRow(k)
  );

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

    // Settings — quarantined fields stitched from current values (default path).
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
      // S1 default path — quarantined fields come from the CURRENT row (same
      // id) captured pre-wipe; rows the current DB doesn't know get nulls
      // (they cannot mint working hashes without adoptSecrets).
      const cur = adoptSecrets ? null : currentQuarantined.keys.get(k.id);
      const keyHash = adoptSecrets ? (k.keyHash ?? null) : (cur?.keyHash ?? null);
      const isInternal = adoptSecrets ? (k.isInternal === true || k.isInternal === 1) : (cur?.isInternal ?? false);
      const deletedAt = adoptSecrets ? (k.deletedAt ?? null) : (cur?.deletedAt ?? null);
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

// ─── The backup engine ────────────────────────────────────────────────────

function artifactTimestampSlug() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

/** Run one encrypted backup. Returns the manifest; writes a ledger row. */
export async function runBackup({ trigger = "manual" } = {}) {
  const passphrase = getBackupEncryptionKey(); // loud refusal (S5)
  const includeRequestDetails = process.env.VELA_BACKUP_INCLUDE_REQUEST_DETAILS === "true";
  try {
    const payload = await exportDb({ includeRequestDetails });
    const secretBundle = captureSecretBundle();
    const plain = zlib.gzipSync(Buffer.from(JSON.stringify({ payload, secretBundle }), "utf8"), { level: 9 });
    const manifest = {
      created: new Date().toISOString(),
      trigger,
      schemaVersion: SCHEMA_VERSION,
      sourceMode: getDbMode(),
      secretBundle: Object.keys(secretBundle.files || {}),
      includeRequestDetails,
    };
    const sealed = sealArtifact(plain, passphrase, manifest);
    const artifactId = `vela-backup-${artifactTimestampSlug()}-${crypto.randomBytes(3).toString("hex")}`;
    const file = path.join(artifactsDir(), `${artifactId}.velabak`);
    fs.writeFileSync(file, sealed, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {} // S7 — Windows ignores mode
    await writeLedger("backup", {
      artifactId,
      sizeBytes: sealed.length,
      schemaVersion: SCHEMA_VERSION,
      sourceMode: getDbMode(),
      meta: { trigger, secretBundleFiles: manifest.secretBundle },
    });
    return { ok: true, artifactId, file, sizeBytes: sealed.length, manifest };
  } catch (err) {
    await writeLedger("failed", { status: "failed", error: err?.message, meta: { trigger } });
    throw err;
  }
}

/** Locate the newest artifact (by mtime) in the artifacts dir. */
export function findLatestArtifact() {
  const dir = artifactsDir();
  const entries = fs.readdirSync(dir)
    .filter((n) => n.endsWith(".velabak"))
    .map((n) => ({ name: n, full: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0] || null;
}

/** Restore one artifact into the live sqlite harbor (the full B4 flow minus
 *  API/auth, which land in Wave B4). Schema compatibility checked BEFORE any
 *  write; a pre-restore safety backup of current state is taken first. */
export async function restoreBackup({ artifactId, adoptSecrets = false, trigger = "manual" } = {}) {
  const passphrase = getBackupEncryptionKey();
  const dir = artifactsDir();
  const file = artifactId ? path.join(dir, `${artifactId}.velabak`) : findLatestArtifact()?.full;
  if (!file || !fs.existsSync(file)) {
    throw new Error(`[backup] artifact not found${artifactId ? `: ${artifactId}` : " (no artifacts exist)"}`);
  }
  const { plain, header } = openArtifact(fs.readFileSync(file), passphrase); // tag verified FIRST (S5)
  const envelope = JSON.parse(zlib.gunzipSync(plain).toString("utf8"));
  const payload = envelope.payload;
  if (!payload || typeof payload !== "object") {
    throw new Error("[backup] artifact payload is malformed");
  }

  // Schema compatibility — a NEWER artifact than this build refuses; older
  // payloads flow through the migration chain at next boot.
  const payloadVersion = payload?._meta?.schemaVersion ?? 0;
  if (payloadVersion > SCHEMA_VERSION) {
    throw new Error(
      `[backup] artifact schema version ${payloadVersion} is newer than this build (${SCHEMA_VERSION}) — refusing to restore`
    );
  }

  // Pre-restore safety backup of current state (sqlite hot copy; fail-open —
  // the restore proceeds but the manifest flags the missing safety net).
  let safetyBackup = null;
  try {
    const db = await getAdapter();
    const dirPath = makeBackupDir("pre-restore");
    safetyBackup = backupDbLite(db, dirPath);
  } catch (err) {
    console.warn("[backup] pre-restore safety backup failed (restore proceeds):", err?.message);
  }

  const result = await importDb(payload, { adoptSecrets });

  // S6 — secret-bundle write-back. Restart is REQUIRED afterwards: SECRET is
  // captured at dashboardSession module load; the flag is surfaced by B4.
  const restoredSecrets = envelope.secretBundle ? restoreSecretBundle(envelope.secretBundle) : [];

  const artifactName = path.basename(file, ".velabak");
  await writeLedger("restore", {
    artifactId: artifactName,
    schemaVersion: payloadVersion,
    sourceMode: header?.manifest?.sourceMode ?? null,
    targetMode: getDbMode(),
    meta: { trigger, adoptSecrets, restoredSecrets, safetyBackup: safetyBackup ? path.basename(path.dirname(safetyBackup)) : null },
  });

  return {
    ok: true,
    artifactId: artifactName,
    schemaVersion: payloadVersion,
    restoredSecrets,
    restartRequired: restoredSecrets.length > 0, // S6
    safetyBackupTaken: Boolean(safetyBackup),
    restored: result ? true : false,
  };
}

/** Restore drill — decrypt the newest artifact into a SCRATCH sqlite DB and
 *  run smoke checks. The live database is never touched. "A backup never
 *  restored is a hope." */
export async function runRestoreDrill() {
  const passphrase = getBackupEncryptionKey();
  const latest = findLatestArtifact();
  if (!latest) {
    await writeLedger("drill", { status: "failed", error: "no artifact found" });
    return { ok: false, skipped: "no-artifact" };
  }
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-drill-"));
  const scratchDbPath = path.join(scratchDir, "drill.sqlite");
  let scratch = null;
  try {
    // Decrypt + verify + gunzip (full crypto path — the drill proves the key).
    const { plain } = openArtifact(fs.readFileSync(latest.full), passphrase);
    const envelope = JSON.parse(zlib.gunzipSync(plain).toString("utf8"));
    if (!envelope.payload || typeof envelope.payload !== "object") {
      throw new Error("artifact payload is malformed");
    }

    // Scratch adapter on an EXPLICIT path (driver.js getScratchAdapter) — the
    // live adapter singleton and DATA_FILE stay untouched. The migration chain
    // runs against the scratch file so its schema is complete.
    const { getScratchAdapter } = await import("../../driver.js");
    scratch = await getScratchAdapter(scratchDbPath);

    // Smoke checks: table census + settings read + one apiKeys read.
    const expectedTables = Object.keys(TABLES);
    const have = new Set(
      scratch.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((r) => r.name)
    );
    const missingTables = expectedTables.filter((t) => !have.has(t));
    scratch.get(`SELECT data FROM settings WHERE id = 1`); // may be null — read must not throw
    scratch.get(`SELECT COUNT(*) AS c FROM apiKeys`);

    if (missingTables.length > 0) {
      throw new Error(`scratch DB missing tables: ${missingTables.join(", ")}`);
    }

    await writeLedger("drill", {
      artifactId: path.basename(latest.full, ".velabak"),
      schemaVersion: envelope.payload?._meta?.schemaVersion ?? null,
      meta: { tableCensus: expectedTables.length },
    });
    return { ok: true, artifactId: path.basename(latest.full, ".velabak"), tableCensus: expectedTables.length };
  } catch (err) {
    await writeLedger("drill", { status: "failed", error: err?.message });
    return { ok: false, error: err?.message };
  } finally {
    try { scratch?.instance?.close?.(); } catch {}
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch {}
  }
}

/** Retention pruning (plan line 288): keep the newest artifact per day for
 *  retainDaily days + newest per ISO-week for retainWeekly weeks; prune the
 *  rest by mtime. Returns {kept, removed}. */
export function pruneBackupArtifacts({ retainDaily = 7, retainWeekly = 4 } = {}) {
  const dir = artifactsDir();
  const entries = fs.readdirSync(dir)
    .filter((n) => n.endsWith(".velabak"))
    .map((n) => {
      const full = path.join(dir, n);
      const st = fs.statSync(full);
      return { name: n, full, mtime: st.mtimeMs, day: new Date(st.mtimeMs).toISOString().slice(0, 10) };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const keep = new Set();
  const daysSeen = new Set();
  const weeksSeen = new Set();
  for (const e of entries) {
    if (daysSeen.size < retainDaily && !daysSeen.has(e.day)) daysSeen.add(e.day);
    // ISO week approximated by the Thursday of the week (good enough for a
    // retention bucket — the exact week boundary is not a correctness issue).
    const d = new Date(e.mtime);
    const thursday = new Date(d.getTime() + 3 * 86400000);
    const week = thursday.toISOString().slice(0, 10);
    if (weeksSeen.size < retainWeekly && !weeksSeen.has(week)) weeksSeen.add(week);
    if (daysSeen.has(e.day) || weeksSeen.has(week)) keep.add(e.name);
  }

  const removed = [];
  for (const e of entries) {
    if (!keep.has(e.name)) {
      try { fs.rmSync(e.full, { force: true }); removed.push(e.name); } catch {}
    }
  }
  return { kept: entries.length - removed.length, removed };
}

/** Usage purge (plan line 300): delete usageHistory + requestDetails older
 *  than retentionDays, batched so the write lock is never held for seconds.
 *  Runs AFTER the scheduled backup so purged rows live in the artifact. */
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
