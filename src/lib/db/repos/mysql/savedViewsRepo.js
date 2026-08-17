// Usage Observatory W4-A — saved views, the mysql twin of
// sqlite/savedViewsRepo.js. The dialect shifts are nil beyond the async
// adapter surface: usageViews is a plain row table (TEXT columns, no JSON),
// and the upsert rides the same SELECT-then-INSERT/UPDATE two-step the sqlite
// harbor uses (no ON DUPLICATE KEY gymnastics needed — the twin keeps both
// harbors reading the same shape). bootstrap.js brought the table via the
// additive TABLES diff; migration 009 is the sqlite twin's seal.
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL).

import { getMysqlAdapter } from "../../mysql/adapter.js";

function rowToView(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    params: row.params,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Every saved view, newest first. */
export async function listSavedViews() {
  const db = await getMysqlAdapter();
  const rows = await db.all(
    `SELECT id, name, params, createdAt, updatedAt FROM usageViews ORDER BY createdAt DESC, id DESC`
  );
  return rows.map(rowToView);
}

/** One saved view by id, or null when the tide has no such row. */
export async function getSavedView(id) {
  if (!id) return null;
  const db = await getMysqlAdapter();
  const row = await db.get(
    `SELECT id, name, params, createdAt, updatedAt FROM usageViews WHERE id = ?`,
    [id]
  );
  return rowToView(row);
}

/** Insert or upsert (same name → new params + updatedAt).
 *  @returns {{view: object, created: boolean}} */
export async function saveSavedView({ name, params }) {
  const db = await getMysqlAdapter();
  const now = new Date().toISOString();
  const existing = await db.get(`SELECT id, createdAt FROM usageViews WHERE name = ?`, [name]);
  if (existing) {
    await db.run(
      `UPDATE usageViews SET params = ?, updatedAt = ? WHERE id = ?`,
      [params, now, existing.id]
    );
    return { view: await getSavedView(existing.id), created: false };
  }
  const r = await db.run(
    `INSERT INTO usageViews(name, params, createdAt, updatedAt) VALUES(?, ?, ?, ?)`,
    [name, params, now, now]
  );
  return { view: await getSavedView(r.lastInsertRowid), created: true };
}

/** Remove a saved view. @returns {boolean} true when a row was taken. */
export async function deleteSavedView(id) {
  if (!id) return false;
  const db = await getMysqlAdapter();
  const r = await db.run(`DELETE FROM usageViews WHERE id = ?`, [id]);
  return Number(r.changes || 0) > 0;
}
