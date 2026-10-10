/**
 * W9 · the break table — per-model breaker counts round-trip.
 *
 * The plan's acceptance: migration 019 + the breaker repo twins, so the
 * breaker's state machine survives a restart at its own grain
 * (poolId, provider, model). Proven here:
 *
 *   1. the migration creates the table and both indexes (fresh DB)
 *   2. the breaker's flush reaches the LEDGER (not just fitness unfit columns)
 *   3. hydrate() widens from the ledger — a cooldown recorded pre-restart
 *      still blocks after one, and never overwrites a younger in-memory state
 *   4. resetKey() reaches disk as a DELETE — a restart does not resurrect
 *      a cooldown the operator cleared
 *
 * Every DB touch rides a temp DATA_DIR-free scratch adapter, the W1 suite's
 * proven pattern (fresh migrations on a throwaway file).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = "C:/Users/navis/Documents/My Project/Ai Gateway/Vela";
let dir;
let db;

const mod = (rel) => pathToFileURL(join(REPO, rel)).href;

/** The strictest dialect adapter — node:sqlite refuses an undefined bind, so
 *  this suite proves the SQL itself, not a mock's tolerance. (W1's pattern.) */
function makeAdapter(handle) {
  return {
    run: (sql, params = []) => handle.prepare(sql).run(...params),
    get: (sql, params = []) => handle.prepare(sql).get(...params),
    all: (sql, params = []) => handle.prepare(sql).all(...params),
    exec: (sql) => handle.exec(sql),
    transaction: (fn) => fn(),
    close: () => handle.close(),
    raw: handle,
  };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "vela-w9-"));
  const { DatabaseSync } = await import("node:sqlite");
  db = makeAdapter(new DatabaseSync(join(dir, "w9.sqlite")));
  const m019 = await import(mod("src/lib/db/migrations/019-circuit-breaker-keys.js"));
  m019.up(db);
  // Bind the scratch adapter as the driver's global state, so the breaker's
  // flushNow() — which reaches the adapter through ../db/index.js — lands in
  // THIS suite's scratch file, never the operator's live DATA_DIR.
  global._dbAdapter = { driver: "node:sqlite", instance: db };
});

afterAll(() => {
  delete global._dbAdapter;
  try { db?.close?.(); } catch {}
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
});

describe("W9 · migration 019 — the table exists", () => {
  it("creates circuitBreakerKeys with the three-part key and both indexes", () => {
    const cols = db.all("PRAGMA table_info(circuitBreakerKeys)").map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      "poolId", "provider", "model", "state", "failureCount",
      "lastFailureAt", "cooldownUntil", "retryAfterMs", "updatedAt",
    ]));
    const idx = db.all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='circuitBreakerKeys'").map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining(["idx_cbk_pool", "idx_cbk_state"]));
    // PK is all three parts
    const pk = db.all("PRAGMA table_info(circuitBreakerKeys)").filter((c) => c.pk > 0).map((c) => c.name);
    expect(pk).toEqual(["poolId", "provider", "model"]);
  });

  it("down() drops the table and its indexes (the rollback is expressible)", async () => {
    const m019 = await import(mod("src/lib/db/migrations/019-circuit-breaker-keys.js"));
    m019.down(db);
    const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='circuitBreakerKeys'");
    expect(tables).toHaveLength(0);
    m019.up(db); // restore for the suites below
  });

});

describe("W9 · the ledger round-trips", () => {
  it("flushNow() persists the state machine verbatim to the ledger", async () => {
    const breaker = await import(mod("src/lib/network/circuitBreaker.js"));
    // Reset the globalThis anchor so the suite starts cold.
    const anchor = globalThis.__velaCircuitBreakerState;
    anchor.store.clear();
    anchor.dirtyKeys.clear();

    const t0 = Date.now(); // backoff(3) = 2^0 * 1000 = 1s — bounded by t0+1s
    breaker.recordFailure("pool-9", "prov-9", "model-a");
    breaker.recordFailure("pool-9", "prov-9", "model-a");
    breaker.recordFailure("pool-9", "prov-9", "model-a"); // threshold → cooldown
    await breaker.flushNow();

    const repo = await import(mod("src/lib/db/repos/sqlite/circuitBreakerRepo.js"));
    const rows = repo.getBreakerRows(db);
    const row = rows.find((r) => r.poolId === "pool-9" && r.model === "model-a");
    expect(row).toBeDefined();
    expect(row.state).toBe("cooldown");
    expect(row.failureCount).toBe(3);
    // The cooldown window is (t0, t0+1s] — deterministic regardless of how
    // long the flush's awaits take, because cooldownUntil was computed at
    // failure time, not at assert time.
    expect(row.cooldownUntil).toBeGreaterThan(t0);
    expect(row.cooldownUntil).toBeLessThanOrEqual(t0 + 1_100);
    // AND the sibling model on the same provider is NOT cooled (per-model grain)
    const sibling = rows.find((r) => r.poolId === "pool-9" && r.model === "model-b");
    expect(sibling).toBeUndefined();
  });

  it("hydrate() widens from the ledger and never narrows a younger state", async () => {
    const breaker = await import(mod("src/lib/network/circuitBreaker.js"));
    const repo = await import(mod("src/lib/db/repos/sqlite/circuitBreakerRepo.js"));
    // A row on disk that memory lacks → widen.
    repo.upsertBreakerBatch(db, [{
      poolId: "pool-9", provider: "prov-9", model: "model-b",
      state: "exhausted", failureCount: 9, lastFailureAt: new Date().toISOString(),
      cooldownUntil: Date.now() + 60_000, retryAfterMs: null, updatedAt: new Date().toISOString(),
    }]);
    const rows = repo.getBreakerRows(db);
    breaker.hydrate(rows);
    // model-b was hydrated: unavailable, failureCount carried.
    expect(breaker.isAvailable("pool-9", "prov-9", "model-b")).toBe(false);
    // model-a's in-memory state is YOUNGER than its disk row → never narrowed.
    const anchor = globalThis.__velaCircuitBreakerState;
    const before = anchor.store.get("pool-9|prov-9|model-a");
    breaker.hydrate([{ ...rows.find((r) => r.model === "model-a"), state: "healthy", failureCount: 0 }]);
    expect(anchor.store.get("pool-9|prov-9|model-a")).toBe(before);
  });

  it("resetKey() reaches the ledger as a DELETE — restart cannot resurrect", async () => {
    const breaker = await import(mod("src/lib/network/circuitBreaker.js"));
    const repo = await import(mod("src/lib/db/repos/sqlite/circuitBreakerRepo.js"));
    breaker.resetKey("pool-9", "prov-9", "model-a");
    await breaker.flushNow();
    const rows = repo.getBreakerRows(db).filter((r) => r.poolId === "pool-9" && r.model === "model-a");
    expect(rows).toHaveLength(0);
    expect(breaker.isAvailable("pool-9", "prov-9", "model-a")).toBe(true);
  });
});
