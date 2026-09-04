/**
 * bindFallbackRules — the PRODUCER side of Seam 2.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `tests/unit/fallback-rules-seam.test.js` proves the CONSUMER: all five of its
 * suites hand `handleComboChat` a literal `{getRulesForSourceModel}` object. Its
 * own header once claimed "S4. The bindFallbackRules helper returns a repo-shaped
 * object or null" — but S4's body is `describe("S4: no repo passed…")` and never
 * imports the binder at all. So the consumer was proven and the producer was
 * never touched by any test, anywhere in the repo.
 *
 * That gap is not academic. `bindFallbackRules.js` shipped in v0.9.16 calling
 * `getAdapter()` WITHOUT `await`. `getAdapter` is `async` (driver.js), so `db` was
 * a Promise; `if (!db) return null` never fired because a Promise is truthy; and
 * the first real call threw `db.all is not a function` from inside the sqlite
 * twin, where combo.js's catch swallowed it into
 * "[combo] fallback-rules lookup failed, using hardcoded defaults". Operator-
 * defined combo fallback rules NEVER applied, across five minors, in production —
 * observed live on 2026-09-02 as "a.all is not a function" (minified `db`).
 *
 * THE RULE THIS SUITE ENFORCES
 * ----------------------------
 * A permissive mock is exactly what hid that for five minors: any test that
 * injects a repo object, or a fake adapter, proves only the fake. So the happy
 * path here drives a REAL adapter against a REAL migrated database, inserts a
 * REAL row through the REAL repo, and asserts the REAL query returns it. The only
 * tests that mock are the two that must — they prove the fail-open, which by
 * definition is about the adapter being ABSENT or MALFORMED.
 *
 * ISOLATION — the DB-harness trap (crystallized, and it bites).
 *   1. src/lib/db/paths.js freezes DATA_DIR at first import.
 *   2. src/lib/db/driver.js binds `const state = global._dbAdapter` once at
 *      module eval, so `delete global._dbAdapter` alone never rebinds it.
 * The fix is vi.resetModules() in BOTH hooks + setting DATA_DIR BEFORE the first
 * dynamic import of every test, with every `@/lib/db/...` reached by
 * `await import()`. Symptom if skipped: cross-test contamination, or Windows
 * fs.rmSync EPERM from a handle left open (orphaned temp dirs holding a
 * data.sqlite-wal, which exists only while a handle is open).
 *
 * NOTE ON SCHEMA: the `fallbackRules` table is born of migration 012 and its v2
 * columns (triggerType, conditionOp, conditionVal, targetModels, cooldownSkip) of
 * migration 014. It is NOT declared in schema.js's TABLES, so the additive sync
 * cannot supply those columns — the versioned chain must run. This suite boots a
 * fresh DB per test, which runs the whole chain.
 *
 * SECURITY NOTE: no live credential, host, or key appears in this file. Temp dirs
 * only; the example model names are invented.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let liveAdapter = null;
const originalDataDir = process.env.DATA_DIR;
const originalDbMode = process.env.VELA_DB_MODE;
const originalApiKeySecret = process.env.API_KEY_SECRET;

beforeEach(() => {
  // Reset FIRST, then point the env, then let each test import dynamically.
  vi.resetModules();
  vi.doUnmock("@/lib/db/driver.js");
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-bindfb-"));
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "bindfb-test-secret-not-a-live-key";
  delete process.env.VELA_DB_MODE; // default sqlite posture unless a test opts in
  delete global._dbAdapter;
  liveAdapter = null;
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/lib/db/driver.js");
  try { liveAdapter?.instance?.close?.(); } catch {}
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  liveAdapter = null;
  delete global._dbAdapter;
  if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalDbMode === undefined) delete process.env.VELA_DB_MODE;
  else process.env.VELA_DB_MODE = originalDbMode;
  if (originalApiKeySecret === undefined) delete process.env.API_KEY_SECRET;
  else process.env.API_KEY_SECRET = originalApiKeySecret;
});

/** Fresh adapter bound to THIS test's temp DATA_DIR (post-resetModules). */
async function freshAdapter() {
  delete global._dbAdapter;
  const { getAdapter } = await import("@/lib/db/driver.js");
  liveAdapter = await getAdapter();
  return liveAdapter;
}

/** Insert a real rule row through the REAL sqlite repo (never raw SQL here —
 *  the repo is the production write path, so this proves it too). */
async function insertRule(data) {
  const db = await freshAdapter();
  const sqliteRepo = await import("@/lib/db/repos/sqlite/fallbackRulesRepo.js");
  return sqliteRepo.createFallbackRule(db, data);
}

