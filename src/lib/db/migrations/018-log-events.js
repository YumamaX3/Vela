/**
 * Migration 018: the log pipeline's ledger and its two join keys.
 * (The sealed log-pipeline plan — milestone M2, "The Table")
 *
 * Before this wave the harbor had three separate record-keepers that could not
 * be joined to one another: the gateway's console room (console.* calls), the
 * container room (what the process writes to fd 1/2), and the request ledger
 * (per-request usage). Each was authoritative about its own room and blind to
 * the other two. So the question an operator actually asks — "show me what
 * happened to THIS request" — had no query that could answer it, and no id
 * that could anchor one.
 *
 * This migration lays the stone both halves stand on:
 *
 *   1. logEvents — one append-only ledger, three streams in one room.
 *        stream  — which of the three a row came from: 'console' | 'container'
 *                  | 'request'. Declared as the writer's contract, not as a
 *                  CHECK: the room must be able to grow a stream without a
 *                  migration, and no query in this plan depends on the set
 *                  being closed.
 *        ts      — epoch-ms INTEGER, not the TEXT ISO the rest of this schema
 *                  uses. authFailures (016) set the precedent: this ledger is
 *                  range-queried on every read, and an integer comparison is
 *                  the one SQLite can serve from an index without parsing a
 *                  string first.
 *        lvl     — numeric severity (10 debug · 20 info · 30 warn · 40 error ·
 *                  50 fatal) so a threshold filter is `lvl >= ?` rather than
 *                  a chain of string equality tests.
 *        id      — INTEGER PRIMARY KEY AUTOINCREMENT, and this is the load-
 *                  bearing choice. rowid order IS arrival order: monotonic,
 *                  with no tie-break to invent. Epoch-ms timestamps cannot
 *                  promise that — two lines written inside one millisecond
 *                  collide, and a client resuming on `ts` alone either drops
 *                  one or replays the other forever. `WHERE id > ?` resumes a
 *                  live stream with neither a duplicate nor a gap, which is
 *                  the entire reason a cursor anchor is worth an autoincrement.
 *        truncMsg / truncMeta — DEDICATED flags, not fields inside the clamped
 *                  `meta` blob. That restraint is the r3 law: a truncation flag
 *                  hidden in JSON is a flag a consumer that does not know to
 *                  look for will silently never see, and a clipped line then
 *                  reads as the whole truth. The clamps themselves (8,000 on
 *                  `msg`, 16,000 on `meta`) belong to the write door in a
 *                  later milestone — a schema cannot enforce a length a
 *                  clamping writer is responsible for, and a CHECK constraint
 *                  that rejects an oversized line would drop the very log line
 *                  an operator needed to diagnose the drop.
 *        NO FTS5. Not by oversight — an FTS index would have to be populated by
 *                  a trigger or a rebuild, and both are dialect-specific
 *                  (MySQL has no FTS5, and the MariaDB twin builds its DDL
 *                  from this same TABLES entry). A LIKE scan over the clamped
 *                  `msg` is honest and portable; full-text is an optimization
 *                  this design can earn later without a schema break.
 *
 *   2. usageHistory.reqId / usageHistory.upstreamId — the join keys that turn
 *      two ledgers into one story. `reqId` is the gateway's own request id
 *      (one per inbound request, across every fallback hop); `upstreamId` is
 *      the provider's own id for the SPECIFIC upstream call that produced
 *      this row, so a multi-hop request keeps one thread per hop rather than
 *      collapsing into one. A log line and the usage it produced can now be
 *      read together by either id.
 *
 * WHY uq_uh_dedupe IS DELIBERATELY UNTOUCHED: the dedupe identity is a claim
 * that two rows are the same usage EVENT. A request id is not part of that
 * claim. Folding reqId into the UNIQUE would let a legitimate retry — which is
 * a second real upstream call, and which this gateway does perform — write a
 * second row where the ledger expects one, silently double-counting tokens and
 * cost. The unique index therefore keeps exactly the seven columns it had, and
 * tests/unit/usagehistory-reqid.test.js pins that identity so a later tide
 * cannot quietly widen it.
 *
 * WHY ONE TABLE AND NOT THREE: the whole point of the seam is that a single
 * query can cross streams. Three tables with three shapes would put the join
 * back in the reader and make "one stream, cursor from the same anchor" true
 * for none of them. `stream` names the room; it does not partition the stone.
 *
 * MYSQL TWIN: bootstrap.js brings the table, the two new columns and all six
 * indexes forward by its additive TABLES diff — schema.js is the single source
 * of truth, so the versioned chain, the additive auto-sync and the twin cannot
 * drift into three dialects. ddlMap.js needs no change: TEXT columns that are
 * index members become VARCHAR(191), and INTEGER PRIMARY KEY AUTOINCREMENT
 * becomes BIGINT NOT NULL AUTO_INCREMENT, both already handled.
 *
 * ADAPTER CONTRACT: portable surface only — db.all(PRAGMA) + db.exec(...),
 * every statement IF NOT EXISTS so a replay against a migrated database is a
 * no-op. NEVER db.prepare (the 0.9.19/0.9.22 boot storms — the sql.js and
 * MariaDB adapters have no public prepare at all).
 */

import { TABLES, buildCreateTableSql } from "../schema.js";

const NEW_TABLES = ["logEvents"];

const USAGE_COLUMNS = [
  ["reqId", "TEXT"], // the gateway request id; NULL = pre-instrumentation
  ["upstreamId", "TEXT"], // the provider's id for THIS upstream call
];

const USAGE_INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_uh_reqId ON usageHistory(reqId)",
  "CREATE INDEX IF NOT EXISTS idx_uh_upstreamId ON usageHistory(upstreamId)",
];

// 002's addColumns pattern, verbatim in spirit: PRAGMA table_info guard so a
// fresh install (which already carries the columns from TABLES) and an upgrade
// from v17 both survive a replay.
function addColumns(db, table, columns) {
  const have = new Set(db.all(`PRAGMA table_info(${table})`).map((r) => r.name));
  for (const [col, def] of columns) {
    if (!have.has(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

const up = (db) => {
  for (const name of NEW_TABLES) {
    // buildCreateTableSql emits the table only — the indexes are ours to issue.
    db.exec(buildCreateTableSql(name, TABLES[name]));
    for (const idx of TABLES[name].indexes || []) db.exec(idx);
  }
  addColumns(db, "usageHistory", USAGE_COLUMNS);
  for (const sql of USAGE_INDEXES) db.exec(sql);
};

const down = (db) => {
  // The table's inverse IS expressible, so it is written — the same call 016
  // and 017 make for a pure addition.
  for (const name of [...NEW_TABLES].reverse()) {
    db.exec(`DROP TABLE IF EXISTS ${name}`);
  }
  db.exec("DROP INDEX IF EXISTS ix_log_ts");
  db.exec("DROP INDEX IF EXISTS ix_log_req");
  db.exec("DROP INDEX IF EXISTS ix_log_up");
  db.exec("DROP INDEX IF EXISTS ix_log_provider");
  db.exec("DROP INDEX IF EXISTS idx_uh_reqId");
  db.exec("DROP INDEX IF EXISTS idx_uh_upstreamId");
  // The two usageHistory COLUMNS stay. SQLite cannot DROP COLUMN on older
  // versions, and leaving them is the documented rollback path every other
  // additive-column migration takes (002's W2/W3 columns, 013, 015). Half a
  // rollback is worse than a named, honest one: the table is gone and the
  // join keys are inert until 018 is re-applied.
};

export default { version: 18, name: "log-events", up, down };
export { up, down };