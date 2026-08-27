// keyMutationLedgerRepo — sqlite harbor (Governance Center, W1b).
// Append-only attribution ledger (Covenant S3). Written at the mintKey()
// chokepoint; never edited after insert. Records surface, keyId, source-row,
// outcome, actor-class (JWT session vs CLI token), timestamp, detail.
import { getAdapter } from "../../driver.js";

export async function appendLedger({ surface, keyId = null, sourceRowId = null, outcome, actorClass = "dashboard", detail = null }) {
  const db = await getAdapter();
  const id = `led-${crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO key_mutation_ledger (id, surface, keyId, sourceRowId, outcome, actorClass, createdAt, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, surface, keyId, sourceRowId, outcome, actorClass, now, detail != null ? String(detail) : null]
  );
  return { id, createdAt: now };
}

export async function getKeyLedgerRows({ limit = 100, surface = null, keyId = null } = {}) {
  const db = await getAdapter();
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
  return db.all(
    `SELECT * FROM key_mutation_ledger ${where} ORDER BY createdAt DESC LIMIT ?`,
    [...params, n]
  );
}
