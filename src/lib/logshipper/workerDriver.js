/**
 * workerDriver.js — the worker-local driver bootstrap (WORKER ALIAS LAW).
 *
 * ═══ MEASURED, NOT ASSUMED (Node 25.8.1, Windows, real `new Worker`) ═══
 *   1. The `@/` alias does NOT resolve inside a spawned Worker — vitest's alias
 *      config applies to the runner's own module graph, not to a separate
 *      thread's loader. `@/lib/dataDir.js` → ERR_MODULE_NOT_FOUND.
 *   2. `src/lib/db/paths.js` imports `@/lib/dataDir.js`, so the main chain's
 *      `driver.js` transitively FAILS in a Worker — a real spawn cannot use it
 *      as written. (Also true in production: Next's `@/` alias is a bundler
 *      feature; a Worker file loaded by path is resolved by Node.)
 *   3. `src/lib/db/schema.js` and `src/lib/db/adapters/nodeSqliteAdapter.js`
 *      load fine with RELATIVE imports — they are alias-free.
 *   4. A real Worker, given relative imports + `DATA_DIR` in `workerData`,
 *      opens SQLite, creates the ledger and inserts rows. Proof, not a stub.
 *
 * ═══ THE BOUNDED DUPLICATION THIS FILE CARRIES ═══
 *   The DATA_DIR defaulting logic is re-derived here rather than imported,
 *   because the module that owns it is exactly the one that cannot be
 *   imported. It is the SAME rule, expressed in the same order:
 *     DATA_DIR env → (on Windows) reject a Unix-style absolute path → default
 *     under %APPDATA%\vela or ~/.vela.
 *   If `src/lib/dataDir.js` ever changes its rule, this file is what must be
 *   re-read — that is the price of the alias, and it is stated here rather than
 *   discovered later.
 *
 *   Nothing else is duplicated: the adapters, the schema, the migrations and the
 *   SQL all come from the real modules, by relative path.
 *
 * ═══ M4 — THE `VELA_LOG_DRIVER` PIN (§2 "Driver pin") ═══
 *   The plan's pin clause: "VELA_LOG_DRIVER env pins the worker's driver; the
 *   Dockerfile runner gains ENV VELA_LOG_DRIVER=node:sqlite explicitly (the
 *   runner does not pin VELA_DB_DRIVER today — only the builder does — so
 *   'node:sqlite in prod' is made TRUE here, not inferred)."
 *
 *   THE PIN'S THREE LAWS — each one designed, never assumed:
 *     1. IT OVERRIDES. A pin naming a driver this runtime can load opens THAT
 *        adapter and the chain is never consulted. This is what makes the
 *        declaration true rather than inferred.
 *     2. AN UNKNOWN VALUE IS NOT AN ERROR. It is not a pin at all: the chain
 *        answers exactly as if the variable were unset. A typo must not take
 *        the harbor down at boot, nor silently select a posture nobody asked for.
 *     3. A PIN THE RUNTIME CANNOT LOAD FALLS THROUGH TO THE CHAIN, and says so.
 *        The alternative — throwing — kills the thread and takes the durable
 *        ledger with it, which defeats the ledger's entire purpose.
 *
 *   ═══ TWO PINS, TWO SUBJECTS — DO NOT MERGE THEM ═══
 *   `index.js` exports `resolveLogDriverPin`, which pins the MAIN THREAD's
 *   POSTURE and honours exactly ONE value: `sql.js`, meaning "do not spawn a
 *   worker at all, run degraded". THIS file's `resolveWorkerDriverPin` pins the
 *   WORKER THREAD'S HANDLE and honours any known driver name. They answer
 *   different questions ("may a worker exist?" vs "which handle does it open?"),
 *   which is why they carry different names. `sql.js` on the main side wins
 *   before a worker is ever born, so the two can never disagree.
 *
 *   The Dockerfile's runner ENV is M10's scope and is deliberately NOT added here.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const APP_NAME = "vela";

function defaultDataDir() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(os.homedir(), `.${APP_NAME}`);
}

/** Mirrors src/lib/dataDir.js — see the header's duplication note. */
function resolveDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDataDir();
  if (process.platform === "win32" && /^\//.test(configured)) return defaultDataDir();
  try {
    fs.mkdirSync(configured, { recursive: true });
    return configured;
  } catch {
    return defaultDataDir();
  }
}

