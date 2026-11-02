// SECURITY LOG REPOSITORY — SQLite harbor (migration 030).
//
// Storage Covenant shape: this file owns the SQL; nothing outside
// src/lib/db/ names the driver. The FAIL-OPEN write door callers use lives
// OUTSIDE the harbor (src/lib/security/securityEvents.js) so the hot paths —
// the key gate, the guardrail pipeline — never import the adapter.
//
// APPEND-ONLY BY CONTRACT. No function here UPDATEs a row: an audit line that
// can be rewritten is not evidence. The only delete is the retention prune,
// and it runs ON WRITE first (append prunes before it inserts), so the table
// cannot outgrow its window on an install that never calls prune() manually.
//
// FAIL-OPEN IS THE CALLER'S LAW, NOT THIS FILE'S. appendSecurityEvent throws
// if the table cannot be written; the door that wraps it catches, warns and
// returns false. Keeping the throw here means a caller that forgets the door
// fails loudly at its test, never silently.
import { randomUUID } from "node:crypto";
import { getAdapter } from "../../driver.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";

const TABLE = "securityLog";

/** The retention window — 30 days, the port register's stated policy. */
export const SECURITY_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Bound on a page — the list route clamps to the same. */
export const SECURITY_LOG_MAX_LIMIT = 500;

/** Clamp + coerce a detail payload to a JSON string (or NULL). An object that
 *  cannot be serialized must not lose the whole audit line, so the failure is
 *  recorded as a string rather than thrown past the writer. */
function detailJson(detail) {
  if (detail == null) return null;
  if (typeof detail === "string") return detail;
  try {
    return stringifyJson(detail);
  } catch {
    return stringifyJson({ unserializable: String(detail) });
  }
}

/**
 * Delete rows older than the retention window (or than an explicit age).
 * Returns how many rows left. Safe to call at any time; idempotent.
 */
export async function pruneSecurityEvents(olderThanMs = SECURITY_LOG_RETENTION_MS) {
  const db = await getAdapter();
  const age = Number.isFinite(Number(olderThanMs)) && Number(olderThanMs) >= 0
    ? Number(olderThanMs)
    : SECURITY_LOG_RETENTION_MS;
  const cutoff = Date.now() - age;
  const before = db.get(`SELECT COUNT(*) c FROM ${TABLE} WHERE createdAt < ?`, [cutoff]);
  db.run(`DELETE FROM ${TABLE} WHERE createdAt < ?`, [cutoff]);
  return Number(before?.c || 0);
}

/**
 * Append one security event. The id is minted here; createdAt is stamped here
 * (epoch ms) — the caller supplies WHAT happened, never WHEN, so a written
 * line can never claim a time other than its own arrival.
 *
 * Retention is enforced first: a 30-day-old row is pruned in the same call
 * that would have pushed the table one line further.
 *
 * @returns {Promise<{id:string,keyId:string|null,kind:string,detail:any,ip:string|null,createdAt:number}>}
 * @throws when the table cannot be written — callers wrap in the fail-open door
 */
export async function appendSecurityEvent({ keyId = null, kind, detail = null, ip = null } = {}) {
  if (!kind || typeof kind !== "string") throw new Error("[securityLog] kind is required");
  const db = await getAdapter();
  const createdAt = Date.now();
  const id = randomUUID();
  try {
    const cutoff = createdAt - SECURITY_LOG_RETENTION_MS;
    db.run(`DELETE FROM ${TABLE} WHERE createdAt < ?`, [cutoff]);
  } catch {
    // A prune that fails must never block the line being written — the next
    // append (or the manual prune) retries it. Not silent: the line is the
    // evidence; the prune is the housekeeping.
  }
  db.run(
    `INSERT INTO ${TABLE} (id, keyId, kind, detail, ip, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, keyId == null ? null : String(keyId), String(kind), detailJson(detail), ip == null ? null : String(ip), createdAt]
  );
  return { id, keyId: keyId == null ? null : String(keyId), kind, detail, ip, createdAt };
}

/**
 * Paged read, newest first. Filters are exact matches (`kind`, `keyId`) so a
 * caller can read one key's story or one kind's history.
 *
 * @returns {Promise<{rows: object[], total: number, limit: number, offset: number}>}
 */
export async function listSecurityEvents({ limit = 100, offset = 0, kind = null, keyId = null } = {}) {
  const db = await getAdapter();
  const lim = Math.min(SECURITY_LOG_MAX_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 100));
  const off = Math.max(0, Number.parseInt(offset, 10) || 0);
  const where = [];
  const params = [];
  if (kind) { where.push("kind = ?"); params.push(String(kind)); }
  if (keyId) { where.push("keyId = ?"); params.push(String(keyId)); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(db.get(`SELECT COUNT(*) c FROM ${TABLE} ${clause}`, params)?.c || 0);
  const rows = db.all(
    `SELECT * FROM ${TABLE} ${clause} ORDER BY createdAt DESC, rowid DESC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  return {
    rows: rows.map((r) => ({ ...r, detail: parseJson(r.detail, r.detail) })),
    total,
    limit: lim,
    offset: off,
  };
}

/** Total rows (optionally for one predicate-free window) — the count view. */
export async function countSecurityEvents() {
  const db = await getAdapter();
  return Number(db.get(`SELECT COUNT(*) c FROM ${TABLE}`)?.c || 0);
}
