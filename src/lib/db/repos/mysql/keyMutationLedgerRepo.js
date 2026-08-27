// Storage Covenant — the mysql twin of sqlite/keyMutationLedgerRepo.js
// (Governance Center, W1b). Mirrors the same contract on the MariaDB harbor.
import { v4 as uuidv4 } from "uuid";
import { getMysqlAdapter } from "../../mysql/adapter.js";

export async function appendLedger({ surface, keyId = null, sourceRowId = null, outcome, actorClass = "dashboard", detail = null }) {
  const db = await getMysqlAdapter();
  const id = `led-${uuidv4()}`;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO key_mutation_ledger (id, surface, keyId, sourceRowId, outcome, actorClass, createdAt, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, surface, keyId, sourceRowId, outcome, actorClass, now, detail != null ? String(detail) : null]
  );
  return { id, createdAt: now };
}

export async function getKeyLedgerRows({ limit = 100, surface = null, keyId = null } = {}) {
  const db = await getMysqlAdapter();
  const clauses = [];
  const params = [];
  if (surface) {
    clauses.push("surface = ?");
    params.push(surface);
  }
  if (keyId) {
    clauses.push("keyId = ?");
    params.push(keyId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = await db.all(
    `SELECT * FROM key_mutation_ledger ${where} ORDER BY createdAt DESC LIMIT ?`,
    [...params, n]
  );
  return rows;
}
