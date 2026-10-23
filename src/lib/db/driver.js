import { ensureDirs, DATA_FILE } from "./paths.js";
import { stripNullBytes } from "./helpers/nullBytes.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

async function tryBunSqlite(filePath = DATA_FILE) {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(filePath);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite(filePath = DATA_FILE) {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(filePath);
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite(filePath = DATA_FILE) {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(filePath);
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs(filePath = DATA_FILE) {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(filePath);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}

// Make every bound string NUL-safe, once, for all SQLite drivers.
//
// SQLite stores TEXT as a NUL-terminated C string, so a bound string with an
// embedded NUL is rejected by better-sqlite3 ("String contains null byte") and
// silently truncated by node:sqlite. Values that carry raw bytes — a model id
// or endpoint from the request, tool output, a diff — can contain one, and the
// write then either aborts the flush worker or loses the tail without a trace.
// Sanitising at the binding boundary covers every driver and every column type
// with a single rule, instead of one call site at a time. MySQL is untouched:
// it accepts NUL in a text column, so the twin keeps its bytes.
function withNullByteSafeParams(adapter) {
  const clean = (params) => (Array.isArray(params) ? params.map(stripNullBytes) : params);
  const wrapped = {
    ...adapter,
    run: (sql, params = []) => adapter.run(sql, clean(params)),
    get: (sql, params = []) => adapter.get(sql, clean(params)),
    all: (sql, params = []) => adapter.all(sql, clean(params)),
  };
  // better-sqlite3 / bun:sqlite hand the callback their own bound statements,
  // so a transaction body that calls db.run() would bypass the wrapper above.
  // Hand the callback the wrapped methods instead; the mysql twin already
  // returns a connection-scoped adapter and needs no change.
  wrapped.transaction = (fn) => adapter.transaction((...args) => fn(wrapped, ...args));
  return wrapped;
}

// Resolve the driver chain against one explicit file path. Honors
// VELA_DB_DRIVER when set (fail loud), else the runtime fallback chain.
async function resolveDriver(filePath) {
  const forced = (process.env.VELA_DB_DRIVER || "").toLowerCase().trim();
  if (forced) {
    const FORCED = {
      "bun:sqlite": () => tryBunSqlite(filePath),
      "better-sqlite3": () => tryBetterSqlite(filePath),
      "node:sqlite": () => tryNodeSqlite(filePath),
      "sql.js": () => trySqlJs(filePath),
    };
    const tryFn = FORCED[forced];
    if (!tryFn) {
      throw new Error(`[DB] unknown VELA_DB_DRIVER "${forced}" — expected bun:sqlite | better-sqlite3 | node:sqlite | sql.js`);
    }
    const adapter = await tryFn();
    if (!adapter) {
      throw new Error(`[DB] VELA_DB_DRIVER="${forced}" is not available in this runtime`);
    }
    return withNullByteSafeParams(adapter);
  }
  let adapter = await tryBunSqlite(filePath);
  if (!adapter) adapter = await tryBetterSqlite(filePath);
  if (!adapter) adapter = await tryNodeSqlite(filePath);
  if (!adapter) adapter = await trySqlJs(filePath);
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");
  return withNullByteSafeParams(adapter);
}

/** Storage Covenant Wave B2 — a SCRATCH adapter on an explicit file path.
 *  Used by the restore drill to restore an artifact into a temp DB without
 *  touching the live adapter singleton. Runs the migration chain so the
 *  scratch file has the full schema; the caller owns close() + cleanup. */
export async function getScratchAdapter(filePath) {
  const adapter = await resolveDriver(filePath);
  const { runMigrationOnce } = await import("./migrate.js");
  // skipBackup: a scratch file is not the operator's database. Without this the
  // chain wrote a `schema-N-to-M` snapshot into the real backups dir and pruned
  // real history to KEEP_BACKUPS — a restore drill silently destroying recovery
  // points it was supposed to be proving.
  await runMigrationOnce(adapter, { skipBackup: true });
  return adapter;
}

async function initAdapter() {
  ensureDirs();
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  //
  // VELA_DB_DRIVER pins a single driver (parity harness / driver×mode matrix —
  // Storage Covenant A4/A10). When set, ONLY that driver is tried and failure
  // is LOUD: the matrix must be able to force the fragile corners (e.g. the
  // sql.js SAVEPOINT path in CI) instead of silently falling through the chain.
  // WR-a1 — single-instance guard, acquired BEFORE the file is opened. Four
  // worktrees share this database on this machine with nothing between them;
  // a second writer's exit-time wal_checkpoint(TRUNCATE) is the documented
  // 5,495 ms freeze, and that shape is what produces the boot-time
  // SQLITE_CORRUPT. Fail LOUD here rather than race silently.
  //
  // PER-INSTANCE, NOT PER-PROCESS: a suite that simulates a fresh boot does
  // `delete global._dbAdapter; vi.resetModules()` and re-imports — the lockfile
  // would survive that reset and the second boot would find a lock held by a
  // still-living PID (itself) and throw. So the lock is released when the
  // singleton is torn down, and re-acquired on the next initAdapter(). A real
  // second PROCESS still cannot acquire it: it has a different PID, and the
  // lockfile outlives this process's teardown.
  const { acquireSingleInstanceLock } = await import("./singleInstance.js");
  const lock = acquireSingleInstanceLock(DATA_FILE);
  if (!lock.ok) {
    const h = lock.holder;
    throw new Error(
      `[DB] ${lock.reason} (pid ${h?.pid ?? "?"}, since ${h?.at ?? "?"}). ` +
      `Refusing to open a second writer — set VELA_DB_SINGLE_INSTANCE=0 to override ` +
      `(the parity harness drives multiple handles at one file deliberately).`
    );
  }
  // Release on every clean exit path. A hard kill leaves the lockfile behind,
  // which the staleness rule (dead PID / stale mtime) recovers on next boot.
  // The handlers are REMOVED on release: the drill and the parity harness open
  // adapters repeatedly in one process, and each initAdapter() would otherwise
  // add three more listeners until Node's ceiling trips
  // (MaxListenersExceededWarning — 11 beforeExit/SIGINT/SIGTERM observed).
  const releaseLock = () => {
    for (const sig of ["beforeExit", "SIGINT", "SIGTERM"]) {
      process.removeListener(sig, releaseLock);
    }
    try { lock.release(); } catch {}
  };
  process.once("beforeExit", releaseLock);
  process.once("SIGINT", releaseLock);
  process.once("SIGTERM", releaseLock);
  // Tear-down seam: a caller that discards the singleton (test re-boot, drill)
  // releases the lock so the next initAdapter() can acquire it. Without this,
  // an in-process re-boot deadlocks against its own lockfile.
  state.releaseLock = releaseLock;

  let adapter = await resolveDriver(DATA_FILE);
  if (!state.logged) {
    const forced = (process.env.VELA_DB_DRIVER || "").toLowerCase().trim();
    console.log(`[DB] Driver: ${adapter.driver}${forced ? " (forced)" : ""} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  // INTEGRITY GATE — the harbor is inspected at the door.
  //
  // Before this, a malformed image booted happily, migrated over the damage,
  // and only surfaced as a wall of fail-open runtime noise ("database disk
  // image is malformed" on every usage write) while usage history and request
  // details were silently lost. A corrupt image must be found HERE.
  //
  // Ordering matters: probe and heal BEFORE the migration chain runs, because
  // a migration writing into a damaged b-tree is how a partial wound becomes a
  // total one. VELA_DB_SKIP_INTEGRITY=1 opts out (the parity harness and a
  // restore drill deliberately drive odd files).
  if ((process.env.VELA_DB_SKIP_INTEGRITY || "") !== "1") {
    const integrity = await import("./integrity.js");
    const heal = integrity.healAtBoot(adapter, DATA_FILE);
    if (heal.reopen) {
      // Reopen with the SAME driver the first resolve chose. Re-rolling the
      // chain here would be exactly the two-driver interop on one image that
      // the single-instance guard exists to prevent.
      const driverBefore = adapter.driver;
      adapter = await resolveDriver(DATA_FILE);
      if (adapter.driver !== driverBefore) {
        console.warn(
          `[DB] driver changed across recovery (${driverBefore} → ${adapter.driver}); ` +
            `the recovered image is fine, but report this if it repeats.`
        );
      }
      const recheck = integrity.probeIntegrity(adapter);
      if (!recheck.ok) {
        throw new Error(
          `[DB] The database image is still malformed after recovery: ${recheck.messages.join("; ")}. ` +
            `The original was quarantined; restore a backup from the backups/ directory or start fresh.`
        );
      }
      console.warn(`[DB] recovered harbor reopened cleanly (${heal.action})`);
    }
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) {
    state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  }
  return state.initPromise;
}

/** Discard the singleton (test re-boot, drill, forced re-init). Releases the
 *  single-instance lock FIRST, so the next getAdapter() can acquire it — an
 *  in-process re-boot must not deadlock against its own lockfile. */
export function resetAdapter() {
  try { state.releaseLock?.(); } catch {}
  try { state.instance?.close?.(); } catch {}
  state.instance = null;
  state.initPromise = null;
  state.releaseLock = null;
  state.logged = false;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
