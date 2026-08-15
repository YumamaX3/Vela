// Storage Covenant Wave A7 — the mysql twin of sqlite/proxyPoolsRepo.js.
import { v4 as uuidv4 } from "uuid";
import { getMysqlAdapter } from "../../mysql/adapter.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";

function rowToPool(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    isActive: row.isActive === 1 || row.isActive === true,
    testStatus: row.testStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function poolToRow(p) {
  const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
  return {
    id,
    isActive: isActive === false ? 0 : 1,
    testStatus: testStatus ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

async function upsert(db, p) {
  const r = poolToRow(p);
  await db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       isActive=VALUES(isActive), testStatus=VALUES(testStatus),
       data=VALUES(data), updatedAt=VALUES(updatedAt)`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProxyPools(filter = {}) {
  const db = await getMysqlAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  const sql = `SELECT * FROM proxyPools${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const rows = await db.all(sql, params);
  const list = rows.map(rowToPool);
  list.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return list;
}

export async function getProxyPoolById(id) {
  const db = await getMysqlAdapter();
  return rowToPool(await db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]));
}

export async function createProxyPool(data) {
  const db = await getMysqlAdapter();
  const now = new Date().toISOString();
  const pool = {
    id: data.id || uuidv4(),
    name: data.name,
    proxyUrl: data.proxyUrl,
    noProxy: data.noProxy || "",
    type: data.type || "http",
    isActive: data.isActive !== undefined ? data.isActive : true,
    strictProxy: data.strictProxy === true,
    testStatus: data.testStatus || "unknown",
    lastTestedAt: data.lastTestedAt || null,
    lastError: data.lastError || null,
    createdAt: now,
    updatedAt: now,
  };
  await upsert(db, pool);
  return pool;
}

export async function updateProxyPool(id, data) {
  const db = await getMysqlAdapter();
  let result = null;
  await db.transaction(async (tx) => {
    const row = await tx.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    await upsert(tx, merged);
    result = merged;
  });
  return result;
}

export async function deleteProxyPool(id) {
  const db = await getMysqlAdapter();
  let removed = null;
  await db.transaction(async (tx) => {
    const row = await tx.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    await tx.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  return removed;
}
