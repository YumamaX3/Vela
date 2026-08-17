// Usage Observatory W4-C — request tags, the mysql twin of
// sqlite/usageTagsRepo.js. The contract carries over verbatim; the dialect
// shifts are only the async adapter surface (bootstrap.js brought the table
// via the additive TABLES diff; migration 010 is the sqlite twin's seal).
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL).

import { getMysqlAdapter } from "../../mysql/adapter.js";

/** Batch lookup for a ledger page: usageId → string[] (oldest first). */
export async function getTagsForUsageIds(usageIds) {
  const ids = [...new Set((usageIds || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (ids.length === 0) return new Map();
  const db = await getMysqlAdapter();
  const rows = await db.all(
    `SELECT usageId, name FROM usageRequestTags WHERE usageId IN (${ids.map(() => "?").join(",")}) ORDER BY id ASC`,
    ids
  );
  const map = new Map();
  for (const r of rows) {
    const id = Number(r.usageId);
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(r.name);
  }
  return map;
}

/** One request's tags, oldest first. */
export async function getUsageTags(usageId) {
  if (!usageId) return [];
  const db = await getMysqlAdapter();
  const rows = await db.all(
    `SELECT name FROM usageRequestTags WHERE usageId = ? ORDER BY id ASC`,
    [usageId]
  );
  return rows.map((r) => r.name);
}

/** REPLACE the full tag set for one request (transactional). */
export async function setUsageTags(usageId, names) {
  const db = await getMysqlAdapter();
  const now = new Date().toISOString();
  await db.transaction(async () => {
    await db.run(`DELETE FROM usageRequestTags WHERE usageId = ?`, [usageId]);
    for (const name of names || []) {
      await db.run(
        `INSERT INTO usageRequestTags(usageId, name, createdAt) VALUES(?, ?, ?)`,
        [usageId, name, now]
      );
    }
  });
  return getUsageTags(usageId);
}
