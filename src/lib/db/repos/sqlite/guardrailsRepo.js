// GUARDRAIL REPOSITORY — SQLite harbor.
//
// Storage Covenant shape: this file owns the SQL, and nothing outside
// src/lib/db/ names the driver. The policy STORE (src/lib/guardrails/
// policyStore.js) owns validation, precedence, caching and the audit policy;
// this repo only reads and writes rows.
//
// Every writer here is replay-safe by construction:
//   • policies are written with INSERT OR REPLACE — the caller always passes
//     the full merged row, so applying it any number of times converges.
//   • logs are INSERT OR REPLACE keyed by the id the caller minted, so a
//     replayed outbox row rewrites the same line instead of duplicating it.
//   • deletes are by predicate/id and return what they removed.
import { getAdapter } from "../../driver.js";

const POLICIES = "guardrailPolicies";
const LOGS = "guardrailLogs";

const POLICY_COLUMNS = [
  "id", "name", "enabled", "scope", "target", "direction", "detectors",
  "action", "priority", "notes", "createdAt", "updatedAt",
];

// ── Policies ────────────────────────────────────────────────────────────────

export async function listGuardrailPolicies() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM ${POLICIES} ORDER BY priority ASC, createdAt ASC`);
}

export async function getGuardrailPolicy(id) {
  const db = await getAdapter();
  return db.get(`SELECT * FROM ${POLICIES} WHERE id = ?`, [id]);
}

export async function upsertGuardrailPolicy(policy) {
  const db = await getAdapter();
  const row = {
    ...policy,
    enabled: policy.enabled ? 1 : 0,
    detectors: JSON.stringify(Array.isArray(policy.detectors) ? policy.detectors : []),
    target: policy.target ?? null,
    notes: policy.notes ?? null,
  };
  db.run(
    `INSERT OR REPLACE INTO ${POLICIES} (${POLICY_COLUMNS.join(", ")})
     VALUES (${POLICY_COLUMNS.map(() => "?").join(", ")})`,
    POLICY_COLUMNS.map((c) => row[c])
  );
  return policy;
}

export async function deleteGuardrailPolicy(id) {
  const db = await getAdapter();
  const result = db.run(`DELETE FROM ${POLICIES} WHERE id = ?`, [id]);
  return Number(result?.changes || 0) > 0;
}

// ── Audit log ───────────────────────────────────────────────────────────────

export async function insertGuardrailLog(row) {
  const db = await getAdapter();
  db.run(
    `INSERT OR REPLACE INTO ${LOGS}
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
  const db = await getAdapter();
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
  const db = await getAdapter();
  if (beforeMs) {
    const before = db.get(`SELECT COUNT(*) c FROM ${LOGS} WHERE createdAtMs < ?`, [Number(beforeMs)]);
    db.run(`DELETE FROM ${LOGS} WHERE createdAtMs < ?`, [Number(beforeMs)]);
    return Number(before?.c || 0);
  }
  const before = db.get(`SELECT COUNT(*) c FROM ${LOGS}`);
  db.run(`DELETE FROM ${LOGS}`);
  return Number(before?.c || 0);
}
