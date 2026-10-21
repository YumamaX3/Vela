// Plans repository — the mysql twin of sqlite/plansRepo.js.
import { v4 as uuidv4 } from "uuid";
import { getMysqlAdapter } from "../../mysql/adapter.js";
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
  const db = await getMysqlAdapter();
  return (await db.all(`SELECT * FROM plans ORDER BY createdAt ASC`)).map(rowToPlan);
}

export async function getPlan(id) {
  const db = await getMysqlAdapter();
  return rowToPlan(await db.get(`SELECT * FROM plans WHERE id = ?`, [id]));
}

export async function createPlan(plan) {
  const db = await getMysqlAdapter();
  const now = new Date().toISOString();
  const id = uuidv4();
  await db.run(
    `INSERT INTO plans(id, name, description, limitTokens, spendCapCents, rpmLimit, period, allowedModels, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, plan.name, plan.description ?? null, plan.limitTokens ?? null, plan.spendCapCents ?? null,
      plan.rpmLimit ?? null, plan.period, stringifyJson(plan.allowedModels), now, now]
  );
  return getPlan(id);
}

export async function updatePlan(id, plan) {
  const db = await getMysqlAdapter();
  const existing = await db.get(`SELECT id FROM plans WHERE id = ?`, [id]);
  if (!existing) return null;
  await db.run(
    `UPDATE plans SET name = ?, description = ?, limitTokens = ?, spendCapCents = ?, rpmLimit = ?, period = ?, allowedModels = ?, updatedAt = ? WHERE id = ?`,
    [plan.name, plan.description ?? null, plan.limitTokens ?? null, plan.spendCapCents ?? null,
      plan.rpmLimit ?? null, plan.period, stringifyJson(plan.allowedModels), new Date().toISOString(), id]
  );
  return getPlan(id);
}

export async function deletePlan(id) {
  const db = await getMysqlAdapter();
  const res = await db.run(`DELETE FROM plans WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

export async function countPlanKeys(id) {
  const db = await getMysqlAdapter();
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM apiKeys WHERE planId = ? AND deletedAt IS NULL`,
    [id]
  );
  return Number(row?.n) || 0;
}