describe("B1: the binder returns a repo that actually queries (the regression)", () => {
  it("binds a REAL adapter and returns the REAL row — not a Promise, not null", async () => {
    await insertRule({
      sourceModel: "combo/flagship",
      targetModel: "provider/backup-model",
      priority: 100,
      triggerOnStatus: "429,503",
      maxRetries: 1,
    });

    const { getFallbackRulesRepo, resetFallbackRulesRepo } =
      await import("@/lib/db/repos/bindFallbackRules.js");
    resetFallbackRulesRepo();

    const repo = await getFallbackRulesRepo();

    // The pre-fix binder returned a repo whose closures captured a PROMISE. The
    // repo object itself looked correct — which is why combo.js's shape check
    // (`typeof repo.getRulesForSourceModel === "function"`) passed and the throw
    // landed deep inside db.all(). Asserting the repo's SHAPE is therefore not
    // enough; only asserting the ROWS proves the adapter was really bound.
    expect(repo).not.toBeNull();
    expect(typeof repo.getRulesForSourceModel).toBe("function");

    const rules = repo.getRulesForSourceModel("combo/flagship");
    expect(Array.isArray(rules)).toBe(true);
    expect(rules).toHaveLength(1);
    expect(rules[0].sourceModel).toBe("combo/flagship");
    expect(rules[0].targetModel).toBe("provider/backup-model");
    // normalizeRule turns the single targetModel column into a 1-hop chain.
    expect(rules[0].targetModels).toEqual(["provider/backup-model"]);
  });

  it("getFallbackRules() returns rows through the same bound adapter", async () => {
    await insertRule({ sourceModel: "combo/a", targetModel: "provider/a2" });
    await insertRule({ sourceModel: "combo/b", targetModel: "provider/b2" });

    const { getFallbackRulesRepo, resetFallbackRulesRepo } =
      await import("@/lib/db/repos/bindFallbackRules.js");
    resetFallbackRulesRepo();

    const repo = await getFallbackRulesRepo();
    const all = repo.getFallbackRules({ isActive: true });
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.sourceModel).sort()).toEqual(["combo/a", "combo/b"]);
  });

  it("the binder is async — a caller that forgets `await` gets a Promise, which this suite would catch", async () => {
    await insertRule({ sourceModel: "combo/async-law", targetModel: "provider/x" });

    const { getFallbackRulesRepo, resetFallbackRulesRepo } =
      await import("@/lib/db/repos/bindFallbackRules.js");
    resetFallbackRulesRepo();

    // Pins the CONTRACT CHANGE itself. v0.9.16–v0.9.45 exported a sync function;
    // v0.9.46 exports an async one. If anyone ever reverts the binder to sync
    // while the five call sites still `await`, this fails loudly rather than
    // silently returning a Promise-of-repo again.
    const result = getFallbackRulesRepo();
    expect(result instanceof Promise).toBe(true);
    expect(typeof result.then).toBe("function");

    const repo = await result;
    expect(repo.getRulesForSourceModel("combo/async-law")).toHaveLength(1);
  });
});

