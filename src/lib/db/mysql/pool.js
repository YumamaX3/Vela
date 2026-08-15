// Storage Covenant Wave A6 — the mysql2 pool + async adapter.
// Plan: plans/storage-covenant.md A6 (line 271): "mysql/pool.js (min:0/max:8,
// keepalive, one-retry on ECONNRESET)" and line 134: "mysql2 pool adapter with
// connection-bound transaction shims".
//
// The adapter shape mirrors the sqlite contract (run/get/all/exec/transaction,
// {changes, lastInsertRowid} from run) but is ASYNC — mysql2 is network-bound.
// The mysql repos (Waves A7–A9) are written natively against this shape; the
// bind.js facade layer unwraps the promises, exactly as the covenant names.
import { setTimeout as delay } from "node:timers/promises";
import { AsyncLocalStorage } from "node:async_hooks";

/** Transaction nesting (Wave C3) — a db.transaction() invoked while already
 *  inside a transaction RIDES the outer connection instead of opening a
 *  second one: the pump's apply (dedupe row + repo dispatch) must be ONE
 *  mysql transaction, and the twin repos open their own db.transaction().
 *  Waves A7–A9 never nest, so their behavior is untouched — the pass-through
 *  fires only when a transaction is already open on the current async chain. */
const txContext = new AsyncLocalStorage();

/** Parse VELA_MYSQL_URL=mysql://user:pass@host:3306/db — loud on bad shape. */
export function parseMysqlUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`[DB][mysql] VELA_MYSQL_URL is not a valid URL: ${raw}`);
  }
  if (u.protocol !== "mysql:") {
    throw new Error(`[DB][mysql] VELA_MYSQL_URL must start with mysql:// (got "${u.protocol}")`);
  }
  const database = u.pathname.replace(/^\//, "");
  if (!database) throw new Error(`[DB][mysql] VELA_MYSQL_URL must name a database: mysql://user:pass@host:3306/vela`);
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
  };
}

async function loadMysql2() {
  try {
    return await import("mysql2/promise");
  } catch {
    throw new Error("[DB][mysql] mysql2 is not installed — it is an optionalDependency: run `npm install mysql2`");
  }
}

/** Create the pool — min:0/max:8, keepalive, bounded connect timeout. */
export async function createMysqlPool(url) {
  const mysql = await loadMysql2();
  const cfg = parseMysqlUrl(url);
  return mysql.createPool({
    ...cfg,
    connectionLimit: 8,           // plan line 271: min:0/max:8
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,        // plan line 271: keepalive
    keepAliveInitialDelay: 10_000,
    connectTimeout: 4_000,
    multipleStatements: true,     // exec() parity with sqlite (bootstrap DDL)
    decimalNumbers: true,         // DECIMAL(12,6) cost → JS number, not string
    dateStrings: false,
  });
}

/** One query with ONE retry on ECONNRESET (plan line 271) — the pool has
 *  already replaced the dead connection; a second hit is a real failure. */
async function queryWithRetry(pool, sql, params) {
  try {
    return await pool.query(sql, params);
  } catch (e) {
    if (e && e.code === "ECONNRESET") return pool.query(sql, params);
    throw e;
  }
}

/** Wrap a pool in the adapter contract the repos consume. */
export function wrapMysqlPool(pool) {
  const runResult = (r) => ({ changes: r?.affectedRows ?? 0, lastInsertRowid: r?.insertId ?? 0 });
  return {
    driver: "mysql2",
    async run(sql, params = []) {
      const [r] = await queryWithRetry(pool, sql, params);
      return runResult(r);
    },
    async get(sql, params = []) {
      const [rows] = await queryWithRetry(pool, sql, params);
      return rows[0];
    },
    async all(sql, params = []) {
      const [rows] = await queryWithRetry(pool, sql, params);
      return rows;
    },
    async exec(sql) {
      await queryWithRetry(pool, sql);
    },
    // Connection-bound transaction shim (plan line 134): fn receives a
    // conn-scoped adapter so every statement rides ONE connection — the
    // mysql twin of sqlite's sync, no-yield transaction. Nested calls ride
    // the outer transaction's connection (txContext) — see header.
    async transaction(fn) {
      const outer = txContext.getStore();
      if (outer) return fn(outer);
      const conn = await pool.getConnection();
      const scoped = {
        async run(sql, params = []) { const [r] = await conn.query(sql, params); return runResult(r); },
        async get(sql, params = []) { const [rows] = await conn.query(sql, params); return rows[0]; },
        async all(sql, params = []) { const [rows] = await conn.query(sql, params); return rows; },
        async exec(sql) { await conn.query(sql); },
      };
      try {
        await conn.beginTransaction();
        // Return the callback's value — the sqlite contract the shape mirrors
        // (better-sqlite3's transaction() returns fn's result); the Wave A7–A9
        // repos ignore it via closure vars, but mirrorApplyRepo (C3) needs it.
        const result = await txContext.run(scoped, () => fn(scoped));
        await conn.commit();
        return result;
      } catch (err) {
        try { await conn.rollback(); } catch {}
        throw err;
      } finally {
        conn.release();
      }
    },
    async close() {
      await pool.end();
    },
    raw: pool,
  };
}

/** Probe reachability for the boot gate — loud on any failure, always closes. */
export async function probeMysqlUrl(url) {
  const pool = await createMysqlPool(url);
  try {
    const conn = await pool.getConnection();
    try {
      await conn.query("SELECT 1");
    } finally {
      conn.release();
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

/** Full adapter for a reachable VELA_MYSQL_URL (used by Waves A7+). */
export async function createMysqlAdapter(url) {
  const pool = await createMysqlPool(url);
  return wrapMysqlPool(pool);
}

export { delay };
