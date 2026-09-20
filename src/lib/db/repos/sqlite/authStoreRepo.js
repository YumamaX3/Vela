/**
 * authStore repo — SQLite harbor for the Auth Hardening W1 store (migration 016).
 *
 * Three tables, three purposes, one file:
 *
 *   authSessions   — one row per issued dashboard session, keyed by the JWT's
 *                    own `jti`. This is what makes revocation possible at all:
 *                    the token is stateless, so the row is the kill switch.
 *   authFailures   — the durable ladder. loginLimiter.js kept its counters in
 *                    module-scope Maps; a restart wiped every lockout. This is
 *                    that store on disk, and the limiter reads it first.
 *   authAuditLog   — the trail. Login outcomes, lockouts, revocations; `detail`
 *                    carries metadata only, never a secret (authAudit.js owns
 *                    the redaction; this file stores only what it is handed).
 *
 * ── WHY TWO SURFACES ──────────────────────────────────────────────────────
 * The limiter's public contract is SYNCHRONOUS (checkLock/recordFail/…) and
 * that contract is load-bearing: the login route calls it before it parses a
 * body, and the tag-3 suite pins the ladder against an injectable clock with no
 * awaiting anywhere. So this repo exposes a SYNC CORE that takes the adapter as
 * its first argument — every db.get/run/all underneath is synchronous in all
 * three drivers, only getAdapter() is async — plus a thin ASYNC WRAPPER layer
 * for the routes and the audit writer, which have nothing to preserve.
 *
 * ── THE POSTURE, NAMED HONESTLY ───────────────────────────────────────────
 * This store is NOT bound through bindFacade. bindFacade's mysql branch wraps
 * every bound name in an async loader, which cannot serve a sync caller, and
 * its unbound names throw — the limiter would lose its durable arm under a
 * posture it must survive. Consequences, recorded rather than hidden:
 *
 *   · The sync core rides whichever adapter getAdapter() resolves. The session
 *     rows and the audit trail are plain INSERT/UPDATE/SELECT/DELETE and run on
 *     any engine; the durable LIMITER arm is SQLite-posture-only today, for two
 *     measured reasons. `upsertFailureRow` writes SQLite's
 *     `INSERT … ON CONFLICT … excluded.*`, which MariaDB does not parse (it
 *     wants ON DUPLICATE KEY UPDATE), and the mysql adapter's run/get are ASYNC
 *     (pool.js: "mysql2 is network-bound") while this limiter's contract is
 *     synchronous. Under VELA_DB_MODE=mysql the arm's fail-open latches one
 *     warning and memory serves, exactly as it did before this store landed —
 *     the mysql twin plus its binder is the owed wave, and this paragraph is
 *     corrected the moment it lands.
 *   · Under VELA_DB_MODE=mirror the sqlite primary serves and the rows are NOT
 *     carried to the twin, because the outbox pump rides bindFacade and this
 *     facade deliberately does not bind. The twin's tables exist regardless —
 *     bootstrap.js creates them from schema.js TABLES. Auth records are local
 *     operational state, so an un-mirrored row is a fidelity note, not a
 *     correctness wound.
 *
 * ADAPTER CONTRACT (v0.9.20 lesson): portable surface only — db.all/get/run/
 * exec — NEVER db.prepare. The sql.js fallback driver (the Docker runner's own
 * last resort) exposes no public .prepare(), and a bare call to it once crashed
 * every DB API at boot.
 */

import { getAdapter } from "../../driver.js";

const FAILURE_COLUMNS =
  "ipKey, fails, tier, lockUntil, windowStart, windowCount, lastActivityAt";
const SESSION_COLUMNS =
  "id, createdAt, lastSeenAt, expiresAt, ip, userAgent, label, revokedAt, revokedReason";

// ─────────────────────────────────────────────────────────────────────────────
// Sync core — the adapter arrives as the first argument.
// ─────────────────────────────────────────────────────────────────────────────

/** One ladder+window row, or null. */
export function readFailureRow(db, ipKey) {
  return (
    db.get(`SELECT ${FAILURE_COLUMNS} FROM authFailures WHERE ipKey = ?`, [ipKey]) || null
  );
}

/** Upsert the whole row — the entry IS the state (ladder + window together). */
export function upsertFailureRow(db, ipKey, entry = {}) {
  db.run(
    `INSERT INTO authFailures (${FAILURE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(ipKey) DO UPDATE SET
       fails = excluded.fails,
       tier = excluded.tier,
       lockUntil = excluded.lockUntil,
       windowStart = excluded.windowStart,
       windowCount = excluded.windowCount,
       lastActivityAt = excluded.lastActivityAt`,
    [
      ipKey,
      entry.fails ?? 0,
      entry.tier ?? 0,
      // 0 is the in-memory sentinel for "unset"; the column is nullable and
      // NULL is the honest value — a stored 0 would read as an epoch stamp.
      entry.lockUntil || null,
      entry.windowStart || null,
      entry.windowCount ?? 0,
      entry.lastActivityAt ?? 0,
    ]
  );
}

