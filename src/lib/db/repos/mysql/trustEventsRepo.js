// TRUST INBOX REPOSITORY — MySQL/MariaDB harbor (migration 030).
//
// Same contract as the sqlite twin (src/lib/db/repos/sqlite/trustEventsRepo.js).
// `read` is a MySQL RESERVED WORD — the twin's DDL (mysql/ddlMap.js) backticks
// every identifier, so it is backticked here for the same reason.
import { randomUUID } from "node:crypto";
import { getMysqlAdapter } from "../../mysql/adapter.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";

const TABLE = "trustEvents";

export const TRUST_EVENTS_MAX_LIMIT = 200;

function detailJson(detail) {
  if (detail == null) return null;
  if (typeof detail === "string") return detail;
  try {
    return stringifyJson(detail);
  } catch {
    return stringifyJson({ unserializable: String(detail) });
  }
}

function rowToEvent(r) {
  return { ...r, read: Number(r.read) === 1, detail: parseJson(r.detail, r.detail) };
}

export async function appendTrustEvent({ kind, title, detail = null } = {}) {
  if (!kind || typeof kind !== "string") throw new Error("[trustEvents] kind is required");
  if (!title || typeof title !== "string") throw new Error("[trustEvents] title is required");
  const db = await getMysqlAdapter();
  const createdAt = Date.now();
  const id = randomUUID();
  await db.run(
    `INSERT INTO ${TABLE} (id, kind, title, detail, \`read\`, createdAt) VALUES (?, ?, ?, ?, 0, ?)`,
    [id, String(kind), String(title), detailJson(detail), createdAt]
  );
  return { id, kind, title, detail, read: false, createdAt };
}

export async function listTrustEvents({ limit = 20, offset = 0, unreadOnly = false } = {}) {
  const db = await getMysqlAdapter();
  const lim = Math.min(TRUST_EVENTS_MAX_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 20));
  const off = Math.max(0, Number.parseInt(offset, 10) || 0);
  const clause = unreadOnly ? "WHERE `read` = 0" : "";
  const total = Number((await db.get(`SELECT COUNT(*) c FROM ${TABLE} ${clause}`))?.c || 0);
  const rows = await db.all(
    `SELECT * FROM ${TABLE} ${clause} ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?`,
    [lim, off]
  );
  return { events: rows.map(rowToEvent), total, limit: lim, offset: off };
}

export async function countUnreadTrustEvents() {
  const db = await getMysqlAdapter();
  return Number((await db.get(`SELECT COUNT(*) c FROM ${TABLE} WHERE \`read\` = 0`))?.c || 0);
}

export async function markTrustEventRead(id) {
  const db = await getMysqlAdapter();
  const row = await db.get(`SELECT id FROM ${TABLE} WHERE id = ?`, [id]);
  if (!row) return false;
  await db.run(`UPDATE ${TABLE} SET \`read\` = 1 WHERE id = ?`, [id]);
  return true;
}

export async function markAllTrustEventsRead() {
  const db = await getMysqlAdapter();
  const res = await db.run(`UPDATE ${TABLE} SET \`read\` = 1 WHERE \`read\` = 0`);
  return Number(res?.affectedRows ?? res?.changes ?? 0);
}
