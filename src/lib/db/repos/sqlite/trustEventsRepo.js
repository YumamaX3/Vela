// TRUST INBOX REPOSITORY — SQLite harbor (migration 030).
//
// The inbox half of the security log's story (see sqlite/securityLogRepo.js).
// A trust event is the handful of acts that deserve the operator's glance —
// a key revoked, a guardrail blocking traffic — each carrying a `read` 0/1
// dismissal flag so the header bell can show an honest unread count.
//
// Unlike the security ledger, this table is NOT append-only: `read` is
// designed to flip. Nothing else is ever rewritten — a delivered notice keeps
// its title, detail and arrival time.
//
// Failure law matches the ledger's: these functions throw when the table
// cannot be read or written; the FAIL-OPEN door that hot paths call lives
// outside the harbor (src/lib/security/securityEvents.js).
import { randomUUID } from "node:crypto";
import { getAdapter } from "../../driver.js";
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
  return { ...r, read: r.read === 1 || r.read === true, detail: parseJson(r.detail, r.detail) };
}

/**
 * Append one trust event (unread). The caller supplies WHAT; the id and the
 * arrival stamp are minted here so a notice can never claim a time that is
 * not its own.
 *
 * @returns {Promise<{id:string,kind:string,title:string,detail:any,read:boolean,createdAt:number}>}
 */
export async function appendTrustEvent({ kind, title, detail = null } = {}) {
  if (!kind || typeof kind !== "string") throw new Error("[trustEvents] kind is required");
  if (!title || typeof title !== "string") throw new Error("[trustEvents] title is required");
  const db = await getAdapter();
  const createdAt = Date.now();
  const id = randomUUID();
  db.run(
    `INSERT INTO ${TABLE} (id, kind, title, detail, read, createdAt) VALUES (?, ?, ?, ?, 0, ?)`,
    [id, String(kind), String(title), detailJson(detail), createdAt]
  );
  return { id, kind, title, detail, read: false, createdAt };
}

/**
 * Paged read, newest first. `unreadOnly` narrows to the bell's list.
 *
 * @returns {Promise<{events: object[], total: number, limit: number, offset: number}>}
 */
export async function listTrustEvents({ limit = 20, offset = 0, unreadOnly = false } = {}) {
  const db = await getAdapter();
  const lim = Math.min(TRUST_EVENTS_MAX_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 20));
  const off = Math.max(0, Number.parseInt(offset, 10) || 0);
  const clause = unreadOnly ? "WHERE read = 0" : "";
  const total = Number(db.get(`SELECT COUNT(*) c FROM ${TABLE} ${clause}`)?.c || 0);
  const rows = db.all(
    `SELECT * FROM ${TABLE} ${clause} ORDER BY createdAt DESC, rowid DESC LIMIT ? OFFSET ?`,
    [lim, off]
  );
  return { events: rows.map(rowToEvent), total, limit: lim, offset: off };
}

/** The bell's number. Zero means the badge renders nothing (the zero-suppression law). */
export async function countUnreadTrustEvents() {
  const db = await getAdapter();
  return Number(db.get(`SELECT COUNT(*) c FROM ${TABLE} WHERE read = 0`)?.c || 0);
}

/**
 * Mark one event read. Idempotent — marking an already-read event is a no-op
 * that still reports it exists.
 *
 * @returns {Promise<boolean>} true when the event was found
 */
export async function markTrustEventRead(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT id FROM ${TABLE} WHERE id = ?`, [id]);
  if (!row) return false;
  db.run(`UPDATE ${TABLE} SET read = 1 WHERE id = ?`, [id]);
  return true;
}

/** Mark every unread event read. Returns how many flipped. */
export async function markAllTrustEventsRead() {
  const db = await getAdapter();
  const res = db.run(`UPDATE ${TABLE} SET read = 1 WHERE read = 0`);
  return Number(res?.changes || 0);
}
