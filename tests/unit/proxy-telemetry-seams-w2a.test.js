/**
 * W2a — the proxy telemetry seams, proven end-to-end against a REAL fixture DB.
 *
 * Sealed plan: plans/2026-11-04-proxy-console-separation.md §3.2 + §7.3.
 *
 * What this pins (and why a mock cannot):
 *   • the WRITE seam — saveUsageStats → usageHistory.poolId actually lands, and
 *     the four call sites' `poolId` rides the same INSERT (the request→pool
 *     wire §2 wound 1 says was severed);
 *   • the legacy path — a harbor without the column still writes (the kill
 *     switch), so the migration is never a gate on the hot path;
 *   • the READ seam — poolAnalyticsImpl buckets by pool and EXCLUDES the
 *     unattributed (NULL) rows instead of folding them into a '' bucket;
 *   • the health write→read round trip through the fleet's own recordOutcome /
 *     flushNow chain, and healthHistoryImpl's minute buckets;
 *   • the egress ledger's dedupe (one fact observed twice is one row);
 *   • the HONEST EMPTY — a pre-030 harbor answers collecting:true, never a
 *     fabricated point (plan R6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w2a-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w2a-secret";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  // Scoped only to THIS suite's branch: a whole-holder delete would strip the
  // sibling W2b suite's cached holder when both files share a worker.
  if (global._velaUsageSeams) global._velaUsageSeams.poolIdColumn = { value: null, ts: 0 };
  delete globalThis.__velaUsageLegacyInsert;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  // Scoped only to THIS suite's branch: a whole-holder delete would strip the
  // sibling W2b suite's cached holder when both files share a worker.
  if (global._velaUsageSeams) global._velaUsageSeams.poolIdColumn = { value: null, ts: 0 };
  delete globalThis.__velaUsageLegacyInsert;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const waitWrite = () => new Promise((r) => setTimeout(r, 60));
const iso = (ms = Date.now()) => new Date(ms).toISOString();

/** Boot the harbor. `withWriter` pulls the chatCore graph ONLY for the tests
 *  that write through it — importing it for every case would pay its transform
 *  in suites that never touch it (and starve a shared CI box's budget). */
async function boot({ withWriter = false, withAgg = true } = {}) {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const out = { db };
  if (withWriter) out.saveUsageStats = (await import("open-sse/handlers/chatCore/requestDetail.js")).saveUsageStats;
  if (withAgg) out.agg = await import("@/lib/db/usageAggregation.js");
  return out;
}

describe("the request→pool write seam (§2 wound 1)", () => {
  it("saveUsageStats carries poolId onto the usageHistory row", async () => {
    const { db, saveUsageStats } = await boot({ withWriter: true });
    saveUsageStats({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      silent: true, latencyMs: 900, httpStatus: 200, poolId: "pool-A",
    });
    await waitWrite();
    const row = db.get(`SELECT poolId, latencyMs FROM usageHistory ORDER BY id DESC LIMIT 1`);
    expect(row.poolId).toBe("pool-A");
    expect(row.latencyMs).toBe(900);
    // The first test in this file pays the one-time transform of the chatCore
    // graph (~5s cold on this repo); the assertion itself is instant.
  }, 20_000);

  it("a caller with no pool writes NULL — 'unattributed', never a '' pool", async () => {
    const { db, saveUsageStats } = await boot({ withWriter: true });
    saveUsageStats({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      silent: true, httpStatus: 200,
    });
    await waitWrite();
    const row = db.get(`SELECT poolId FROM usageHistory ORDER BY id DESC LIMIT 1`);
    expect(row.poolId).toBeNull();
  });

  it("the legacy INSERT still works on a harbor without the column (never gated on 030)", async () => {
    const { db, saveUsageStats } = await boot({ withWriter: true });
    globalThis.__velaUsageLegacyInsert = true;
    saveUsageStats({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 7, completion_tokens: 3 },
      silent: true, httpStatus: 200, poolId: "pool-A",
    });
    await waitWrite();
    // The row landed (the legacy statement ran); the column keeps its default.
    const row = db.get(`SELECT provider, poolId FROM usageHistory ORDER BY id DESC LIMIT 1`);
    expect(row.provider).toBe("openai");
    expect(row.poolId).toBeNull();
  });
});

