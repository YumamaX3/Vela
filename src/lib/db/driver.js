import { ensureDirs, DATA_FILE } from "./paths.js";

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
    return adapter;
  }
  let adapter = await tryBunSqlite(filePath);
  if (!adapter) adapter = await tryBetterSqlite(filePath);
  if (!adapter) adapter = await tryNodeSqlite(filePath);
  if (!adapter) adapter = await trySqlJs(filePath);
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");
  return adapter;
}

/** Storage Covenant Wave B2 — a SCRATCH adapter on an explicit file path.
 *  Used by the restore drill to restore an artifact into a temp DB without
 *  touching the live adapter singleton. Runs the migration chain so the
 *  scratch file has the full schema; the caller owns close() + cleanup. */
export async function getScratchAdapter(filePath) {
  const adapter = await resolveDriver(filePath);
  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
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
  const adapter = await resolveDriver(DATA_FILE);
  if (!state.logged) {
    const forced = (process.env.VELA_DB_DRIVER || "").toLowerCase().trim();
    console.log(`[DB] Driver: ${adapter.driver}${forced ? " (forced)" : ""} | file: ${DATA_FILE}`);
    state.logged = true;
  }
  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  return state.initPromise;
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}
