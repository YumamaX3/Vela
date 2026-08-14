// API key repository — hash-at-rest, show-once, field-whitelisted writes.
// Plan: plans/vela-key-governance.md §3.2. Full keys are minted by createApiKey
// (returned ONCE in the 201 payload) and stored only as SHA-256 hashes; list
// endpoints return masked rows without the `key` field.
import { getAdapter } from "../driver.js";

function rowToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    keyPrefix: row.keyPrefix || null,
    allowedModels: safeParse(row.allowedModels),
    isActive: row.isActive === 1 || row.isActive === true,
    isInternal: row.isInternal === 1 || row.isInternal === true,
    createdAt: row.createdAt,
    // W2/W3 columns surface when their waves land
    expiresAt: row.expiresAt || null,
    lastUsedAt: row.lastUsedAt || null,
    rotatedFrom: row.rotatedFrom || null,
    tokenBudgetDaily: row.tokenBudgetDaily ?? null,
    spendCapDailyCents: row.spendCapDailyCents ?? null,
    budgetScope: row.budgetScope || null,
    rateLimitRpm: row.rateLimitRpm ?? null,
    ipAllowlist: safeParse(row.ipAllowlist),
  };
}

function safeParse(v) {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return null; }
}

// Internal rows and soft-deleted rows are hidden from every list surface.
export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM apiKeys WHERE isInternal = 0 AND deletedAt IS NULL ORDER BY createdAt ASC`
  );
  return rows.map(rowToPublic);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ? AND isInternal = 0 AND deletedAt IS NULL`, [id]);
  return rowToPublic(row);
}

/**
 * Mint a new Vela key. Returns { record, key, keyId, keyPrefix } — `key` is the
 * one-time plaintext shown in the 201 response and NEVER persisted or returned again.
 * The legacy `key` column keeps a per-row placeholder to satisfy UNIQUE NOT NULL.
 */
export async function createApiKey(name, opts = {}) {
  const db = await getAdapter();
  const { generateApiKey } = await import("@/shared/utils/apiKey");
  const { key, keyId, keyHash, keyPrefix } = generateApiKey();
  const id = keyId; // keyId is the row id — one less random identity
  const createdAt = new Date().toISOString();
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix, description, allowedModels, isInternal)
     VALUES(?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      `vela-minted-${id}`,
      name,
      null,
      createdAt,
      "v1",
      keyHash,
      keyPrefix,
      opts.description || null,
      opts.allowedModels != null ? JSON.stringify(opts.allowedModels) : null,
    ]
  );
  return { record: await getApiKeyById(id), key, keyId, keyPrefix };
}

/**
 * Whitelisted update — ONLY these fields may change (fixes the blind merge).
 * Security columns (keyHash, keyVersion, keyPrefix, isInternal, rotatedFrom)
 * are never writable through this path.
 */
const MUTABLE_FIELDS = new Set(["name", "description", "allowedModels", "isActive"]);
export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ? AND isInternal = 0 AND deletedAt IS NULL`, [id]);
    if (!row) return;
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(data || {})) {
      if (!MUTABLE_FIELDS.has(k)) continue;
      if (k === "allowedModels") {
        sets.push("allowedModels = ?");
        vals.push(v != null ? JSON.stringify(v) : null);
      } else if (k === "isActive") {
        sets.push("isActive = ?");
        vals.push(v ? 1 : 0);
      } else {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (!sets.length) {
      result = rowToPublic(row);
      return;
    }
    db.run(`UPDATE apiKeys SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
    result = rowToPublic(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

/** Soft-revoke: audit row survives, hash NULLed (SQLite's UNIQUE treats NULLs as distinct). */
export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(
    `UPDATE apiKeys SET isActive = 0, keyHash = NULL, deletedAt = ? WHERE id = ? AND isInternal = 0 AND deletedAt IS NULL`,
    [new Date().toISOString(), id]
  );
  return (res?.changes ?? 0) > 0;
}

/**
 * Resolve a bearer token to its row (the gate's lookup). Fail-closed:
 * bad format, bad CRC, unknown hash, soft-deleted → null. Returns the row
 * even when paused — the GATE speaks the distinct codes (paused → 403,
 * unknown → 401). Honors a single rotation grace slot.
 */
export async function resolveKey(rawKey) {
  const db = await getAdapter();
  const { parseVelaKey, hashKey } = await import("@/shared/utils/apiKey");
  const parsed = parseVelaKey(rawKey);
  if (!parsed) return null;
  const hash = hashKey(rawKey);
  const now = new Date().toISOString();
  const row = db.get(
    `SELECT * FROM apiKeys
     WHERE (keyHash = ?)
        OR (rotationPrevHash = ? AND rotationGraceUntil IS NOT NULL AND rotationGraceUntil > ?)`,
    [hash, hash, now]
  );
  if (!row || row.deletedAt) return null;
  return row;
}

/**
 * Back-compat boolean wrapper for existing callsites until the gate rewires them.
 * vela- keys only — every sk- token returns false; paused keys are invalid here.
 */
export async function validateApiKey(key) {
  const row = await resolveKey(key);
  return row != null && (row.isActive === 1 || row.isActive === true);
}

/**
 * Find-or-create the deterministic internal key for a purpose (e.g. MITM).
 * The plaintext is derived (never stored); the row carries the hash for
 * validation and is pinned loopback-only + hidden from all list APIs.
 */
export async function ensureInternalKey(purpose) {
  const db = await getAdapter();
  const name = `internal:${purpose}`;
  const existing = db.get(`SELECT * FROM apiKeys WHERE name = ? AND isInternal = 1`, [name]);
  const { deriveInternalKey } = await import("@/shared/utils/apiKey");
  const derived = deriveInternalKey(purpose);
  if (existing) {
    // Rotating API_KEY_SECRET changes the derivation — follow it so the
    // global revocation lever actually re-keys the internal credential.
    if (existing.keyHash !== derived.keyHash) {
      db.run(`UPDATE apiKeys SET keyHash = ?, keyPrefix = ? WHERE id = ?`, [derived.keyHash, derived.keyPrefix, existing.id]);
    }
    return { key: derived.key, keyId: derived.keyId, id: existing.id };
  }
  const createdAt = new Date().toISOString();
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix, allowedModels, isInternal, ipAllowlist)
     VALUES(?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, 1, ?)`,
    [
      derived.keyId,
      `vela-internal-${purpose}`,
      name,
      null,
      createdAt,
      "v1",
      derived.keyHash,
      derived.keyPrefix,
      JSON.stringify(["127.0.0.1/32", "::1/128"]),
    ]
  );
  return { key: derived.key, keyId: derived.keyId, id: derived.keyId };
}