export function deleteFailureRow(db, ipKey) {
  db.run(`DELETE FROM authFailures WHERE ipKey = ?`, [ipKey]);
}

/** Test hygiene + the operator's "clear the ladder" — wipe every caller key. */
export function deleteAllFailureRows(db) {
  db.run(`DELETE FROM authFailures`);
}

/** Drop idle entries (the in-memory TTL prune, made durable). */
export function pruneFailureRows(db, cutoffMs) {
  const res = db.run(
    `DELETE FROM authFailures WHERE lastActivityAt < ? AND (lockUntil IS NULL OR lockUntil < ?)`,
    [cutoffMs, cutoffMs]
  );
  return res?.changes ?? 0;
}

export function insertSessionRow(db, row) {
  db.run(`INSERT INTO authSessions (${SESSION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    row.id,
    row.createdAt,
    row.lastSeenAt,
    row.expiresAt,
    row.ip ?? null,
    row.userAgent ?? null,
    row.label ?? null,
    null,
    null,
  ]);
}

export function getSessionRow(db, id) {
  return db.get(`SELECT ${SESSION_COLUMNS} FROM authSessions WHERE id = ?`, [id]) || null;
}

export function listSessionRows(db) {
  return db.all(`SELECT ${SESSION_COLUMNS} FROM authSessions ORDER BY createdAt DESC`);
}

export function touchSessionRow(db, id, at) {
  db.run(`UPDATE authSessions SET lastSeenAt = ? WHERE id = ?`, [at, id]);
}

/** Revoke one session. Returns false when it was already revoked — an honest
 *  no-op, never counted as a fresh revocation. */
export function revokeSessionRow(db, id, { at, reason = null } = {}) {
  const res = db.run(
    `UPDATE authSessions SET revokedAt = ?, revokedReason = ? WHERE id = ? AND revokedAt IS NULL`,
    [at, reason, id]
  );
  return (res?.changes ?? 0) > 0;
}

/** Logout-everywhere. `keepId` spares the caller's own session when asked. */
export function revokeAllSessionRows(db, { at, reason = null, keepId = null } = {}) {
  if (keepId) {
    const res = db.run(
      `UPDATE authSessions SET revokedAt = ?, revokedReason = ? WHERE revokedAt IS NULL AND id <> ?`,
      [at, reason, keepId]
    );
    return res?.changes ?? 0;
  }
  const res = db.run(
    `UPDATE authSessions SET revokedAt = ?, revokedReason = ? WHERE revokedAt IS NULL`,
    [at, reason]
  );
  return res?.changes ?? 0;
}

/** Drop rows that can no longer authenticate anyone. */
export function deleteExpiredSessionRows(db, nowIso) {
  const res = db.run(`DELETE FROM authSessions WHERE expiresAt < ?`, [nowIso]);
  return res?.changes ?? 0;
}

export function insertAuditRow(db, { ts, eventType, ip = null, userAgent = null, detail = null }) {
  db.run(
    `INSERT INTO authAuditLog (ts, eventType, ip, userAgent, detail) VALUES (?, ?, ?, ?, ?)`,
    [ts, eventType, ip, userAgent, detail]
  );
}

export function listAuditRows(db, limit = 100) {
  const lim = Math.max(1, Math.min(Number(limit) || 100, 500));
  return db.all(
    `SELECT id, ts, eventType, ip, userAgent, detail FROM authAuditLog ORDER BY ts DESC, id DESC LIMIT ?`,
    [lim]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Async wrappers — the routes and the audit writer ride these.
// ─────────────────────────────────────────────────────────────────────────────

export async function insertAuthSession(row) {
  return insertSessionRow(await getAdapter(), row);
}

export async function getAuthSession(id) {
  return getSessionRow(await getAdapter(), id);
}

export async function listAuthSessions() {
  return listSessionRows(await getAdapter());
}

export async function revokeAuthSession(id, opts) {
  return revokeSessionRow(await getAdapter(), id, opts);
}

export async function revokeAllAuthSessions(opts) {
  return revokeAllSessionRows(await getAdapter(), opts);
}

export async function touchAuthSession(id, at) {
  return touchSessionRow(await getAdapter(), id, at);
}

export async function pruneAuthSessions(nowIso) {
  return deleteExpiredSessionRows(await getAdapter(), nowIso);
}

export async function insertAuthAuditRow(row) {
  return insertAuditRow(await getAdapter(), row);
}

export async function listAuthAuditRows(limit) {
  return listAuditRows(await getAdapter(), limit);
}

export async function clearAllAuthFailures() {
  return deleteAllFailureRows(await getAdapter());
}
