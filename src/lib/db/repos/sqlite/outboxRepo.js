// Storage Covenant Wave C1 — the outbox persistence seam (sqlite harbor).
// The mirror pump's LOGICAL OP-LOG lives only on the sqlite primary: every
// writer the decorator captures lands here as one row; the pump (Wave C3)
// drains pending rows seq-ordered into the mysql twin. Adapter access stays
// in repos/sqlite/ so the census ratchet holds — the orchestration layer
// (src/lib/db/mirror/) never touches the driver directly.
//
// enqueueOutbox is SYNC on purpose: the decorator's atomic-containment path
// inserts the outbox row inside the SAME SAVEPOINT as the writer's own
// mutation, and every sqlite driver (better/bun/node/sql.js) exposes run()
// synchronously.
import { getAdapter } from "../../driver.js";
import { stringifyJson } from "../../helpers/jsonCol.js";
import { REDACTED_SENTINEL } from "../backupSecurity.js";

/** Record one captured writer invocation. Returns nothing — the pump reads
 *  pending rows by seq order. Args/identity are JSON-serialized; the S3
 *  exclusion (EXPORT_EXCLUDED_TABLES) keeps them out of every artifact. */
export function enqueueOutboxSync(db, { replayClass, fnName, args, identity = null }) {
  db.run(
    `INSERT INTO outbox(replayClass, fnName, args, identity, status, retries, createdAt) VALUES(?, ?, ?, ?, 'pending', 0, ?)`,
    [replayClass, fnName, stringifyJson(args ?? []), identity ? stringifyJson(identity) : null, new Date().toISOString()]
  );
}

/** Async convenience wrapper for the await-bearing capture path. */
export async function enqueueOutbox(entry) {
  const db = await getAdapter();
  enqueueOutboxSync(db, entry);
}

let _spCounter = 0;

/** Atomic containment for the mirror decorator (Wave C2). Opens a raw
 *  SAVEPOINT, runs the writer inside it, and — on success — enqueues the
 *  outbox row in the SAME savepoint before RELEASE, so the writer's mutation
 *  and its op-log entry commit together or not at all. On writer failure the
 *  savepoint rolls back (no orphan outbox row, no half-applied write).
 *
 *  Proven across better-sqlite3 / node:sqlite / sql.js: a writer's own nested
 *  db.transaction() rides inside the open savepoint (SAVEPOINTs nest). The
 *  savepoint is connection-scoped, so it stays open across the writer's
 *  awaits — every classified writer is async and writes synchronously once the
 *  adapter resolves, which collapses the plan's fail-open crash window to zero
 *  for the contained path. The one residual window (process death between the
 *  writer's internal await and the RELEASE) rolls the savepoint back anyway.
 *
 *  Lives in repos/sqlite/ (the harbor) so the mirror orchestration layer never
 *  touches the driver directly — the census ratchet holds. */
export async function withOutboxCapture(buildEntry, writerFn) {
  const db = await getAdapter();
  const sp = `sp_mirror_${++_spCounter}`;
  db.exec(`SAVEPOINT ${sp}`);
  try {
    const result = await writerFn();
    const entry = typeof buildEntry === "function" ? buildEntry(result) : buildEntry;
    if (entry && entry.replayClass) enqueueOutboxSync(db, entry);
    db.exec(`RELEASE ${sp}`);
    return result;
  } catch (e) {
    try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
    throw e;
  }
}

/** Pending (or failed-retryable) rows in seq order, oldest first. */
export async function fetchPendingOutbox(limit = 100) {
  const db = await getAdapter();
  return db.all(
    `SELECT seq, replayClass, fnName, args, identity, status, retries, error, createdAt FROM outbox WHERE status IN ('pending', 'retry') ORDER BY seq ASC LIMIT ?`,
    [limit]
  );
}

/** Mark a row applied (pump succeeded). */
export async function markOutboxApplied(seq) {
  const db = await getAdapter();
  db.run(`UPDATE outbox SET status = 'applied', appliedAt = ?, error = NULL WHERE seq = ?`, [new Date().toISOString(), seq]);
}

