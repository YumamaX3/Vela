// Storage Covenant — the mysql twin of sqlite/keyTemplatesRepo.js
// (Governance Center, W1b). Mirrors the same contract on the MariaDB harbor.
import { v4 as uuidv4 } from "uuid";
import { getMysqlAdapter } from "../../mysql/adapter.js";
import { parseJson } from "../../helpers/jsonCol.js";

const BUILTIN_IMMUTABLE = "Built-in templates are immutable";
const NAME_CONFLICT = "A template with this name already exists";

function rowToTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    acl: parseJson(row.aclJson, null),
    limits: parseJson(row.limitsJson, null),
    categoryDefault: row.categoryDefault || null,
    builtIn: !!row.builtIn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listTemplates({ includeBuiltIn = true } = {}) {
  const db = await getMysqlAdapter();
  const sql = includeBuiltIn
    ? `SELECT * FROM keyTemplates ORDER BY name ASC`
    : `SELECT * FROM keyTemplates WHERE builtIn = 0 ORDER BY name ASC`;
  const rows = await db.all(sql);
  return rows.map(rowToTemplate);
}

export async function getTemplate(id) {
  const db = await getMysqlAdapter();
  const row = await db.get(`SELECT * FROM keyTemplates WHERE id = ?`, [id]);
  return rowToTemplate(row);
}

export async function createTemplate({ name, description = null, acl = null, limits = null, categoryDefault = null }) {
  const db = await getMysqlAdapter();
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > 80) {
    return { error: "Template name must be 1–80 characters" };
  }
  const clash = await db.get(`SELECT id FROM keyTemplates WHERE name = ?`, [trimmed]);
  if (clash) return { error: NAME_CONFLICT };

  const id = `tpl-${uuidv4()}`;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO keyTemplates (id, name, description, aclJson, limitsJson, categoryDefault, builtIn, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, trimmed, description || null, acl != null ? JSON.stringify(acl) : null, limits != null ? JSON.stringify(limits) : null, categoryDefault || null, now, now]
  );
  return rowToTemplate(await db.get(`SELECT * FROM keyTemplates WHERE id = ?`, [id]));
}

export async function updateTemplate(id, patch) {
  const db = await getMysqlAdapter();
  const existing = await db.get(`SELECT * FROM keyTemplates WHERE id = ?`, [id]);
  if (!existing) return { error: "Template not found" };
  if (existing.builtIn === 1) return { error: BUILTIN_IMMUTABLE };

  const next = { ...existing, ...patch };
  const name = typeof next.name === "string" ? next.name.trim() : existing.name;
  if (!name || name.length > 80) return { error: "Template name must be 1–80 characters" };
  const clash = await db.get(`SELECT id FROM keyTemplates WHERE name = ? AND id != ?`, [name, id]);
  if (clash) return { error: NAME_CONFLICT };

  const now = new Date().toISOString();
  await db.run(
    `UPDATE keyTemplates SET name = ?, description = ?, aclJson = ?, limitsJson = ?, categoryDefault = ?, updatedAt = ? WHERE id = ?`,
    [
      name,
      next.description != null ? String(next.description) : null,
      next.acl != null ? JSON.stringify(next.acl) : null,
      next.limits != null ? JSON.stringify(next.limits) : null,
      next.categoryDefault != null ? String(next.categoryDefault) : null,
      now,
      id,
    ]
  );
  return rowToTemplate(await db.get(`SELECT * FROM keyTemplates WHERE id = ?`, [id]));
}

export async function deleteTemplate(id) {
  const db = await getMysqlAdapter();
  const existing = await db.get(`SELECT * FROM keyTemplates WHERE id = ?`, [id]);
  if (!existing) return false;
  if (existing.builtIn === 1) return { error: BUILTIN_IMMUTABLE };
  await db.run(`DELETE FROM keyTemplates WHERE id = ?`, [id]);
  return true;
}

export async function applyShape(template, overrides = {}) {
  // Pure — same logic as the sqlite harbor; kept async for contract parity.
  const { applyShape: fn } = await import("../sqlite/keyTemplatesRepo.js");
  return fn(template, overrides);
}
