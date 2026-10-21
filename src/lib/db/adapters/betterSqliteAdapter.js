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

  // Checkpoint WAL periodically so the file stays small for backup/copy.
  // PASSIVE, never TRUNCATE: a periodic TRUNCATE rewrites the WAL file while
  // another handle may still hold frames, and that is one of the shapes behind
  // "database disk image is malformed". PASSIVE copies what it safely can and
  // leaves the file intact. TRUNCATE survives only in gracefulClose, where the
  // single-instance lock proves this process is the sole writer.
  let checkpointTimer = null;
  if (!workerOwnsCheckpoints) {
    checkpointTimer = setInterval(() => {
      try { db.pragma("wal_checkpoint(PASSIVE)"); } catch {}
    }, CHECKPOINT_INTERVAL_MS);
    if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();
  }
  registerNativeHandle({
    disableAutoCheckpoint: () => {
      try { db.pragma("wal_autocheckpoint = 0"); } catch {}
      if (checkpointTimer) { clearInterval(checkpointTimer); checkpointTimer = null; }
    },
    // mode "truncate" is for a SOLE-WRITER flush (backup/close); the default
    // PASSIVE never rewrites the WAL under another handle.
    checkpointNow: (mode = "passive") => { try { db.pragma(`wal_checkpoint(${mode === "truncate" ? "TRUNCATE" : "PASSIVE"})`); } catch {} },
  });

  function gracefulClose() {
    try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }

  // Ensure WAL is flushed and -wal/-shm files removed on shutdown
  const onShutdown = () => gracefulClose();
  const onSigInt = () => { gracefulClose(); process.exit(0); };
  const onSigTerm = () => { gracefulClose(); process.exit(0); };
  const EXIT_HANDLERS = [
    ["beforeExit", onShutdown],
    ["SIGINT", onSigInt],
    ["SIGTERM", onSigTerm],
  ];
  for (const [sig, fn] of EXIT_HANDLERS) process.once(sig, fn);
  const detachExitHandlers = () => {
    for (const [sig, fn] of EXIT_HANDLERS) process.removeListener(sig, fn);
  };

  return {
    driver: "better-sqlite3",
    run(sql, params = []) { return prepare(sql).run(...params); },
    get(sql, params = []) { return prepare(sql).get(...params); },
    all(sql, params = []) { return prepare(sql).all(...params); },
    exec(sql) { return db.exec(sql); },
    transaction(fn) { return db.transaction(fn)(); },
    checkpoint() { try { db.pragma("wal_checkpoint(PASSIVE)"); } catch {} },
    close() {
      clearInterval(checkpointTimer);
      detachExitHandlers();
      gracefulClose();
    },
    raw: db,
  };
}
