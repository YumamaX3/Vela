// API key repository — hash-at-rest, show-once, field-whitelisted writes.
// Plan: plans/vela-key-governance.md §3.2. Full keys are minted by createApiKey
// (returned ONCE in the 201 payload) and stored only as SHA-256 hashes; list
// endpoints return masked rows without the `key` field.
import { getAdapter, getAdapterSync } from "../../driver.js";
import { validateKeyLimits, KeyLimitsValidationError } from "../../keyLimits.js";
// Static (not dynamic) import — resolveKey is on the gate hot path and a
// per-call `await import()` inflates p99 under CPU contention. apiKey.js
// reaches only stdlib + DATA_DIR, so no import cycle.
import { parseVelaKey, hashKey } from "@/shared/utils/apiKey";
import { touchKeyLastUsed } from "./usageRepo.js";

export { KeyLimitsValidationError } from "../../keyLimits.js";

function rowToPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    keyPrefix: row.keyPrefix || null,
    allowedModels: safeParse(row.allowedModels),
    // Per-key ACL (v0.9.17) — tri-state JSON arrays; NULL = unrestricted.
    allowedKinds: safeParse(row.allowedKinds),
    allowedProviders: safeParse(row.allowedProviders),
    allowedCombos: safeParse(row.allowedCombos),
    // AI Lab injector governance (migration 017) — tri-state, same semantics.
    allowedInjectors: safeParse(row.allowedInjectors),
    allowedModes: safeParse(row.allowedModes),
    defaultMode: row.defaultMode || null,
    isActive: row.isActive === 1 || row.isActive === true,
    isInternal: row.isInternal === 1 || row.isInternal === true,
    // Tombstoned legacy rows (migration 002) have a purged hash + 'legacy'
    // version stamp — they can NEVER authenticate again. The UI renders a
    // "Revoked (legacy)" honesty marker instead of a dead toggle.
    revoked: row.keyVersion === "legacy" || (row.keyHash == null && row.isInternal === 0),
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
    category: row.category || null,
    // Key Domain Ascension (migration 019) — daily request cap.
    requestCapDaily: row.requestCapDaily ?? null,
  };
}

function safeParse(v) {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return null; }
}

// Free-form key categories — the Star's own labels (friend, hermes, others…).
// Trimmed, whitespace-collapsed, capped; null/empty means "uncategorized".
// Shared by the create and update paths so both store the exact same shape.
const MAX_CATEGORY_LENGTH = 48;
export function sanitizeCategory(input) {
  if (input == null) return null;
  if (typeof input !== "string") throw new Error("Category must be a string");
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (normalized.length > MAX_CATEGORY_LENGTH) {
    throw new Error(`Category must be ${MAX_CATEGORY_LENGTH} characters or fewer`);
  }
  return normalized;
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
  // W3: limit opts are validated exactly like the update path — a key must
  // never be minted with governance values the gate or UI cannot trust.
  const limits = validateKeyLimits(opts);
  if (!limits.ok) throw new KeyLimitsValidationError(limits.errors);
  const category = sanitizeCategory(opts.category);
  const db = await getAdapter();
  // Endpoint Observatory W1c: the mintService pre-generates the credential so
  // the reveal-sink write and the DB commit carry the SAME key (Covenant C10
  // write-before-commit ordering). When keyFields is present, commit EXACTLY
  // what was revealed — never a second, unrevealed credential.
  const { generateApiKey } = await import("@/shared/utils/apiKey");
  const keyFields = opts.keyFields
    ? { key: opts.keyFields.key, keyId: opts.keyFields.keyId, keyHash: opts.keyFields.keyHash, keyPrefix: opts.keyFields.keyPrefix }
    : generateApiKey();
  const { key, keyId, keyHash, keyPrefix } = keyFields;
  const id = keyId; // keyId is the row id — one less random identity
  const createdAt = new Date().toISOString();
  const v = limits.values;
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, keyVersion, keyHash, keyPrefix, description, allowedModels, allowedKinds, allowedProviders, allowedCombos, allowedInjectors, allowedModes, defaultMode, isInternal, rateLimitRpm, tokenBudgetDaily, spendCapDailyCents, budgetScope, expiresAt, ipAllowlist, category, requestCapDaily)
     VALUES(?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      opts.allowedKinds != null ? JSON.stringify(opts.allowedKinds) : null,
      opts.allowedProviders != null ? JSON.stringify(opts.allowedProviders) : null,
      opts.allowedCombos != null ? JSON.stringify(opts.allowedCombos) : null,
      opts.allowedInjectors != null ? JSON.stringify(opts.allowedInjectors) : null,
      opts.allowedModes != null ? JSON.stringify(opts.allowedModes) : null,
      opts.defaultMode || null,
      v.rateLimitRpm ?? null,
      v.tokenBudgetDaily ?? null,
      v.spendCapDailyCents ?? null,
      v.budgetScope ?? null,
      v.expiresAt ?? null,
      v.ipAllowlist != null ? JSON.stringify(v.ipAllowlist) : null,
      category,
      v.requestCapDaily ?? null,
    ]
  );
  return { record: await getApiKeyById(id), key, keyId, keyPrefix };
}

