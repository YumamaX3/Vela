// Built-in node:sqlite adapter — available in Node >= 22.5.0.
// No native build, no npm install. API mirrors betterSqliteAdapter.
import { PRAGMA_SQL } from "../schema.js";
import { registerNativeHandle, workerOwnsCheckpointing } from "../checkpointOwner.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export async function createNodeSqliteAdapter(filePath) {
  // Suppress "ExperimentalWarning: SQLite is an experimental feature" from node:sqlite.
  // Stable enough for production use as of Node 22.x (RC quality).
  const origEmit = process.emit;
  process.emit = function (name, data, ...rest) {
    if (name === "warning" && data?.name === "ExperimentalWarning" && /SQLite/i.test(data.message || "")) {
      return false;
    }
    return origEmit.call(process, name, data, ...rest);
  };

  // Dynamic import — fails on Node < 22.5 → driver.js falls back to sql.js
  const sqlite = await import("node:sqlite");
  const Database = sqlite.DatabaseSync;
  const db = new Database(filePath);

  db.exec(PRAGMA_SQL);

  // §2 checkpoint ownership: when the logshipper worker owns checkpointing,
  // this handle is born opted out — wal_autocheckpoint = 0 (reads are served
  // from the WAL regardless) and NO TRUNCATE interval, so no serving-path
  // statement can ever wait on a checkpoint lock the worker is holding.
  const workerOwnsCheckpoints = workerOwnsCheckpointing();
  if (workerOwnsCheckpoints) {
    try { db.exec("PRAGMA wal_autocheckpoint = 0"); } catch {}
  }

  const stmtCache = new Map();
  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  // Periodic WAL checkpoint to keep -wal/-shm small. Suppressed entirely when
  // the worker owns checkpointing — a TRUNCATE here waits on the worker's
  // write transaction and froze the main thread for 5,495 ms (measured).
  let checkpointTimer = null;
  if (!workerOwnsCheckpoints) {
    checkpointTimer = setInterval(() => {
      try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    }, CHECKPOINT_INTERVAL_MS);
    if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();
  }
  registerNativeHandle({
    disableAutoCheckpoint: () => {
      try { db.exec("PRAGMA wal_autocheckpoint = 0"); } catch {}
      if (checkpointTimer) { clearInterval(checkpointTimer); checkpointTimer = null; }
    },
    checkpointNow: () => { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {} },
  });

  function gracefulClose() {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }
  const onShutdown = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => { onShutdown(); process.exit(0); });
  process.once("SIGTERM", () => { onShutdown(); process.exit(0); });

  return {
    driver: "node:sqlite",
    // Exposed so the checkpoint-ownership test can PROVE the timer is genuinely
    // ABSENT, not merely unref'd. The `wal_autocheckpoint = 0` pragma reads 0
    // either way, so it cannot by itself distinguish "suppressed" from
    // "registered but idle" — which is precisely the mutation that would
    // reintroduce the 5,495 ms main-thread freeze this ownership exists to end.
    hasCheckpointTimer: () => checkpointTimer !== null,
    run(sql, params = []) {
      const r = prepare(sql).run(...params);
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
    },
    get(sql, params = []) {
      return prepare(sql).get(...params);
    },
    all(sql, params = []) {
      return prepare(sql).all(...params);
    },
    exec(sql) { return db.exec(sql); },
    transaction(fn) {
      // node:sqlite has no transaction wrapper. Use SAVEPOINT for nested support.
      const sp = `sp_${Math.random().toString(36).slice(2)}`;
      db.exec(`SAVEPOINT ${sp}`);
      try {
        const r = fn();
        db.exec(`RELEASE ${sp}`);
        return r;
      } catch (e) {
        try { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); } catch {}
        throw e;
      }
    },
    checkpoint() { try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {} },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
    raw: db,
  };
}