describe("B2: the documented fail-open is REAL, not dead code", () => {
  it("returns null when getAdapter() rejects", async () => {
    vi.doMock("@/lib/db/driver.js", () => ({
      getAdapter: async () => { throw new Error("simulated adapter failure"); },
      getAdapterSync: () => { throw new Error("not initialized"); },
    }));

    const { getFallbackRulesRepo, resetFallbackRulesRepo } =
      await import("@/lib/db/repos/bindFallbackRules.js");
    resetFallbackRulesRepo();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = await getFallbackRulesRepo();
    expect(repo).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null when the adapter is truthy but lacks .all", async () => {
    // Truthy-but-not-an-adapter is exactly what slipped past the pre-fix
    // `if (!db) return null` guard. Now it is refused HERE, named, and the combo
    // engine proceeds with hardcoded rotation.
    //
    // ⚠️ FIXTURE LAW: this object must NOT be a thenable. The first draft of this
    // test used `{ then: () => {} }` to "model a Promise-like" and HUNG for the
    // full 5s timeout — `await` saw `.then`, called the no-op, and never
    // resolved. A fixture that reproduces the bug it is testing cannot test the
    // guard. The Promise shape is asserted separately below, where no await is
    // involved.
    vi.doMock("@/lib/db/driver.js", () => ({
      getAdapter: async () => ({ run: () => ({}), get: () => null }), // has .get, no .all
      getAdapterSync: () => { throw new Error("not initialized"); },
    }));

    const { getFallbackRulesRepo, resetFallbackRulesRepo } =
      await import("@/lib/db/repos/bindFallbackRules.js");
    resetFallbackRulesRepo();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = await getFallbackRulesRepo();
    expect(repo).toBeNull();
    const msg = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(msg).toMatch(/malformed/i);
    warn.mockRestore();
  });

  it("WHY the old guard was blind: a Promise is truthy and has no .all", () => {
    // This asserts PROPERTIES, not binder behavior — it never calls the binder,
    // and its name must not claim otherwise. It records the two facts that made
    // v0.9.16's `if (!db) return null` unfulfillable: a Promise is truthy, so the
    // null guard cannot fire; and it exposes no `.all`, so the failure surfaced
    // only much later, inside the twin, as "a.all is not a function".
    // No await anywhere, because awaiting a Promise fixture is precisely what made
    // the test above hang for its full timeout.
    const pending = Promise.resolve({ all: () => [], get: () => null });
    expect(Boolean(pending)).toBe(true);
    expect(typeof pending.all).not.toBe("function");
    expect(pending instanceof Promise).toBe(true);
  });

  it("does NOT memoize a failed bind — the next call retries", async () => {
    // Caching a null would permanently disable operator rules for the process
    // lifetime if the first request raced ahead of adapter init.
    let fail = true;
    vi.doMock("@/lib/db/driver.js", () => ({
      getAdapter: async () => {
        if (fail) throw new Error("adapter not ready yet");
        return { all: () => [], get: () => null, run: () => ({}) };
      },
      getAdapterSync: () => { throw new Error("not initialized"); },
    }));

    const { getFallbackRulesRepo, resetFallbackRulesRepo } =
      await import("@/lib/db/repos/bindFallbackRules.js");
    resetFallbackRulesRepo();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await getFallbackRulesRepo()).toBeNull();
    fail = false;
    const second = await getFallbackRulesRepo();
    expect(second).not.toBeNull();
    expect(typeof second.getRulesForSourceModel).toBe("function");
    // The warning is latched: one per process, not one per request.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("B3: memoization — the hot chat path does not re-resolve per request", () => {
  it("returns the identical object across calls, and reset drops it", async () => {
    await insertRule({ sourceModel: "combo/memo", targetModel: "provider/m2" });

    const { getFallbackRulesRepo, resetFallbackRulesRepo } =
      await import("@/lib/db/repos/bindFallbackRules.js");
    resetFallbackRulesRepo();

    const first = await getFallbackRulesRepo();
    const second = await getFallbackRulesRepo();
    expect(second).toBe(first); // identity, not just equality

    resetFallbackRulesRepo();
    const third = await getFallbackRulesRepo();
    expect(third).not.toBe(first);
    expect(third.getRulesForSourceModel("combo/memo")).toHaveLength(1);
  });
});

describe("B4: mirror posture — the Star's live VELA_DB_MODE", () => {
  it("binds and queries under VELA_DB_MODE=mirror (reads pass through verbatim)", async () => {
    // Production runs `mirror` (sqlite primary + MariaDB twin). bindFacade routes
    // mirror through decorateMirrorRepo, which wraps only mirroring WRITERS and
    // passes reads through verbatim — so the sync (db, …) shape still holds and
    // the binder's call convention is correct there too. Proving it rather than
    // reasoning about it, because the live deployment is the one that broke.
    process.env.VELA_DB_MODE = "mirror";

    await insertRule({ sourceModel: "combo/mirror", targetModel: "provider/mirror2" });

    const { getFallbackRulesRepo, resetFallbackRulesRepo } =
      await import("@/lib/db/repos/bindFallbackRules.js");
    resetFallbackRulesRepo();

    const repo = await getFallbackRulesRepo();
    expect(repo).not.toBeNull();
    const rules = repo.getRulesForSourceModel("combo/mirror");
    expect(rules).toHaveLength(1);
    expect(rules[0].targetModel).toBe("provider/mirror2");
  });
});

describe("B5: CHARACTERIZED DEFECT — wildcard source models never match", () => {
  // ⚠️ This block asserts CURRENT (wrong) behavior on purpose. It is a
  // characterization test, not an endorsement.
  //
  // getRulesForSourceModel rewrites `*` → `%` (LIKE syntax) then queries with the
  // GLOB operator. SQLite's GLOB matches `*` and `?`; to GLOB a `%` is a literal
  // percent character. So a wildcard lookup compiles to a pattern that can never
  // match any row, and operator wildcard rules silently return zero rows.
  //
  // Pre-existing since migration 012, orthogonal to the await fix, and fixing it
  // CHANGES BEHAVIOR (rules that never fired would start firing) — so it is
  // surfaced here and reported, not silently widened into a one-line hotfix.
  // When it is fixed, invert these two assertions in the same commit.
  it("an exact sourceModel matches", async () => {
    await insertRule({ sourceModel: "combo/wildcard", targetModel: "provider/w2" });
    const { getFallbackRulesRepo, resetFallbackRulesRepo } =
      await import("@/lib/db/repos/bindFallbackRules.js");
    resetFallbackRulesRepo();
    const repo = await getFallbackRulesRepo();
    expect(repo.getRulesForSourceModel("combo/wildcard")).toHaveLength(1);
  });

  it("a `*` wildcard query returns ZERO rows (the defect, pinned)", async () => {
    await insertRule({ sourceModel: "combo/wildcard", targetModel: "provider/w2" });
    const { getFallbackRulesRepo, resetFallbackRulesRepo } =
      await import("@/lib/db/repos/bindFallbackRules.js");
    resetFallbackRulesRepo();
    const repo = await getFallbackRulesRepo();

    const viaWildcard = repo.getRulesForSourceModel("combo/*");
    // CURRENT behavior: [] — because GLOB sees a literal '%', not a wildcard.
    expect(viaWildcard).toEqual([]);
  });
});
