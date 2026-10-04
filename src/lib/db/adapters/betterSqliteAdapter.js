import Database from "better-sqlite3";
import { PRAGMA_SQL } from "../schema.js";
import { registerNativeHandle, workerOwnsCheckpointing } from "../checkpointOwner.js";

// Periodic checkpoint to keep WAL file small (avoid huge -wal/-shm growth)
const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export function createBetterSqliteAdapter(filePath) {
  const db = new Database(filePath);
  db.exec(PRAGMA_SQL);

  // §2 checkpoint ownership — see nodeSqliteAdapter.js for the full rationale.
  // Both native adapters must answer it: which one resolves is a runtime
  // question (better-sqlite3 first, node:sqlite ≥22.5 next), and the main
  // thread must be proven opted-out whichever way the chain fell.
  const workerOwnsCheckpoints = workerOwnsCheckpointing();
  if (workerOwnsCheckpoints) {
    try { db.pragma("wal_autocheckpoint = 0"); } catch {}
  }
  // Schema is created/synced by migrate.js after adapter init

  const stmtCache = new Map();

  function prepare(sql) {
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  // Truncate WAL periodically so file stays small for backup/copy. Suppressed
  // entirely when the worker owns checkpointing.
  let checkpointTimer = null;
  if (!workerOwnsCheckpoints) {
    checkpointTimer = setInterval(() => {
      try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    }, CHECKPOINT_INTERVAL_MS);
    if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();
  }
  registerNativeHandle({
    disableAutoCheckpoint: () => {
      try { db.pragma("wal_autocheckpoint = 0"); } catch {}
      if (checkpointTimer) { clearInterval(checkpointTimer); checkpointTimer = null; }
    },
    checkpointNow: () => { try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {} },
  });

  function gracefulClose() {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }

  // Ensure WAL is flushed and -wal/-shm files removed on shutdown
  const onShutdown = () => gracefulClose();
  process.once("beforeExit", onShutdown);
  process.once("SIGINT", () => { onShutdown(); process.exit(0); });
  process.once("SIGTERM", () => { onShutdown(); process.exit(0); });

  return {
    driver: "better-sqlite3",
    run(sql, params = []) { return prepare(sql).run(...params); },
    get(sql, params = []) { return prepare(sql).get(...params); },
    all(sql, params = []) { return prepare(sql).all(...params); },
    exec(sql) { return db.exec(sql); },
    transaction(fn) { return db.transaction(fn)(); },
    checkpoint() { try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {} },
    close() {
      clearInterval(checkpointTimer);
      gracefulClose();
    },
    raw: db,
  };
}
