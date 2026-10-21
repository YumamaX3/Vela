// GUARDRAIL REPOSITORY — MySQL/MariaDB harbor.
//
// Same contract as the sqlite twin (src/lib/db/repos/sqlite/guardrailsRepo.js).
// No `db` argument: each function resolves the twin's own adapter, the pattern
// the A8 repos set. REPLACE INTO is the engine's INSERT OR REPLACE: it deletes
// the conflicting row and inserts again, which is the same terminal state for
// the full rows this repo always writes.
import { getMysqlAdapter } from "../../mysql/adapter.js";

const POLICIES = "guardrailPolicies";
const LOGS = "guardrailLogs";

const POLICY_COLUMNS = [
  "id", "name", "enabled", "scope", "target", "direction", "detectors",
  "action", "priority", "notes", "createdAt", "updatedAt",
];

export async function listGuardrailPolicies() {
  const db = await getMysqlAdapter();
  return db.all(`SELECT * FROM ${POLICIES} ORDER BY priority ASC, createdAt ASC`);
}

export async function getGuardrailPolicy(id) {
  const db = await getMysqlAdapter();
  return db.get(`SELECT * FROM ${POLICIES} WHERE id = ?`, [id]);
}

export async function upsertGuardrailPolicy(policy) {
  const db = await getMysqlAdapter();
  const row = {
    ...policy,
    enabled: policy.enabled ? 1 : 0,
    detectors: JSON.stringify(Array.isArray(policy.detectors) ? policy.detectors : []),
    target: policy.target ?? null,
    notes: policy.notes ?? null,
  };
  await db.run(
    `REPLACE INTO ${POLICIES} (${POLICY_COLUMNS.join(", ")})
     VALUES (${POLICY_COLUMNS.map(() => "?").join(", ")})`,
    POLICY_COLUMNS.map((c) => row[c])
  );
  return policy;
}

export async function deleteGuardrailPolicy(id) {
  const db = await getMysqlAdapter();
  const result = await db.run(`DELETE FROM ${POLICIES} WHERE id = ?`, [id]);
  return Number(result?.changes || 0) > 0;
}

export async function insertGuardrailLog(row) {
  const db = await getMysqlAdapter();
  await db.run(
    `REPLACE INTO ${LOGS}
       (id, policyId, scope, direction, action, detector, entity, severity,
        provider, model, connectionId, matchCount, excerpt, createdAt, createdAtMs)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.policyId ?? null, row.scope ?? null, row.direction, row.action,
      row.detector ?? null, row.entity ?? null, row.severity ?? null,
      row.provider ?? null, row.model ?? null, row.connectionId ?? null,
      row.matchCount ?? 0, row.excerpt ?? null, row.createdAt, row.createdAtMs,
    ]
  );
  return row;
}

export async function listGuardrailLogs({ limit = 100, action, entity, sinceMs } = {}) {
  const db = await getMysqlAdapter();
  const where = [];
  const params = [];
  if (action) { where.push("action = ?"); params.push(action); }
  if (entity) { where.push("entity = ?"); params.push(entity); }
  if (sinceMs) { where.push("createdAtMs >= ?"); params.push(Number(sinceMs)); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.all(
    `SELECT * FROM ${LOGS} ${clause} ORDER BY createdAtMs DESC LIMIT ?`,
    [...params, Math.min(Number(limit) || 100, 1000)]
  );
}

export async function deleteGuardrailLogs({ beforeMs } = {}) {
  const db = await getMysqlAdapter();
  if (beforeMs) {
    const before = await db.get(`SELECT COUNT(*) c FROM ${LOGS} WHERE createdAtMs < ?`, [Number(beforeMs)]);
    await db.run(`DELETE FROM ${LOGS} WHERE createdAtMs < ?`, [Number(beforeMs)]);
    return Number(before?.c || 0);
  }
  const before = await db.get(`SELECT COUNT(*) c FROM ${LOGS}`);
  await db.run(`DELETE FROM ${LOGS}`);
  return Number(before?.c || 0);
}
