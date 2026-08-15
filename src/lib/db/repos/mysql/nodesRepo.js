// Storage Covenant Wave A7 — the mysql twin of sqlite/nodesRepo.js.
import { v4 as uuidv4 } from "uuid";
import { getMysqlAdapter } from "../../mysql/adapter.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";

function rowToNode(row) {
  if (!row) return null;
  const extra = parseJson(row.data, {});
  return {
    ...extra,
    id: row.id,
    type: row.type,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nodeToRow(n) {
  const { id, type, name, createdAt, updatedAt, ...rest } = n;
  return {
    id,
    type: type ?? null,
    name: name ?? null,
    data: stringifyJson(rest),
    createdAt,
    updatedAt,
  };
}

async function upsert(db, n) {
  const r = nodeToRow(n);
  await db.run(
    `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       type=VALUES(type), name=VALUES(name), data=VALUES(data), updatedAt=VALUES(updatedAt)`,
    [r.id, r.type, r.name, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProviderNodes(filter = {}) {
  const db = await getMysqlAdapter();
  const where = [];
  const params = [];
  if (filter.type) { where.push("type = ?"); params.push(filter.type); }
  const sql = `SELECT * FROM providerNodes${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
  const rows = await db.all(sql, params);
  return rows.map(rowToNode);
}

export async function getProviderNodeById(id) {
  const db = await getMysqlAdapter();
  return rowToNode(await db.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]));
}

export async function createProviderNode(data) {
  const db = await getMysqlAdapter();
  const now = new Date().toISOString();
  const node = {
    id: data.id || uuidv4(),
    type: data.type,
    name: data.name,
    prefix: data.prefix,
    apiType: data.apiType,
    baseUrl: data.baseUrl,
    createdAt: now,
    updatedAt: now,
  };
  await upsert(db, node);
  return node;
}

export async function updateProviderNode(id, data) {
  const db = await getMysqlAdapter();
  let result = null;
  await db.transaction(async (tx) => {
    const row = await tx.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToNode(row), ...data, updatedAt: new Date().toISOString() };
    await upsert(tx, merged);
    result = merged;
  });
  return result;
}

export async function deleteProviderNode(id) {
  const db = await getMysqlAdapter();
  let removed = null;
  await db.transaction(async (tx) => {
    const row = await tx.get(`SELECT * FROM providerNodes WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToNode(row);
    await tx.run(`DELETE FROM providerNodes WHERE id = ?`, [id]);
  });
  return removed;
}
