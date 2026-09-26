// The credential store — the sqlite harbor (migration 017).
//
// One row per dashboard operator. Before this wave the dashboard's single
// credential was a bcrypt hash parked in `settings.password` — a JSON document
// with no unique constraint, no per-field identity, and nowhere to stamp a
// username or a lastLoginAt. This harbor owns that row instead.
//
// The contract:
//   • getUserByUsername(username) — the login door's one lookup. Case is
//     preserved as authored (the door normalises before it calls); this harbor
//     persists exactly what the API layer has already shaped.
//   • getUserById(id)             — the session/status paths that carry an id.
//   • createUser({…})             — mint the occupant; returns the stored row.
//   • updateUser(id, patch)       — patch a named column set (whitelisted here,
//                                    never a caller's free JSON — CWE-915 is the
//                                    lesson v0.9.87 taught).
//   • setUserPassword(id, hash)   — the one credential write, named for what it is.
//   • touchUserLogin(id, at)      — the login stamp; failure is not fatal to a login.
//   • listUsers() / countUsers()  — the census the status route and the seed read.
//
// Posture: bound through bindFacade like every W3+ surface (see
// repos/usersRepo.js). The mysql twin lives in repos/mysql/usersRepo.js and
// bootstrap.js brings its table via the additive TABLES diff, so the three
// dialects (versioned chain, auto-sync, twin bootstrap) read one declaration.

import { getAdapter } from "../../driver.js";

/** Named columns a patch may touch. Anything else is dropped, loudly, by the API. */
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

/** The login door's lookup: one operator by their authored username. */
export async function getUserByUsername(username) {
  if (!username) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM authUsers WHERE username = ?`, [username]);
  return rowToUser(row);
}

/** One operator by id — the session/status paths that already carry it. */
export async function getUserById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM authUsers WHERE id = ?`, [id]);
  return rowToUser(row);
}

/** Mint the occupant. @returns the stored row. */
export async function createUser({ id, username, passwordHash }) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO authUsers(id, username, passwordHash, disabledAt, lastLoginAt, createdAt, updatedAt)
     VALUES(?, ?, ?, NULL, NULL, ?, ?)`,
    [id, username, passwordHash, now, now]
  );
  return getUserById(id);
}

/** Patch a whitelisted column set. @returns the stored row, or null. */
export async function updateUser(id, patch) {
  if (!id || !patch) return null;
  const keys = Object.keys(patch).filter((k) => PATCHABLE.includes(k));
  if (!keys.length) return getUserById(id);
  const db = await getAdapter();
  const now = new Date().toISOString();
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db.run(
    `UPDATE authUsers SET ${sets}, updatedAt = ? WHERE id = ?`,
    [...keys.map((k) => patch[k]), now, id]
  );
  return getUserById(id);
}

/** The one credential write, named for what it is. @returns boolean. */
export async function setUserPassword(id, passwordHash) {
  if (!id) return false;
  const db = await getAdapter();
  const now = new Date().toISOString();
  const r = db.run(
    `UPDATE authUsers SET passwordHash = ?, updatedAt = ? WHERE id = ?`,
    [passwordHash, now, id]
  );
  return Number(r.changes || 0) > 0;
}

/** Stamp a successful login. @returns boolean — a missed stamp never fails a login. */
export async function touchUserLogin(id, at) {
  if (!id) return false;
  const db = await getAdapter();
  const r = db.run(
    `UPDATE authUsers SET lastLoginAt = ?, updatedAt = ? WHERE id = ?`,
    [at || new Date().toISOString(), at || new Date().toISOString(), id]
  );
  return Number(r.changes || 0) > 0;
}

/** Every operator — one row, by design, but the census is honest about it. */
export async function listUsers() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM authUsers ORDER BY createdAt ASC`);
  return rows.map(rowToUser);
}

/** How many seats are filled. The seed reads this; expects 0 before first boot. */
export async function countUsers() {
  const db = await getAdapter();
  const row = db.get(`SELECT COUNT(*) AS n FROM authUsers`);
  return Number(row?.n ?? 0);
}

/** Wipe every seat — the reset route's law (drop back to the unconfigured
 *  posture). Returns rows removed; there is one seat by design, so this is
 *  usually 1, but the census is honest rather than assuming. */
export async function deleteAllUsers() {
  const db = await getAdapter();
  const r = db.run(`DELETE FROM authUsers`);
  return Number(r.changes || 0);
}