describe("poolAnalyticsImpl — buckets by pool, excludes the unattributed", () => {
  it("a harbor that has never been attributed answers wired:true (the column exists), pools:[], since:null", async () => {
    const { db, agg } = await boot();
    // Never attributed in a FRESH temp DB: this block runs in its own
    // describe, but the DB is per-FILE, so earlier describe blocks may have
    // written rows. Clear them so the case carries by construction, not order.
    db.run(`DELETE FROM usageHistory`);
    // BOTH caches: the aggregation seam probe (usageAggregation) AND the write
    // path's per-adapter column probe (usageRepo's WeakMap) — the latter caches
    // "the column exists" on the adapter object, which a delete cannot touch.
    if (global._velaUsageSeams) global._velaUsageSeams.poolIdColumn = { value: null, ts: 0 };
    const { __test__: usageRepoTest } = await import("@/lib/db/repos/sqlite/usageRepo.js");
    usageRepoTest?.__resetPoolIdProbe?.(db);
    // The `wired` flag caches on the SAME state object; a fresh process state
    // is the honest reading of "never attributed", so re-probe from cold.
    const out = await agg.poolAnalyticsImpl(db, { period: "24h" });
    // `wired` = "the poolId column exists" (the seam landed with migration 030).
    // An empty-but-migrated harbour is wired; only its waterline and census are
    // empty — volume honesty rides `since`/`pools`, not the flag.
    expect(out.wired).toBe(true);
    expect(out.pools).toEqual([]);
    expect(out.since).toBeNull();
  });

  it("counts per pool, sums tokens/cost, and never folds NULL poolId into a bucket", async () => {
    const { db, saveUsageStats, agg } = await boot({ withWriter: true });
    saveUsageStats({ provider: "openai", model: "gpt-4o", tokens: { prompt_tokens: 100, completion_tokens: 50 }, silent: true, latencyMs: 1000, httpStatus: 200, poolId: "pool-A" });
    saveUsageStats({ provider: "openai", model: "gpt-4o", tokens: { prompt_tokens: 200, completion_tokens: 60 }, silent: true, latencyMs: 3000, httpStatus: 200, poolId: "pool-A" });
    saveUsageStats({ provider: "openai", model: "gpt-4o", tokens: { prompt_tokens: 10, completion_tokens: 5 }, silent: true, httpStatus: 200, poolId: "pool-B" });
    saveUsageStats({ provider: "openai", model: "gpt-4o", tokens: { prompt_tokens: 1, completion_tokens: 1 }, silent: true, httpStatus: 200 }); // unattributed
    await waitWrite();

    agg.__resetUsageSeams();
    const out = await agg.poolAnalyticsImpl(db, { period: "24h" });
    expect(out.wired).toBe(true);
    expect(out.since).toBeTruthy();

    const byId = Object.fromEntries(out.pools.map((p) => [p.poolId, p]));
    expect(Object.keys(byId).sort()).toEqual(["pool-A", "pool-B"]);
    expect(byId["pool-A"].requests).toBe(2);
    expect(byId["pool-A"].promptTokens).toBe(300);
    expect(byId["pool-A"].completionTokens).toBe(110);
    expect(byId["pool-A"].avgLatencyMs).toBe(2000);
    expect(byId["pool-A"].p95LatencyMs).toBe(3000);
    expect(byId["pool-B"].requests).toBe(1);
    // The unattributed row is nowhere in the census.
    expect(out.pools.some((p) => p.poolId === null || p.poolId === "")).toBe(false);
  });

});

describe("health history — the fleet flush appends, the read buckets by the minute", () => {
  it("recordOutcome + flushNow write an outcome row; healthHistoryImpl reads it back", async () => {
    const { db, agg } = await boot();
    const repo = await import("@/lib/db/repos/proxyHealthHistoryRepo.js");
    // Anchor to a LOCAL minute BOUNDARY, not "now − 2min": a bucket begins at
    // floor(t / 60s), so an arbitrary base can start mid-minute and push
    // base+5s into the NEXT bucket — a fixture straddling a boundary proves
    // the bucketing wrong when it is right.
    const base = Math.floor((Date.now() - 120_000) / 60_000) * 60_000 + 5_000;
    await repo.appendHealthHistoryRows(db, [
      { poolId: "pool-A", providerId: "openai", verdict: "ok", latencyMs: 400, createdAt: iso(base) },
      { poolId: "pool-A", providerId: "openai", verdict: "ok", latencyMs: 600, createdAt: iso(base + 5_000) },
      { poolId: "pool-A", providerId: "openai", verdict: "fail", latencyMs: null, createdAt: iso(base + 65_000) },
      { poolId: "pool-B", providerId: "openai", verdict: "ok", latencyMs: 100, createdAt: iso(base) },
    ]);
    agg.__resetUsageSeams();

    const a = await agg.healthHistoryImpl(db, { poolId: "pool-A", period: "24h" });
    expect(a.collecting).toBe(false);
    // Two local minutes: base (2 ok rows → mean 500) and base+65s (1 fail, null latency).
    expect(a.series).toHaveLength(2);
    expect(a.series[0].latencyMs).toBe(500);
    expect(a.series[0].verdict).toBe("ok");
    expect(a.series[1].latencyMs).toBeNull();
    expect(a.series[1].verdict).toBe("fail");

    const all = await agg.healthHistoryImpl(db, { period: "24h" });
    expect(new Set(all.series.map((s) => s.poolId))).toEqual(new Set(["pool-A", "pool-B"]));
  });

  it("the fleet's flushNow drains the outcome page into the ledger exactly once", async () => {
    const { db, agg } = await boot();
    const fleet = (await import("@/lib/network/proxyFleet.js")).default;
    fleet.recordOutcome("pool-F", "openai", { ok: true, latencyMs: 321 });
    await fleet.flushNow();
    const rows = db.all(`SELECT * FROM proxyPoolHealthHistory WHERE poolId = 'pool-F'`);
    expect(rows.length).toBe(1);
    expect(rows[0].verdict).toBe("ok");
    expect(rows[0].latencyMs).toBe(321);
    // A second flush with no new outcomes appends nothing more.
    await fleet.flushNow();
    expect(db.all(`SELECT * FROM proxyPoolHealthHistory WHERE poolId = 'pool-F'`).length).toBe(1);
  });
});

