// SECURITY LOG REPOSITORY — MySQL/MariaDB harbor (migration 030).
//
// Same contract as the sqlite twin (src/lib/db/repos/sqlite/securityLogRepo.js):
// append-only, epoch-ms INTEGER `createdAt`, prune-on-write retention, paged
// list newest-first. No `db` argument — each function resolves the twin's own
// adapter (the A8 repos' pattern). The table arrives through bootstrap.js's
// additive diff over schema.js's TABLES, so no DDL lives here.
import { randomUUID } from "node:crypto";
import { getMysqlAdapter } from "../../mysql/adapter.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";

const TABLE = "securityLog";

export const SECURITY_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const SECURITY_LOG_MAX_LIMIT = 500;

function detailJson(detail) {
  if (detail == null) return null;
  if (typeof detail === "string") return detail;
  try {
    return stringifyJson(detail);
  } catch {
    return stringifyJson({ unserializable: String(detail) });
  }
}

export async function pruneSecurityEvents(olderThanMs = SECURITY_LOG_RETENTION_MS) {
  const db = await getMysqlAdapter();
  const age = Number.isFinite(Number(olderThanMs)) && Number(olderThanMs) >= 0
    ? Number(olderThanMs)
    : SECURITY_LOG_RETENTION_MS;
  const cutoff = Date.now() - age;
  const before = await db.get(`SELECT COUNT(*) c FROM ${TABLE} WHERE createdAt < ?`, [cutoff]);
  await db.run(`DELETE FROM ${TABLE} WHERE createdAt < ?`, [cutoff]);
  return Number(before?.c || 0);
}

export async function appendSecurityEvent({ keyId = null, kind, detail = null, ip = null } = {}) {
  if (!kind || typeof kind !== "string") throw new Error("[securityLog] kind is required");
  const db = await getMysqlAdapter();
  const createdAt = Date.now();
  const id = randomUUID();
  try {
    await db.run(`DELETE FROM ${TABLE} WHERE createdAt < ?`, [createdAt - SECURITY_LOG_RETENTION_MS]);
  } catch {
    // Housekeeping must never block the evidence line; the next append retries.
  }
  await db.run(
    `INSERT INTO ${TABLE} (id, keyId, kind, detail, ip, createdAt) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, keyId == null ? null : String(keyId), String(kind), detailJson(detail), ip == null ? null : String(ip), createdAt]
  );
  return { id, keyId: keyId == null ? null : String(keyId), kind, detail, ip, createdAt };
}

export async function listSecurityEvents({ limit = 100, offset = 0, kind = null, keyId = null } = {}) {
  const db = await getMysqlAdapter();
  const lim = Math.min(SECURITY_LOG_MAX_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 100));
  const off = Math.max(0, Number.parseInt(offset, 10) || 0);
  const where = [];
  const params = [];
  if (kind) { where.push("kind = ?"); params.push(String(kind)); }
  if (keyId) { where.push("keyId = ?"); params.push(String(keyId)); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await db.get(`SELECT COUNT(*) c FROM ${TABLE} ${clause}`, params))?.c || 0);
  const rows = await db.all(
    `SELECT * FROM ${TABLE} ${clause} ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, lim, off]
  );
  return {
    rows: rows.map((r) => ({ ...r, detail: parseJson(r.detail, r.detail) })),
    total,
    limit: lim,
    offset: off,
  };
}

export async function countSecurityEvents() {
  const db = await getMysqlAdapter();
  return Number((await db.get(`SELECT COUNT(*) c FROM ${TABLE}`))?.c || 0);
}