/**
 * The KNOWN driver names. A value outside this set is not an error — it is
 * simply not a pin, and the chain answers (law 2). Kept local to the worker so
 * the thread loads no main-thread module to learn one string.
 */
const KNOWN_DRIVERS = Object.freeze(["better-sqlite3", "node:sqlite", "sql.js", "bun:sqlite"]);

/**
 * Read `VELA_LOG_DRIVER` for the WORKER'S HANDLE. Returns the normalized name
 * when it names a driver this runtime knows, else `null` (→ follow the main
 * chain). NEVER throws — the value arrives from the environment, which is
 * untrusted input exactly like a request body.
 *
 * Distinct from `index.js`'s `resolveLogDriverPin` by design; see the header.
 */
export function resolveWorkerDriverPin(raw = process.env.VELA_LOG_DRIVER) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return null;
  return KNOWN_DRIVERS.includes(value) ? value : null;
}

/** Open ONE named adapter. Returns null when this runtime cannot load it. */
async function openNamedDriver(name, file) {
  switch (name) {
    case "bun:sqlite": {
      const { createBunSqliteAdapter } = await import("../db/adapters/bunSqliteAdapter.js");
      return createBunSqliteAdapter(file);
    }
    case "better-sqlite3": {
      const { createBetterSqliteAdapter } = await import("../db/adapters/betterSqliteAdapter.js");
      return createBetterSqliteAdapter(file);
    }
    case "node:sqlite": {
      // The same ≥22.5 gate the main chain uses (driver.js:34). Below it the
      // builtin does not exist, so a pin naming it must fall through, not throw.
      const [maj, min] = process.versions.node.split(".").map(Number);
      if (maj < 22 || (maj === 22 && min < 5)) return null;
      const { createNodeSqliteAdapter } = await import("../db/adapters/nodeSqliteAdapter.js");
      return createNodeSqliteAdapter(file);
    }
    case "sql.js": {
      const { createSqlJsAdapter } = await import("../db/adapters/sqljsAdapter.js");
      return createSqlJsAdapter(file);
    }
    default:
      return null;
  }
}

/**
 * Open a driver handle INSIDE the worker. With `VELA_LOG_DRIVER` set to a
 * known driver, that driver is opened and the chain is not consulted; with the
 * variable unset or unknown, this follows the main chain's ORDER:
 *   Bun: bun:sqlite → sql.js · Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
 *
 * @returns {Promise<{driver:string, adapter:object, file:string,
 *                    pinned:boolean, pinnedDriver:string|null}>}
 *          `pinned:true` means the pin was honoured. `pinned:false` with a
 *          non-null `pinnedDriver` means it was requested and NOT available —
 *          the chain's verdict, SURFACED (law 3), never silently hidden.
 */
export async function openWorkerDriver() {
  const dataDir = resolveDataDir();
  const dbDir = path.join(dataDir, "db");
  const file = path.join(dbDir, "data.sqlite");
  fs.mkdirSync(dbDir, { recursive: true });

  const pinnedDriver = resolveWorkerDriverPin();
  const attempts = [];

  // LAW 1 — the pin OVERRIDES: it is attempted first and alone.
  if (pinnedDriver) {
    attempts.push(async () => openNamedDriver(pinnedDriver, file));
  }

  // Bun: bun:sqlite → sql.js
  if (process.versions.bun) {
    attempts.push(async () => openNamedDriver("bun:sqlite", file));
  }
  // Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  attempts.push(async () => openNamedDriver("better-sqlite3", file));
  attempts.push(async () => openNamedDriver("node:sqlite", file));
  attempts.push(async () => openNamedDriver("sql.js", file));

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const adapter = await attempt();
      if (adapter) {
        const honoured = Boolean(pinnedDriver) && adapter.driver === pinnedDriver;
        if (pinnedDriver && !honoured) {
          console.warn(
            `[logshipper/worker] VELA_LOG_DRIVER=${pinnedDriver} is not loadable here; ` +
              `following the main chain (opened ${adapter.driver}).`
          );
        }
        return { driver: adapter.driver, adapter, file, pinned: honoured, pinnedDriver };
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`[logshipper/worker] no SQLite driver available: ${lastError?.message ?? "all attempts empty"}`);
}