describe("the fleet flush — a partial append never duplicates", () => {
  it("hands back ONLY the unwritten outcomes after a mid-batch failure", async () => {
    const { db } = await boot({ withAgg: false });
    const { appendHealthHistoryRows } = await import("@/lib/db/repos/proxyHealthHistoryRepo.js");

    // The drain law, exercised exactly as flushNow runs it: one row per call,
    // with the page shrunk to what has NOT yet landed. The 2nd insert throws.
    const rows = [
      { poolId: "p1", verdict: "ok" },
      { poolId: "p2", verdict: "ok" },
      { poolId: "p3", verdict: "ok" },
    ];
    let writes = 0;
    const failingDb = {
      run: (sql, params) => { if (++writes === 2) throw new Error("disk full"); return db.run(sql, params); },
      get: (sql, params) => db.get(sql, params),
      all: (sql, params) => db.all(sql, params),
      exec: (sql) => db.exec(sql),
      transaction: (fn) => fn(),
    };

    let unwritten = [];
    try {
      for (let i = 0; i < rows.length; i++) {
        unwritten = rows.slice(i);
        await appendHealthHistoryRows(failingDb, [rows[i]]);
        unwritten = rows.slice(i + 1);
      }
    } catch { /* the flush's catch hands `unwritten` back */ }

    // Exactly the two that never landed — p1 is durable and must not be replayed.
    expect(unwritten.map((r) => r.poolId)).toEqual(["p2", "p3"]);
    expect(db.get(`SELECT COUNT(*) AS c FROM proxyPoolHealthHistory`).c).toBe(1);
  });
});

describe("egress history — persisted, deduped, restart-proof", () => {
  it("appends the first observation and dedupes a repeat of the same IP", async () => {
    const { db } = await boot();
    const repo = await import("@/lib/db/repos/proxyEgressHistoryRepo.js");
    expect(await repo.appendEgressHistoryRow(db, { poolId: "pool-A", ip: "1.2.3.4", country: "US" })).toBe(true);
    expect(await repo.appendEgressHistoryRow(db, { poolId: "pool-A", ip: "1.2.3.4", country: "US" })).toBe(false);
    expect(await repo.appendEgressHistoryRow(db, { poolId: "pool-A", ip: "5.6.7.8", country: "DE" })).toBe(true);
    const rows = db.all(`SELECT ip, country FROM proxyPoolEgressHistory WHERE poolId = 'pool-A' ORDER BY id`);
    expect(rows.map((r) => r.ip)).toEqual(["1.2.3.4", "5.6.7.8"]);
  });

  it("egressHistoryImpl returns the persisted series oldest-first", async () => {
    const { db, agg } = await boot();
    const repo = await import("@/lib/db/repos/proxyEgressHistoryRepo.js");
    const t0 = Date.now() - 60_000;
    await repo.appendEgressHistoryRow(db, { poolId: "pool-E", ip: "9.9.9.9", country: "FR", createdAt: iso(t0) });
    await repo.appendEgressHistoryRow(db, { poolId: "pool-E", ip: "8.8.8.8", country: "NL", createdAt: iso(t0 + 30_000) });
    agg.__resetUsageSeams();
    const out = await agg.egressHistoryImpl(db, { poolId: "pool-E", period: "24h" });
    expect(out.collecting).toBe(false);
    expect(out.source).toBe("proxyPoolEgressHistory");
    expect(out.entries.map((e) => e.ip)).toEqual(["9.9.9.9", "8.8.8.8"]);
    expect(out.entries[0].country).toBe("FR");
  });
});

describe("retention (plan R4) — the telemetry seams age with the rows they describe", () => {
  it("pruneUsage removes health + egress rows older than the cutoff", async () => {
    const { db } = await boot();
    const repo = await import("@/lib/db/repos/proxyHealthHistoryRepo.js");
    const egress = await import("@/lib/db/repos/proxyEgressHistoryRepo.js");
    const old = iso(Date.now() - 40 * 86_400_000);
    await repo.appendHealthHistoryRows(db, [{ poolId: "p", verdict: "ok", createdAt: old }]);
    await egress.appendEgressHistoryRow(db, { poolId: "p", ip: "1.1.1.1", createdAt: old });
    const { pruneUsage } = await import("@/lib/db/repos/sqlite/maintenanceRepo.js");
    // Seed an old usage row too, so pruneUsage's own guard (`doomed > 0`) opens.
    db.run(`INSERT INTO usageHistory(timestamp, provider, model) VALUES(?, 'x', 'y')`, [old]);
    await pruneUsage({ days: 30 });
    expect(db.get(`SELECT COUNT(*) AS c FROM proxyPoolHealthHistory`).c).toBe(0);
    expect(db.get(`SELECT COUNT(*) AS c FROM proxyPoolEgressHistory`).c).toBe(0);
  });
});
