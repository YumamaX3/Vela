// SEMANTIC CACHE REPOSITORY — the sqlite shelf behind the in-memory LRU.
//
// SQLITE-ONLY by design (migration 022): a cache is local process state, not
// mirrored state, so this repo is not bound through the twin facade and the
// table is absent from TABLES.
import { getAdapter } from "../../driver.js";

const TABLE = "semanticCacheEntries";

export async function hydrateSemanticCache(cutoffMs = 0) {
  const db = await getAdapter();
  const rows = cutoffMs > 0
    ? db.all(`SELECT * FROM ${TABLE} WHERE storedAtMs >= ? ORDER BY storedAtMs ASC`, [Number(cutoffMs)])
    : db.all(`SELECT * FROM ${TABLE} ORDER BY storedAtMs ASC`);
  return rows.map((r) => ({
    key: r.key,
    model: r.model ?? "",
    responseBody: r.responseBody,
    contentType: r.contentType || "application/json",
    storedAt: r.storedAt,
    storedAtMs: Number(r.storedAtMs) || 0,
    hitCount: Number(r.hitCount) || 0,
    tokensSaved: Number(r.tokensSaved) || 0,
  }));
}

export async function upsertSemanticCacheEntry(entry) {
  const db = await getAdapter();
  db.run(
    `INSERT OR REPLACE INTO ${TABLE}
       (key, model, responseBody, contentType, storedAt, storedAtMs, hitCount, tokensSaved)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      entry.key, entry.model ?? "", entry.responseBody, entry.contentType || "application/json",
      entry.storedAt, entry.storedAtMs, entry.hitCount ?? 0, entry.tokensSaved ?? 0,
    ]
  );
  return entry;
}

export async function recordSemanticCacheHit(key, tokensSaved = 0) {
  const db = await getAdapter();
  db.run(
    `UPDATE ${TABLE} SET hitCount = hitCount + 1, tokensSaved = tokensSaved + ? WHERE key = ?`,
    [Number(tokensSaved) || 0, key]
  );
}

export async function deleteSemanticCacheEntry(key) {
  const db = await getAdapter();
  return Number(db.run(`DELETE FROM ${TABLE} WHERE key = ?`, [key])?.changes || 0) > 0;
}

export async function invalidateSemanticCacheByModel(model) {
  const db = await getAdapter();
  return Number(db.run(`DELETE FROM ${TABLE} WHERE model = ?`, [model])?.changes || 0);
}

export async function invalidateSemanticCacheOlderThan(ms) {
  const db = await getAdapter();
  const cutoff = Date.now() - Number(ms);
  return Number(db.run(`DELETE FROM ${TABLE} WHERE storedAtMs < ?`, [cutoff])?.changes || 0);
}

export async function clearSemanticCache() {
  const db = await getAdapter();
  db.run(`DELETE FROM ${TABLE}`);
}

export async function countSemanticCacheEntries() {
  const db = await getAdapter();
  return Number(db.get(`SELECT COUNT(*) AS n FROM ${TABLE}`)?.n || 0);
}
