// Plans repository — reusable key-policy templates (migration 023).
// Twin-harbor repo: the mysql copy lives at repos/mysql/plansRepo.js.
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../../driver.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";

function rowToPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || null,
    limitTokens: row.limitTokens == null ? null : Number(row.limitTokens),
    spendCapCents: row.spendCapCents == null ? null : Number(row.spendCapCents),
    rpmLimit: row.rpmLimit == null ? null : Number(row.rpmLimit),
    period: row.period || "monthly",
    allowedModels: parseJson(row.allowedModels, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPlans() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM plans ORDER BY createdAt ASC`).map(rowToPlan);
}

export async function getPlan(id) {
  const db = await getAdapter();
  return rowToPlan(db.get(`SELECT * FROM plans WHERE id = ?`, [id]));
}

export async function createPlan(plan) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const row = {
    ...plan,
    id: uuidv4(),
    allowedModels: plan.allowedModels ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO plans(id, name, description, limitTokens, spendCapCents, rpmLimit, period, allowedModels, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.id, row.name, row.description ?? null, row.limitTokens ?? null, row.spendCapCents ?? null,
      row.rpmLimit ?? null, row.period, stringifyJson(row.allowedModels), row.createdAt, row.updatedAt]
  );
  return rowToPlan(db.get(`SELECT * FROM plans WHERE id = ?`, [row.id]));
}

export async function updatePlan(id, plan) {
  const db = await getAdapter();
  const existing = db.get(`SELECT * FROM plans WHERE id = ?`, [id]);
  if (!existing) return null;
  const updatedAt = new Date().toISOString();
  db.run(
    `UPDATE plans SET name = ?, description = ?, limitTokens = ?, spendCapCents = ?, rpmLimit = ?, period = ?, allowedModels = ?, updatedAt = ? WHERE id = ?`,
    [plan.name, plan.description ?? null, plan.limitTokens ?? null, plan.spendCapCents ?? null,
      plan.rpmLimit ?? null, plan.period, stringifyJson(plan.allowedModels), updatedAt, id]
  );
  return rowToPlan(db.get(`SELECT * FROM plans WHERE id = ?`, [id]));
}

export async function deletePlan(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM plans WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

/** How many live keys inherit this plan — the 409 explanation. */
export async function countPlanKeys(id) {
  const db = await getAdapter();
  const row = db.get(
    `SELECT COUNT(*) AS n FROM apiKeys WHERE planId = ? AND deletedAt IS NULL`,
    [id]
  );
  return Number(row?.n) || 0;
}
