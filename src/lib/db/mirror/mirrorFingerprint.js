// Storage Covenant Wave C4 — the divergence fingerprint (pure, engine-agnostic).
//
// Plan (plans/storage-covenant.md): "per-table normalized fingerprints —
// COUNT + checksum of sorted pk hashes with a named exclusion list
// (apiKeys.lastUsedAt — written by THREE paths; updatedAt merge-writes;
// REAL-vs-DECIMAL cost epsilon; JSON key-order normalization; usageHistory
// handled by its own resync)."
//
// This module is PURE — no adapter, no SQL. It turns a set of raw rows (from
// either engine) into a deterministic {count, checksum} fingerprint, so the
// sweep can compare the sqlite primary against the mysql twin without caring
// which driver produced each row. The normalization hazards the plan names are
// resolved HERE, in one place:
//
//   • apiKeys.lastUsedAt dropped — keyGate + usage + the mirror all write it;
//     it flaps forever and is never divergence.
//   • updatedAt dropped everywhere — the apply layer's ON DUPLICATE KEY UPDATE
//     merge-writes and the twin repo writers stamp it independently; it is
//     derived, not identity.
//   • apiKeys fingerprinted by keyHash, NOT id/key — the mirror's createApiKey
//     replay mints twin rows under `mirror:${keyHash}` ids with derived keys
//     (Wave C3 + S3), so id/key differ by design between the stores. keyHash is
//     the stable identity; governance fields are the compared content.
//   • JSON columns re-canonicalized with sorted keys — key-order must never
//     read as drift.
//   • REAL-vs-DECIMAL cost epsilon — any fractional number rounds to 6dp
//     (DECIMAL(12,6) is the twin's exact width, ddlMap line 69).
//   • booleans normalized to 0/1 (sqlite returns 0/1, mysql2 may surface true).
//
// Tables IN scope (the config tables whose drift means the mirror diverged):
//   providerConnections, providerNodes, proxyPools, combos, apiKeys, kv
// Tables OUT of scope and why:
//   settings        — S2-redacted secrets make cross-engine comparison noise;
//                     settings ride the outbox rmw ops anyway.
//   usageHistory /
//   usageDaily      — exempt class; they flow via the usage-resync watermark,
//                     never arg-replay, and never this sweep.
//   requestDetails  — observability, regenerable; excluded from the default
//                     export/resync payload (plan line 409).
//   backupLedger /
//   outbox /
//   mirrorSeq       — the mirror's own bookkeeping (EXPORT_EXCLUDED_TABLES).
//   _meta           — schemaVersion + usage counters ride the usage-resync.

import crypto from "node:crypto";

/** Per-table fingerprint config. `drop` lists columns excluded from the
 *  normalized row before hashing (the plan's named exclusion list). */
export const FINGERPRINT_TABLES = {
  providerConnections: { drop: ["updatedAt"] },
  providerNodes: { drop: ["updatedAt"] },
  proxyPools: { drop: ["updatedAt"] },
  combos: { drop: ["updatedAt"] },
  // id/key are NOT compared — the mirror's createApiKey replay mints twin rows
  // under `mirror:${keyHash}` ids with derived `vela-minted-*` keys (Wave C3 +
  // S3), so they differ BY DESIGN between the stores. machineId (replay writes
  // NULL), lastUsedAt (three writers), and rotatedFrom/rotationPrevKeyId
  // (keyId references — divergent ids) are likewise excluded. keyHash +
  // keyPrefix + governance fields are the compared content.
  // NOTE: fingerprinting is a sorted MULTISET of per-row hashes (see
  // fingerprintRows) — order-independent AND pk-independent, so this table
  // compares as a bag of key-content rows across the pk divergence.
  apiKeys: { drop: ["id", "key", "machineId", "lastUsedAt", "rotatedFrom", "rotationPrevKeyId"] },
  kv: { drop: [] },
};

/** Columns whose TEXT value is a JSON document — canonicalized so key order
 *  never reads as drift. Defensive: a value that fails to parse is kept as-is
 *  (both engines store the same string, so this stays deterministic). */
export const JSON_COLUMNS = {
  providerConnections: ["data"],
  providerNodes: ["data"],
  proxyPools: ["data"],
  combos: ["models"],
  apiKeys: ["allowedModels", "ipAllowlist"],
  kv: ["value"],
};

/** Deterministic JSON with sorted keys (recursive). */
export function canonicalJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

/** Re-canonicalize a JSON TEXT column. Non-JSON / unparseable → unchanged. */
export function canonicalizeJsonString(text) {
  if (typeof text !== "string") return text;
  const t = text.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return text;
  try {
    return canonicalJson(JSON.parse(t));
  } catch {
    return text;
  }
}

/** Normalize one value for fingerprinting (engine-agnostic). */
function normalizeValue(table, column, value) {
  if (value === null || value === undefined) return null;
  if ((JSON_COLUMNS[table] || []).includes(column)) return canonicalizeJsonString(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    // REAL-vs-DECIMAL epsilon: fractional values round to the twin's 6dp width.
    return Number.isInteger(value) ? value : Number(value.toFixed(6));
  }
  if (typeof value === "string") {
    // mysql2 may surface TINYINT(1) as a number already; strings pass through.
    return value;
  }
  // mysql2 can surface DECIMAL/BIGINT as string or BigInt-ish; canonicalize.
  return canonicalJson(value);
}

/** Normalize one raw row into a plain object with dropped columns removed and
 *  every remaining value engine-normalized. Column ORDER is irrelevant — the
 *  hash step canonicalizes keys. */
export function normalizeRow(table, row) {
  const config = FINGERPRINT_TABLES[table];
  if (!config) throw new Error(`[mirror] no fingerprint config for table "${table}"`);
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (config.drop.includes(k)) continue;
    out[k] = normalizeValue(table, k, v);
  }
  return out;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** Fingerprint a set of raw rows from ONE engine → {count, checksum}.
 *  The checksum is order-independent (per-row hashes sorted before combine),
 *  so storage/return order never reads as drift. */
export function fingerprintRows(table, rows) {
  const hashes = rows.map((r) => sha256(canonicalJson(normalizeRow(table, r))));
  hashes.sort();
  return {
    count: rows.length,
    checksum: sha256(hashes.join("\n")),
  };
}

/** Compare two fingerprints → a verdict + the human-readable delta. */
export function compareFingerprints(table, primary, twin) {
  const match = primary.count === twin.count && primary.checksum === twin.checksum;
  return {
    table,
    match,
    countPrimary: primary.count,
    countTwin: twin.count,
    checksumPrimary: primary.checksum,
    checksumTwin: twin.checksum,
    // A count match with a checksum mismatch = same cardinality, drifted rows.
    rowDrift: match ? false : primary.count === twin.count,
  };
}
