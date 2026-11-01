// P5 pin, parts 1+2 — the SQL move against the frozen JS walk, and the
// shared memo (split from the part-3 transports file so the module mocks
// there cannot intercept part 2's spy).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { frozenLiveArm } from "./fixtures/usage-stats-p5-frozen.js";

const saved = {};
let tempDir;

// ONE adapter for the whole file: better-sqlite3's stmtCache dies with its
// connection, so a per-test mkdtemp+close cycle leaves every test after the
// first holding a closed adapter (the "connection is not open" wave).
beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-p5-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "p5-secret";
  delete process.env.VELA_MYSQL_URL;
});

afterAll(async () => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global.__velaUsageStatsMemo;
  if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  delete global.__velaUsageStatsMemo;
  vi.resetModules();
  const { initDb } = await import("@/lib/db/index.js");
  await initDb();
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  db.run("DELETE FROM usageHistory");
  db.run("DELETE FROM usageDaily");
  db.run("DELETE FROM requestDetails");
});

// ─── The seeded bank ───────────────────────────────────────────────────────
// Rows land DIRECTLY on the adapter (saveRequestUsage prices every row through
// the pricing chain — irrelevant here and slow): the same INSERT the repo
// issues, driven by a dedicated table so the identity/dedupe semantics are
// unaffected. Deterministic stamps (fixed minutes ago → orders, tie-breaks and
// the 10-minute strip are all exact), a '' provider, a split cached pair, two
// models under one provider, orders reversed for ONE model (the lastUsed
// guard's discriminating case), a key-attributed row and a keyless one.
const T0 = Date.parse("2026-10-31T12:00:00.000Z");
const at = (minutesAgo) => new Date(T0 - minutesAgo * 60_000).toISOString();

async function seedBank() {
  const { initDb } = await import("@/lib/db/index.js");
  await initDb();
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const insert = (ts, provider, model, conn, keyId, endpoint, prompt, completion, tokens, cost, status = "ok") =>
    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta, statusClass) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
      [ts, provider, model, conn, keyId, keyId ? "vela-v1-abcd1234" : null, endpoint, prompt, completion, cost, status, JSON.stringify(tokens), status === "ok" ? "ok" : "upstream_error"]
    );
  insert(at(6), "openai", "gpt-4o", "conn-b", "key-b", "/v1/chat/completions", 100, 40, { prompt_tokens: 100, completion_tokens: 40, cached_tokens: 10, cache_read_input_tokens: 5 }, 0.11);
  insert(at(3), "openai", "gpt-4o", "conn-a", "key-a", "/v1/chat/completions", 50, 20, { prompt_tokens: 50, completion_tokens: 20, cached_tokens: 2 }, 0.07);
  insert(at(9), "openai", "gpt-4o-mini", "", "key-a", "/v1/chat/completions", 12, 7, { prompt_tokens: 12, completion_tokens: 7, cache_read_input_tokens: 4 }, 0.01);
  insert(at(2), "", "custom-x", "", "", null, 5, 5, { prompt_tokens: 5, completion_tokens: 5 }, 0);
  insert(at(1), "anthropic", "claude-sonnet-4", "conn-a", "key-a", "/v1/messages", 200, 80, { prompt_tokens: 200, completion_tokens: 80 }, 0.2, "error");
  insert(at(4), "anthropic", "claude-sonnet-4", "conn-a", "key-a", "/v1/messages", 30, 10, { prompt_tokens: 30, completion_tokens: 10, cached_tokens: 1 }, 0.05);
  return db;
}

/** Same clock for both walks — the mended repo reads the live clock, so a
 *  row outside any "today"/"24h" window never reaches either walk. */
function pinClock(ms) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(ms));
}

// ─── Part 1 — the SQL move against the frozen JS ───────────────────────────