/** Record one failed attempt; the pump decides retry vs poison (Wave C3). */
export async function markOutboxFailed(seq, error, retries) {
  const db = await getAdapter();
  db.run(
    `UPDATE outbox SET status = 'retry', retries = ?, error = ? WHERE seq = ?`,
    [retries, String(error ?? "").slice(0, 2000), seq]
  );
}

/** Poison verdict — the op exceeded its retry budget; SKIP it (never
 *  head-of-line-block replication), surface for manual replay. */
export async function markOutboxPoison(seq, error, retries) {
  const db = await getAdapter();
  db.run(
    `UPDATE outbox SET status = 'failed', retries = ?, error = ? WHERE seq = ?`,
    [retries, String(error ?? "").slice(0, 2000), seq]
  );
}

/** Prune applied rows older than the retention window (24h per plan). */
export async function pruneAppliedOutbox(olderThanMs = 24 * 60 * 60 * 1000) {
  const db = await getAdapter();
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const res = db.run(`DELETE FROM outbox WHERE status = 'applied' AND appliedAt < ?`, [cutoff]);
  return { pruned: res?.changes ?? 0 };
}

// ─── Wave C3 — the pump's seam ────────────────────────────────────────────

/** S3 clause three — args may carry secrets (OAuth tokens, provider keys).
 *  After the FIRST apply attempt the twin either has the row (args spent) or
 *  will poison out; either way the plaintext cargo is burned here so an
 *  outage window never becomes an unbounded token journal in data.sqlite. */
export async function redactOutboxArgs(seq) {
  const db = await getAdapter();
  db.run(`UPDATE outbox SET args = ? WHERE seq = ?`, [REDACTED_SENTINEL, seq]);
}

/** A replay that can never apply but is NOT poison: an exempt-class row the
 *  pump walked past, or an identity-carrying row whose identity was lost
 *  (redacted args + null identity after the crash window). Terminal, audited
 *  via the error column — never retried, never head-of-line-blocking. */
export async function markOutboxSkipped(seq, error) {
  const db = await getAdapter();
  db.run(
    `UPDATE outbox SET status = 'skipped', appliedAt = ?, error = ? WHERE seq = ?`,
    [new Date().toISOString(), String(error ?? "").slice(0, 2000), seq]
  );
}

/** The sqlite side of the apply cursor (migration 007). The mysql twin's
 *  counterpart is the seq-dedupe table — the two converge as the pump drains. */
export async function getMirrorCursor() {
  const db = await getAdapter();
  const row = db.get(`SELECT lastAppliedSeq, lastFailedSeq FROM mirrorSeq WHERE id = 1`);
  return { lastAppliedSeq: row?.lastAppliedSeq ?? 0, lastFailedSeq: row?.lastFailedSeq ?? 0 };
}

/** Advance the cursor. Either field may be null to leave that side untouched. */
export async function setMirrorCursor(appliedSeq, failedSeq) {
  const db = await getAdapter();
  db.run(
    `UPDATE mirrorSeq SET
       lastAppliedSeq = CASE WHEN ? IS NULL THEN lastAppliedSeq ELSE ? END,
       lastFailedSeq  = CASE WHEN ? IS NULL THEN lastFailedSeq  ELSE ? END
     WHERE id = 1`,
    [appliedSeq ?? null, appliedSeq ?? null, failedSeq ?? null, failedSeq ?? null]
  );
}

/** S3 clause three (age-out) — rows older than the window leave the journal
 *  REGARDLESS of status. Poison rows stay visible in the ledger alert; the
 *  outbox itself must stay bounded even through a long twin outage. Returns
 *  how many STILL-PENDING ops aged out so the pump can alert loudly. */
export async function pruneOutboxWindow(days = 7) {
  const db = await getAdapter();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const aging = db.get(
    `SELECT COUNT(*) AS n FROM outbox WHERE createdAt < ? AND status IN ('pending', 'retry')`,
    [cutoff]
  );
  const res = db.run(
    `DELETE FROM outbox WHERE createdAt < ? AND status IN ('pending', 'retry', 'applied')`,
    [cutoff]
  );
  return { pruned: res?.changes ?? 0, agedPending: aging?.n ?? 0 };
}
