// keyTemplatesRepo — sqlite harbor (Governance Center, W1b).
// Saved key-configuration presets (migration 016). aclJson/limitsJson hold
// CONFIGURATION only — never secrets (hash-at-rest covenant).
// builtIn = 1 rows are immutable at repo level (update/delete → error object).
import { getAdapter } from "../../driver.js";

const BUILTIN_IMMUTABLE = "Built-in templates are immutable";
const NAME_CONFLICT = "A template with this name already exists";

function rowToTemplate(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    acl: safeParse(row.aclJson),
    limits: safeParse(row.limitsJson),
    categoryDefault: row.categoryDefault || null,
    builtIn: !!row.builtIn,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function safeParse(v) {
  if (v == null) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

export async function listTemplates({ includeBuiltIn = true } = {}) {
  const db = await getAdapter();
  const sql = includeBuiltIn
    ? `SELECT * FROM keyTemplates ORDER BY name ASC`
    : `SELECT * FROM keyTemplates WHERE builtIn = 0 ORDER BY name ASC`;
  return db.all(sql).map(rowToTemplate);
}

export async function getTemplate(id) {
  const db = await getAdapter();
  return rowToTemplate(db.get(`SELECT * FROM keyTemplates WHERE id = ?`, [id]));
}

export async function createTemplate({ name, description = null, acl = null, limits = null, categoryDefault = null }) {
  const db = await getAdapter();
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > 80) {
    return { error: "Template name must be 1–80 characters" };
  }
  const clash = db.get(`SELECT id FROM keyTemplates WHERE name = ?`, [trimmed]);
  if (clash) return { error: NAME_CONFLICT };

  const id = `tpl-${crypto.randomUUID?.() || randomId()}`;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO keyTemplates (id, name, description, aclJson, limitsJson, categoryDefault, builtIn, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, trimmed, description || null, acl != null ? JSON.stringify(acl) : null, limits != null ? JSON.stringify(limits) : null, categoryDefault || null, now, now]
  );
  return rowToTemplate(db.get(`SELECT * FROM keyTemplates WHERE id = ?`, [id]));
}

export async function updateTemplate(id, patch) {
  const db = await getAdapter();
  const existing = db.get(`SELECT * FROM keyTemplates WHERE id = ?`, [id]);
  if (!existing) return { error: "Template not found" };
  if (existing.builtIn === 1) return { error: BUILTIN_IMMUTABLE };

  const next = { ...existing, ...patch };
  const name = typeof next.name === "string" ? next.name.trim() : existing.name;
  if (!name || name.length > 80) return { error: "Template name must be 1–80 characters" };
  const clash = db.get(`SELECT id FROM keyTemplates WHERE name = ? AND id != ?`, [name, id]);
  if (clash) return { error: NAME_CONFLICT };

  const now = new Date().toISOString();
  db.run(
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
  return rowToTemplate(db.get(`SELECT * FROM keyTemplates WHERE id = ?`, [id]));
}

export async function deleteTemplate(id) {
  const db = await getAdapter();
  const existing = db.get(`SELECT * FROM keyTemplates WHERE id = ?`, [id]);
  if (!existing) return false;
  if (existing.builtIn === 1) return { error: BUILTIN_IMMUTABLE };
  db.run(`DELETE FROM keyTemplates WHERE id = ?`, [id]);
  return true;
}

/** Normalize a template into the createApiKey payload shape (pure, unit-tested). */
export function applyShape(template, overrides = {}) {
  if (!template) return null;
  const acl = template.acl || {};
  const limits = template.limits || {};
  return {
    name: overrides.name != null ? String(overrides.name) : template.name,
    description: overrides.description !== undefined ? overrides.description : template.description || null,
    category: overrides.category !== undefined ? overrides.category : template.categoryDefault || null,
    allowedModels: overrides.allowedModels !== undefined ? overrides.allowedModels : acl.allowedModels ?? null,
    allowedKinds: overrides.allowedKinds !== undefined ? overrides.allowedKinds : acl.allowedKinds ?? null,
    allowedProviders: overrides.allowedProviders !== undefined ? overrides.allowedProviders : acl.allowedProviders ?? null,
    allowedCombos: overrides.allowedCombos !== undefined ? overrides.allowedCombos : acl.allowedCombos ?? null,
    rateLimitRpm: overrides.rateLimitRpm !== undefined ? overrides.rateLimitRpm : limits.rateLimitRpm ?? null,
    tokenBudgetDaily: overrides.tokenBudgetDaily !== undefined ? overrides.tokenBudgetDaily : limits.tokenBudget ?? null,
    spendCapDailyCents: overrides.spendCapDailyCents !== undefined ? overrides.spendCapDailyCents : limits.spendCapCents ?? null,
    budgetScope: overrides.budgetScope !== undefined ? overrides.budgetScope : limits.budgetScope ?? null,
    expiresAt: overrides.expiresAt !== undefined ? overrides.expiresAt : limits.expiresAt ?? null,
    ipAllowlist: overrides.ipAllowlist !== undefined ? overrides.ipAllowlist : limits.ipAllowlist ?? null,
  };
}

function randomId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