describe("P5 part 1 — the SQL seams answer exactly as the pre-mend JS walk", { timeout: 30000 }, () => {
  it("today and 24h: totals, byProvider, and the four identity maps are identical", async () => {
    pinClock(T0);
    const repo = await seedBank();
    const { getUsageStats } = await import("@/lib/db/index.js");

    for (const period of ["today", "24h"]) {
      const stats = await getUsageStats(period);
      // Pinned window: the twin reads the process clock, frozen at T0, and the
      // witness receives the identical cutoff so both walks see one row set.
      const cutoff = period === "today"
        ? new Date(new Date(T0).setHours(0, 0, 0, 0)).toISOString()
        : new Date(T0 - 86_400_000).toISOString();
      const rows = repo.all(
        `SELECT timestamp, provider, model, connectionId, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ? ORDER BY id ASC`,
        [cutoff]
      );

      const conns = await (await import("@/lib/db/repos/sqlite/connectionsRepo.js")).getProviderConnections();
      const connectionMap = {};
      for (const c of conns) connectionMap[c.id] = c.name || c.email || c.id;

      const frozen = frozenLiveArm({
        rows,
        providerNodeNameMap: {},
        connectionMap,
        apiKeyMap: {},
        // The repo's own parser, as the walk's source had it in scope.
        parseJson: (v, f) => { if (v == null) return f; try { return JSON.parse(v); } catch { return f; } },
        stats: {
          totalRequests: 0, totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0,
          byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
        },
      });

      for (const k of ["totalRequests", "totalPromptTokens", "totalCompletionTokens", "totalCachedTokens", "totalCost"]) {
        expect(stats[k], `${period}.${k}`).toEqual(frozen[k]);
      }
      for (const k of ["byProvider", "byModel", "byAccount", "byApiKey", "byEndpoint"]) {
        if (JSON.stringify(stats[k]) !== JSON.stringify(frozen[k])) {
          fs.appendFileSync("p5dbg.log", `${period}.${k} M=` + JSON.stringify(stats[k]) + "\n" + `${period}.${k} F=` + JSON.stringify(frozen[k]) + "\n");
        }
        expect(stats[k], `${period}.${k}`).toEqual(frozen[k]);
      }
    }
  });

  it("cached tokens are a FALLBACK — cached_tokens first, cache_read fills only when absent", async () => {
    pinClock(T0);
    await seedBank();
    const { getUsageStats } = await import("@/lib/db/index.js");
    const stats = await getUsageStats("24h");
    // HEAD :757: cached_tokens || cache_read_input_tokens || 0. The split-pair
    // row (10/5) contributes 10, not 15; the read-only row (4) contributes 4.
    expect(stats.totalCachedTokens).toBe(10 + 2 + 4 + 1);
    expect(stats.byProvider.openai.cachedTokens).toBe(10 + 2 + 4);
  });

  it("the int64 wraparound is refused: the fallback takes one term per row, so no wrap", async () => {
    pinClock(T0);
    const repo = await seedBank();
    const big = 2 ** 60;
    repo.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, keyId, endpoint, promptTokens, completionTokens, cost, status, tokens) VALUES(?, 'int64', 'm', 'int64-conn', '', null, 1, 1, 0.5, 'ok', ?)`,
      [at(5), JSON.stringify({ prompt_tokens: 1, completion_tokens: 1, cached_tokens: big, cache_read_input_tokens: big })]
    );
    const { getUsageStats } = await import("@/lib/db/index.js");
    const stats = await getUsageStats("24h");
    // The fallback contributes big ONCE for this row (cached_tokens is
    // non-null; cache_read never adds), so the row total is 10+2+4+1+big —
    // the JS-exact answer, NOT the SQLite wrap (2^60+2^60 → −2^61).
    expect(stats.totalCachedTokens).toBe(10 + 2 + 4 + 1 + big);
    expect(stats.totalCachedTokens).toBeGreaterThan(0);
  });

  it("the lastUsed fold: MAX over the group — the walk's final stamp", async () => {
    pinClock(T0);
    await seedBank();
    const { getUsageStats } = await import("@/lib/db/index.js");
    const stats = await getUsageStats("24h");
    const cell = stats.byModel["gpt-4o (openai)"];
    // Rows land min-6 then min-3 (older first): the walk's per-row max-fold
    // leaves the LATER stamp (HEAD :785), which for this ordering is min-3.
    expect(cell.lastUsed).toBe(at(3));
    expect(cell.requests).toBe(2);
  });
});

// ─── Part 2 — the memo never changes an answer ─────────────────────────────

describe("P5 part 2 — the shared memo", { timeout: 30000 }, () => {
  it("passes the period through unchanged and keys each period separately", async () => {
    pinClock(T0);
    await seedBank();
    const facade = await import("@/lib/db/index.js");
    const disp = await import("@/lib/db/repos/usageRepo.js");
    const spy = vi.spyOn(disp, "getUsageStats");
    const today = await facade.usageStatsShared("today");
    const week = await facade.usageStatsShared("7d");
    expect(spy).toHaveBeenCalledWith("today");
    expect(spy).toHaveBeenCalledWith("7d");
    expect(spy).not.toHaveBeenCalledWith(undefined);
    // Distinct answers: "today" (since local midnight of the pinned day) and
    // "7d" (usageDaily rollup) are different pictures on this bank.
    expect(JSON.stringify(today.byProvider)).not.toBe(JSON.stringify(week.byProvider));
  });

  it("one compute serves N subscribers inside the window; a new window recomputes", async () => {
    pinClock(T0);
    await seedBank();
    const disp = await import("@/lib/db/repos/usageRepo.js");
    const spy = vi.spyOn(disp, "getUsageStats");
    const facade = await import("@/lib/db/index.js");
    spy.mockClear();
    await Promise.all(Array.from({ length: 6 }, () => facade.usageStatsCoalesced("24h")));
    expect(spy.mock.calls.length).toBe(1);
    await facade.usageStatsCoalesced("24h");
    expect(spy.mock.calls.length).toBe(1); // inside the 15s window
    vi.setSystemTime(new Date(T0 + 15_001));
    await facade.usageStatsCoalesced("24h");
    expect(spy.mock.calls.length).toBe(2); // past it
  });

  it("fails open: a failing compute serves the last good copy; cold, it throws", async () => {
    pinClock(T0);
    await seedBank();
    const disp = await import("@/lib/db/repos/usageRepo.js");
    const spy = vi.spyOn(disp, "getUsageStats");
    const facade = await import("@/lib/db/index.js");
    const warm = await facade.usageStatsShared("24h");
    console.log("DBG warm.totalRequests =", warm.totalRequests, "| spy calls so far =", spy.mock.calls.length, spy.mock.calls.map(c=>c[0]));
    spy.mockRejectedValueOnce(new Error("dead twin"));
    vi.setSystemTime(new Date(T0 + 16_000));
    const stale = await facade.usageStatsShared("24h");
    expect(stale.totalRequests).toBe(warm.totalRequests); // last good copy
    // The stale recompute consumed the queued rejection; the COLD call needs
    // its own, or it resolves through the real compute.
    spy.mockRejectedValueOnce(new Error("dead twin"));
    await expect(facade.usageStatsShared("all")).rejects.toThrow("dead twin"); // cold → the route's 500
  });
});

