// Bun runtime adapter — uses built-in bun:sqlite (native, fastest under Bun).
// Loaded only when process.versions.bun is present.
import { PRAGMA_SQL } from "../schema.js";
import { registerNativeHandle, workerOwnsCheckpointing } from "../checkpointOwner.js";

const CHECKPOINT_INTERVAL_MS = 60 * 1000;

export async function createBunSqliteAdapter(filePath) {
  // Dynamic import — only resolves under Bun runtime
  const { Database } = await import("bun:sqlite");
  const db = new Database(filePath, { create: true });
  db.exec(PRAGMA_SQL);

  // §2 checkpoint ownership — the third native adapter answers it too.
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

  let checkpointTimer = null;
  if (!workerOwnsCheckpoints) {
    checkpointTimer = setInterval(() => {
      try { db.exec("PRAGMA wal_checkpoint(PASSIVE)"); } catch {}
    }, CHECKPOINT_INTERVAL_MS);
    if (typeof checkpointTimer.unref === "function") checkpointTimer.unref();
  }
  registerNativeHandle({
    disableAutoCheckpoint: () => {
      try { db.exec("PRAGMA wal_autocheckpoint = 0"); } catch {}
      if (checkpointTimer) { clearInterval(checkpointTimer); checkpointTimer = null; }
    },
    // mode "truncate" is for a SOLE-WRITER flush (backup/close); the default
    // PASSIVE never rewrites the WAL under another handle.
    checkpointNow: (mode = "passive") => { try { db.exec(`PRAGMA wal_checkpoint(${mode === "truncate" ? "TRUNCATE" : "PASSIVE"})`); } catch {} },
  });

  function gracefulClose() {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch {}
    try { stmtCache.clear(); } catch {}
    try { db.close(); } catch {}
  }
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
    driver: "bun:sqlite",
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
      // bun:sqlite has db.transaction() API (similar to better-sqlite3)
      const tx = db.transaction(fn);
      return tx();
    },
    checkpoint() { try { db.exec("PRAGMA wal_checkpoint(PASSIVE)"); } catch {} },
    close() {
      clearInterval(checkpointTimer);
      detachExitHandlers();
      gracefulClose();
    },
    raw: db,
  };
}
