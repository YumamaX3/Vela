// Usage Observatory W4-A — saved views, the sqlite harbor.
// Migration 009 forged the usageViews table (UNIQUE on name, idx_uv_created);
// this repo is its only reader/writer. Contract:
//   • listSavedViews()    — every view, newest first (idx_uv_created)
//   • getSavedView(id)    — one by id, or null
//   • saveSavedView()     — INSERT; a duplicate name upserts the stored
//                            params + updatedAt (ON CONFLICT), mirroring the
//                            budget editor's "save over the old one" gesture
//   • deleteSavedView(id) — remove; returns whether a row was taken
// Validation rides savedViewDef.js — this harbor never validates, it persists
// what the API layer has already shaped.
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL).

import { getAdapter } from "../../driver.js";

function rowToView(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    params: row.params,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Every saved view, newest first. */
export async function listSavedViews() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT id, name, params, createdAt, updatedAt FROM usageViews ORDER BY createdAt DESC, id DESC`
  );
  return rows.map(rowToView);
}

/** One saved view by id, or null when the tide has no such row. */
export async function getSavedView(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(
    `SELECT id, name, params, createdAt, updatedAt FROM usageViews WHERE id = ?`,
    [id]
  );
  return rowToView(row);
}

/** Insert or upsert (same name → new params + updatedAt).
 *  @returns {{view: object, created: boolean}} */
export async function saveSavedView({ name, params }) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const existing = db.get(`SELECT id, createdAt FROM usageViews WHERE name = ?`, [name]);
  if (existing) {
    db.run(
      `UPDATE usageViews SET params = ?, updatedAt = ? WHERE id = ?`,
      [params, now, existing.id]
    );
    return { view: await getSavedView(existing.id), created: false };
  }
  const r = db.run(
    `INSERT INTO usageViews(name, params, createdAt, updatedAt) VALUES(?, ?, ?, ?)`,
    [name, params, now, now]
  );
  return { view: await getSavedView(r.lastInsertRowid), created: true };
}

/** Remove a saved view. @returns {boolean} true when a row was taken. */
export async function deleteSavedView(id) {
  if (!id) return false;
  const db = await getAdapter();
  const r = db.run(`DELETE FROM usageViews WHERE id = ?`, [id]);
  return Number(r.changes || 0) > 0;
}