/** Wave C3 — the mirror decorator's identity fetch. createApiKey's `record`
 *  is a PUBLIC projection (rowToPublic hides keyHash by design), but S3 law
 *  names the HASH as the outbox cargo for identity-carrying key ops. This
 *  returns the raw hash for the row's current lifetime only — the caller
 *  (mirrorDecorator) must NEVER persist the keyId, and the hash rides only
 *  the outbox identity column (export-excluded by name). Sync by design: it
 *  runs inside the containment savepoint with the adapter already resolved. */
export function getKeyHashForMirror(keyId) {
  const row = getAdapterSync().get(`SELECT keyHash FROM apiKeys WHERE id = ?`, [keyId]);
  return row?.keyHash ?? null;
}

/**
 * Whitelisted update — ONLY these fields may change (fixes the blind merge).
 * Security columns (keyHash, keyVersion, keyPrefix, isInternal, rotatedFrom,
 * rotationPrevHash, rotationGraceUntil) are never writable through this path.
 * W3 governance fields pass validateKeyLimits first — an invalid value throws
 * KeyLimitsValidationError instead of reaching the database.
 */
const MUTABLE_FIELDS = new Set([
  "name", "description", "allowedModels", "allowedKinds", "allowedProviders", "allowedCombos", "isActive",
  "rateLimitRpm", "tokenBudgetDaily", "spendCapDailyCents",
  "budgetScope", "expiresAt", "ipAllowlist", "category",
  // AI Lab injector governance (migration 017) — writable through this path.
  "allowedInjectors", "allowedModes", "defaultMode",
  // Key Domain Ascension (migration 019) — daily request cap.
  "requestCapDaily",
]);
const LIMIT_FIELDS = new Set([
  "rateLimitRpm", "tokenBudgetDaily", "spendCapDailyCents",
  "budgetScope", "expiresAt", "ipAllowlist", "requestCapDaily",
]);
export async function updateApiKey(id, data) {
  const present = Object.keys(data || {}).filter((k) => MUTABLE_FIELDS.has(k));
  const limitInput = {};
  for (const k of present) if (LIMIT_FIELDS.has(k)) limitInput[k] = data[k];
  const limits = validateKeyLimits(limitInput);
  if (!limits.ok) throw new KeyLimitsValidationError(limits.errors);

  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ? AND isInternal = 0 AND deletedAt IS NULL`, [id]);
    if (!row) return;
    const sets = [];
    const vals = [];
    const JSON_FIELDS = new Set(["allowedModels", "allowedKinds", "allowedProviders", "allowedCombos", "allowedInjectors", "allowedModes"]);
    for (const k of present) {
      if (JSON_FIELDS.has(k)) {
        sets.push(`${k} = ?`);
        vals.push(data[k] != null ? JSON.stringify(data[k]) : null);
      } else if (k === "isActive") {
        sets.push("isActive = ?");
        vals.push(data[k] ? 1 : 0);
      } else if (k === "category") {
        sets.push("category = ?");
        vals.push(sanitizeCategory(data[k]));
      } else if (LIMIT_FIELDS.has(k)) {
        sets.push(`${k} = ?`);
        vals.push(k === "ipAllowlist" && limits.values[k] != null ? JSON.stringify(limits.values[k]) : limits.values[k] ?? null);
      } else {
        sets.push(`${k} = ?`);
        vals.push(data[k]);
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
 * Revoke — the lifecycle split (Shorekeeper-Sealed Plan §1.3): revoke keeps
 * the row VISIBLE with its history (deletedAt stays NULL) so the 'Revoked'
 * lifecycle pill is reachable and the audit trail survives. The hash is
 * purged — the credential is cryptographically dead (hash-at-rest).
 */
export async function revokeApiKey(id) {
  const db = await getAdapter();
  const res = db.run(
    `UPDATE apiKeys SET isActive = 0, keyHash = NULL, deletedAt = NULL WHERE id = ? AND isInternal = 0`,
    [id]
  );
  return (res?.changes ?? 0) > 0;
}

/**
 * Delete with scrub — soft-tombstone + tag purge in ONE transaction
 * (Covenant M5: app-level scrub, no FK cascade). The tag rows die with the
 * key so orphan tags can never accumulate on any harbor.
 */
export async function deleteWithScrub(id) {
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    const res = db.run(
      `UPDATE apiKeys SET isActive = 0, keyHash = NULL, deletedAt = ? WHERE id = ? AND isInternal = 0 AND deletedAt IS NULL`,
      [new Date().toISOString(), id]
    );
    ok = (res?.changes ?? 0) > 0;
    if (ok) db.run(`DELETE FROM keyTags WHERE keyId = ?`, [id]);
  });
  return ok;
}

/**
 * Resolve a bearer token to its row (the gate's lookup). Fail-closed:
 * bad format, bad CRC, unknown hash, soft-deleted → null. Returns the row
 * even when paused — the GATE speaks the distinct codes (paused → 403,
 * unknown → 401). Honors a single rotation grace slot.
 */
export async function resolveKey(rawKey) {
  const db = await getAdapter();
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
  // Awaken the dormant lastUsedAt column — the gate saw this key work.
  if (row.isInternal !== 1 && row.isInternal !== true) await touchKeyLastUsed(row.id);
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
