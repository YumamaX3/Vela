/**
 * logStore.js — the worker's ONE door to the durable ledger.
 *
 * WHY THIS FILE EXISTS (measured, not assumed):
 *   `tests/unit/db-contract-census.test.js` pins that NO file outside
 *   `src/lib/db/` may touch the raw adapter — `ADAPTER_RE` matches both
 *   `getAdapter` and an import of `driver.js`, and the gate fails on any such
 *   file outside the harbor. So the raw SQL cannot live in logshipper/.
 *
 *   It lives HERE instead, in the storage layer's own house, where the census
 *   permits raw-adapter access — and it is reached with a RELATIVE import from
 *   the worker, because a real Worker spawn does not resolve the `@/` alias.
 *
 * TWO WAYS IN, one SQL body:
 *   - The live store (`getLogStore`) imports the main chain's driver, so the
 *     main thread's adapter instance is reused — no second handle, no second
 *     migration run, no checkpoint collision to solve on this side.
 *   - The worker store (`openWorkerLogStore`) opens its OWN handle, which is
 *     what the plan demands: its own connection, its own statement cache, its
 *     own thread to absorb the commit cost.
 *
 * ═══ THE BINDING MANDATE (the wallkeeper's HIGH finding) ═══
 *   `msg` carries upstream-controlled error text — an provider's own error
 *   string — and is a live injection primitive if concatenated. Every persisted
 *   value reaches SQLite ONLY as a bound parameter (`db.run(INSERT, [vals])`,
 *   `db.all(sel, [vals])`). `exec` is used ONLY for fixed DDL/PRAGMA strings
 *   that carry no caller-supplied text at all. `tests/unit/logshipper-worker.test.js`
 *   proves the injection literal lands intact as data, and greps this whole
 *   directory for concatenated SQL as a standing ratchet.
 */

import { TABLES, buildCreateTableSql } from "../../schema.js";

// The MAIN adapter is resolved LAZILY, by a caller-supplied opener.
//
// WHY (measured, not assumed): this file is imported by logshipper's worker.js
// — a REAL worker_threads Worker loaded by path, and the `@/` alias does NOT
// resolve there (measured: ERR_MODULE_NOT_FOUND, `Cannot find package
// '@/lib'` from src/lib/db/paths.js). A static top-level import of
// `./driver.js` would drag that failure into this module's own evaluation and
// every worker would die at boot. So the import happens at CALL time, in the
// main thread only — which is the one place the alias is guaranteed to work.
// The worker never calls getLogStore(); it builds its store from its own
// handle via createLogStore().
let adapterOpener = null;

/** Register how the main-thread adapter is opened (set by @/lib/db/index.js). */
export function setLogStoreAdapterOpener(opener) {
  adapterOpener = typeof opener === "function" ? opener : null;
}

/**
 * Fixed DDL — no interpolation of any caller-supplied value. The table name and
 * every column come from `TABLES` (the declarative source of truth migration
 * 018 already used), never from a message.
 */
const CREATE_LOGEVENTS_SQL = buildCreateTableSql("logEvents", TABLES.logEvents);

