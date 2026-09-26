// The credential store — the MariaDB/MySQL twin of sqlite/usersRepo.js
// (migration 017). The dialect shifts are nil beyond the async adapter surface:
// authUsers is a plain row table (TEXT columns, no JSON), `username`'s UNIQUE
// rides the named index the additive TABLES diff creates, and the patch rides
// the same named-column SET the sqlite harbor builds. bootstrap.js brought the
// table via the additive TABLES diff; migration 017 is the sqlite twin's seal.
//
// Contract mirrors the sqlite harbor exactly — see its header for the law of
// each function (including the PATCHABLE whitelist that keeps a caller's free
// JSON away from the column set).

import { getMysqlAdapter } from "../../mysql/adapter.js";

const PATCHABLE = ["passwordHash", "disabledAt", "lastLoginAt", "username"];

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.passwordHash,
    disabledAt: row.disabledAt ?? null,
    lastLoginAt: row.lastLoginAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getUserByUsername(username) {
  if (!username) return null;
  const db = await getMysqlAdapter();
  const row = await db.get(`SELECT * FROM authUsers WHERE username = ?`, [username]);
  return rowToUser(row);
}

export async function getUserById(id) {
  if (!id) return null;
  const db = await getMysqlAdapter();
  const row = await db.get(`SELECT * FROM authUsers WHERE id = ?`, [id]);
  return rowToUser(row);
}

export async function createUser({ id, username, passwordHash }) {
  const db = await getMysqlAdapter();
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO authUsers(id, username, passwordHash, disabledAt, lastLoginAt, createdAt, updatedAt)
     VALUES(?, ?, ?, NULL, NULL, ?, ?)`,
    [id, username, passwordHash, now, now]
  );
  return getUserById(id);
}

export async function updateUser(id, patch) {
  if (!id || !patch) return null;
  const keys = Object.keys(patch).filter((k) => PATCHABLE.includes(k));
  if (!keys.length) return getUserById(id);
  const db = await getMysqlAdapter();
  const now = new Date().toISOString();
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  await db.run(
    `UPDATE authUsers SET ${sets}, updatedAt = ? WHERE id = ?`,
    [...keys.map((k) => patch[k]), now, id]
  );
  return getUserById(id);
}

export async function setUserPassword(id, passwordHash) {
  if (!id) return false;
  const db = await getMysqlAdapter();
  const now = new Date().toISOString();
  const r = await db.run(
    `UPDATE authUsers SET passwordHash = ?, updatedAt = ? WHERE id = ?`,
    [passwordHash, now, id]
  );
  return Number(r.changes ?? r.affectedRows ?? 0) > 0;
}

export async function touchUserLogin(id, at) {
  if (!id) return false;
  const db = await getMysqlAdapter();
  const now = at || new Date().toISOString();
  const r = await db.run(
    `UPDATE authUsers SET lastLoginAt = ?, updatedAt = ? WHERE id = ?`,
    [now, now, id]
  );
  return Number(r.changes ?? r.affectedRows ?? 0) > 0;
}

export async function listUsers() {
  const db = await getMysqlAdapter();
  const rows = await db.all(`SELECT * FROM authUsers ORDER BY createdAt ASC`);
  return rows.map(rowToUser);
}

export async function countUsers() {
  const db = await getMysqlAdapter();
  const row = await db.get(`SELECT COUNT(*) AS n FROM authUsers`);
  return Number(row?.n ?? 0);
}

export async function deleteAllUsers() {
  const db = await getMysqlAdapter();
  const r = await db.run(`DELETE FROM authUsers`);
  return Number(r.changes ?? r.affectedRows ?? 0);
}
