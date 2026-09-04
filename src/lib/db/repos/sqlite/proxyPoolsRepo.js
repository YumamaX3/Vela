import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../../driver.js";
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

function upsert(db, p) {
  const r = poolToRow(p);
  db.run(
    `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       isActive=excluded.isActive, testStatus=excluded.testStatus,
       data=excluded.data, updatedAt=excluded.updatedAt`,
    [r.id, r.isActive, r.testStatus, r.data, r.createdAt, r.updatedAt]
  );
}

export async function getProxyPools(filter = {}) {
  const db = await getAdapter();
  const where = [];
  const params = [];
  if (filter.isActive !== undefined) { where.push("isActive = ?"); params.push(filter.isActive ? 1 : 0); }
  if (filter.testStatus) { where.push("testStatus = ?"); params.push(filter.testStatus); }
  // v0.9.42: the sort moved into SQL. It was `list.sort((a, b) => new Date(b.updatedAt || 0)
  // - new Date(a.updatedAt || 0))` — two Date allocations PER COMPARISON, on a
  // full-table scan that runs on several request paths. updatedAt is a real
  // column (not a blob key), so the database can order it directly. NULLs sort
  // last, matching the old `|| 0` epoch fallback.
  const sql = `SELECT * FROM proxyPools${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
     ORDER BY updatedAt IS NULL, updatedAt DESC`;
  return db.all(sql, params).map(rowToPool);
}

export async function getProxyPoolById(id) {
  const db = await getAdapter();
  return rowToPool(db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]));
}

export async function createProxyPool(data) {
  const db = await getAdapter();
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
    // §5.2 — relay auth. Both ride the `data` blob (proxyPools has only 6 real
    // columns: id/isActive/testStatus/data/createdAt/updatedAt), so NO migration
    // is needed and the additive bootstrap.js diff carries the twin for free.
    //
    // They are listed here explicitly because this function builds a literal and
    // therefore DROPS any key it does not name — unlike updateProxyPool below,
    // which merges. A caller passing relayToken to createProxyPool before this
    // line existed would have lost it silently, with no error anywhere.
    //
    // relayVersion defaults to 1, NEVER 2, and that default is load-bearing. Every
    // relay already deployed in the world was built from the v1 body, which
    // forwards ALL headers. A caller sends x-relay-auth only when
    // relayVersion >= 2 — so defaulting to 2 would hand a v1 relay a secret that
    // it then forwards to the upstream provider. Defaulting to 1 makes the new
    // field a no-op until a deploy explicitly opts a pool in.
    relayToken: data.relayToken ?? null,
    relayVersion: data.relayVersion ?? 1,
    createdAt: now,
    updatedAt: now,
  };
  upsert(db, pool);
  return pool;
}

export async function updateProxyPool(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToPool(row), ...data, updatedAt: new Date().toISOString() };
    upsert(db, merged);
    result = merged;
  });
  return result;
}

export async function deleteProxyPool(id) {
  const db = await getAdapter();
  let removed = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM proxyPools WHERE id = ?`, [id]);
    if (!row) return;
    removed = rowToPool(row);
    db.run(`DELETE FROM proxyPools WHERE id = ?`, [id]);
  });
  return removed;
}