/** Fixed statement, bound parameters only. */
const INSERT_SQL =
  `INSERT INTO logEvents (ts, lvl, stream, reqId, upstreamId, provider, tag, msg, meta, truncMsg, truncMeta)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const COUNT_SQL = "SELECT COUNT(*) AS n FROM logEvents";

const DELETE_ALL_SQL = "DELETE FROM logEvents";

/**
 * Retention sweep (M8 §8). Four FIXED statements, chosen by mode — no
 * interpolation, no string-built LIMIT, and every knob a bound parameter, so
 * even a hostile retention message cannot reach the SQL text.
 *
 * ═══ MEASURED, NOT ASSUMED: WHY THERE IS NO `DELETE … LIMIT` HERE ═══
 * The obvious way to bound a delete is `DELETE … WHERE ts < ? LIMIT ?`. It
 * works on better-sqlite3 and FAILS on node:sqlite, which compiles SQLite
 * without `SQLITE_ENABLE_UPDATE_DELETE_LIMIT`:
 *
 *     node:sqlite     → `near "LIMIT": syntax error`
 *     better-sqlite3 → 3 rows changed
 *
 * The Dockerfile runner PINS `VELA_LOG_DRIVER=node:sqlite` (M10), so the
 * statement that reads correctly and the statement that RUNS are not the same
 * one here. Every chunked delete is therefore expressed with a
 * `SELECT … LIMIT` subquery — standard SQL, identical on all four drivers:
 *
 *     age  chunked → 3 rows    better-sqlite3 → 3 rows
 *     rows chunked → 2 rows    better-sqlite3 → 2 rows
 *
 * The knob stays bound: the chunk size is a `?` inside the subquery, never text
 * spliced into the statement.
 *
 * The rows ceiling is a subquery over the NEWEST `maxRows` ids — `id` is
 * INTEGER PRIMARY KEY AUTOINCREMENT, so rowid order IS arrival order, and
 * `id < MIN(newest ids)` is precisely "everything older than the kept window".
 */
const RETENTION_SQL = {
  "age-chunked": "DELETE FROM logEvents WHERE id IN (SELECT id FROM logEvents WHERE ts < ? ORDER BY id LIMIT ?)",
  rows: "DELETE FROM logEvents WHERE id < (SELECT MIN(id) FROM (SELECT id FROM logEvents ORDER BY id DESC LIMIT ?))",
  "rows-chunked":
    "DELETE FROM logEvents WHERE id IN (SELECT id FROM logEvents WHERE id < (SELECT MIN(id) FROM (SELECT id FROM logEvents ORDER BY id DESC LIMIT ?)) ORDER BY id LIMIT ?)",
};

/** The single fixed-`exec` PRAGMA the worker store issues. */
const WAL_AUTOCHECKPOINT_SQL = "PRAGMA wal_autocheckpoint = 0";

/**
 * The chunk size, clamped to a sane band. A caller asking for zero rows or a
 * billion gets a real bounded statement either way — the sweep must never be
 * able to issue an empty DELETE (a silent no-op that reads as "nothing to
 * prune") or an unbounded one.
 */
function chunkLimit(retention) {
  const n = Math.floor(Number(retention?.chunkRows));
  if (!Number.isFinite(n) || n < 1) return 20_000;
  return Math.min(n, 200_000);
}

function assertStoreShape(db) {
  if (!db || typeof db.run !== "function" || typeof db.all !== "function") {
    throw new Error("[logshipper] store adapter is not the portable surface (run/get/all/exec)");
  }
}

function rowParams(row) {
  return [
    Number(row.ts) || Date.now(),
    Number(row.lvl) || 20,
    String(row.stream || "console"),
    row.reqId ?? null,
    row.upstreamId ?? null,
    row.provider ?? null,
    row.tag ?? null,
    String(row.msg ?? ""),
    row.meta ?? null,
    row.truncMsg ? 1 : 0,
    row.truncMeta ? 1 : 0,
  ];
}

/**
 * Shape shared by both doors. `db` is whatever the caller opened; this object
 * never sees a path and never resolves a driver itself.
 */
export function createLogStore(db) {
  assertStoreShape(db);
  return {
    driver: db.driver || "unknown",
    /** Ensure the ledger table exists (fixed DDL, safe under exec). */
    ensureTable() {
      db.exec(CREATE_LOGEVENTS_SQL);
    },
    /** Worker-store only: the worker's handle never runs the TRUNCATE timer. */
    disableAutoCheckpoint() {
      db.exec(WAL_AUTOCHECKPOINT_SQL);
    },
    /** ONE transaction for the whole batch — the plan's batch-commit law. */
    insertBatch(rows) {
      if (!rows.length) return 0;
      const params = rows.map(rowParams);
      return db.transaction(() => {
        let n = 0;
        for (const p of params) {
          db.run(INSERT_SQL, p);
          n += 1;
        }
        return n;
      });
    },
    count() {
      const row = db.get(COUNT_SQL, []);
      return Number(row?.n ?? 0);
    },
    /** Clear execution (§6 ordering, step 3). Fixed SQL, bound values only. */
    clear() {
      const before = this.count();
      db.run(DELETE_ALL_SQL, []);
      return before;
    },
    /**
     * One retention sweep step. Returns rows removed.
     *
     * `retention` is a NAMED shape read off validated policy — never a spread
     * of a caller object. `mode` must be one of the four keys above;
     * anything else is a no-op, because a sweep whose mode it does not
     * recognise must not guess a DELETE.
     */
    applyRetention(retention) {
      const mode = typeof retention?.mode === "string" ? retention.mode : "";
      const sql = RETENTION_SQL[mode];
      if (!sql) return 0;
      let params;
      if (mode === "age") {
        const cutoff = Number(retention.cutoffMs);
        if (!Number.isFinite(cutoff)) return 0;
        params = [cutoff];
      } else if (mode === "age-chunked") {
        const cutoff = Number(retention.cutoffMs);
        if (!Number.isFinite(cutoff)) return 0;
        params = [cutoff, chunkLimit(retention)];
      } else if (mode === "rows") {
        const keep = Number(retention.maxRows);
        if (!Number.isFinite(keep) || keep < 1) return 0;
        params = [Math.floor(keep)];
      } else {
        const keep = Number(retention.maxRows);
        if (!Number.isFinite(keep) || keep < 1) return 0;
        params = [Math.floor(keep), chunkLimit(retention)];
      }
      const r = db.run(sql, params);
      return Number(r?.changes ?? 0);
    },
    checkpoint() {
      try { db.checkpoint?.(); } catch {}
    },
    close() {
      try { db.close(); } catch {}
    },
  };
}

/** The MAIN-thread store — reuses the main adapter singleton. */
export async function getLogStore() {
  const db = adapterOpener ? await adapterOpener() : await import("../../driver.js").then((m) => m.getAdapter());
  const store = createLogStore(db);
  store.ensureTable();
  return store;
}