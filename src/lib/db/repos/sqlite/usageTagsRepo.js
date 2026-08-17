// Usage Observatory W4-C — request tags, the sqlite harbor.
// Migration 010 forged the usageRequestTags table (idx_urt_usageId +
// uq_urt_usageId_name); this repo is its only reader/writer. Contract:
//   • getTagsForUsageIds(ids) — one IN query per ledger page → Map(id → names)
//   • setUsageTags(usageId, names) — REPLACE semantics inside a transaction
//   • getUsageTags(usageId)      — one request's names, oldest first
// Validation rides requestTagDef.js at the API layer; this harbor persists
// what has already been shaped (every write is parameterized, never built).
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL).

import { getAdapter } from "../../driver.js";

/** Batch lookup for a ledger page: usageId → string[] (oldest first).
 *  Empty input short-circuits — never a bare `IN ()`. */
export async function getTagsForUsageIds(usageIds) {
  const ids = [...new Set((usageIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return new Map();
  const db = await getAdapter();
  const rows = db.all(
    `SELECT usageId, name FROM usageRequestTags WHERE usageId IN (${ids.map(() => "?").join(",")}) ORDER BY id ASC`,
    ids
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.usageId)) map.set(r.usageId, []);
    map.get(r.usageId).push(r.name);
  }
  return map;
}

/** One request's tags, oldest first. */
export async function getUsageTags(usageId) {
  if (!usageId) return [];
  const db = await getAdapter();
  const rows = db.all(
    `SELECT name FROM usageRequestTags WHERE usageId = ? ORDER BY id ASC`,
    [usageId]
  );
  return rows.map((r) => r.name);
}

/** REPLACE the full tag set for one request (transactional). The caller has
 *  already validated + deduped the names. */
export async function setUsageTags(usageId, names) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(`DELETE FROM usageRequestTags WHERE usageId = ?`, [usageId]);
    for (const name of names || []) {
      db.run(
        `INSERT INTO usageRequestTags(usageId, name, createdAt) VALUES(?, ?, ?)`,
        [usageId, name, now]
      );
    }
  });
  return getUsageTags(usageId);
}
