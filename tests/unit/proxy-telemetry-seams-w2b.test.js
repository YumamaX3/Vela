// Proxy Console Separation W2b — the three telemetry seams, proven against a
// REAL sqlite store (getScratchAdapter runs the full migration chain, which now
// includes W2a's migration 030: usageHistory.poolId, proxyPoolHealthHistory,
// proxyPoolEgressHistory). Each test forks a FRESH scratch DB, so the seam
// probes are exercised against a known schema rather than a global cache.
//
// WHAT THIS PINS
//   §2 #1  the analytics seam buckets by poolId, excludes NULL/unattributed rows,
//          and computes requests/errors/tokens/cost/latency honestly (p95 is
//          nearest-rank). It reports the attribution WATERLINE (`since`), never a
//          fabricated backfill for rows written before the wire existed (R6).
//   §2 #2  health-history buckets proxyPoolHealthHistory rows to the local minute,
//          mean latency of the measured rows, a minute with no measurement stays
//          null, and the series scopes to one pool on request.
//   §2 #4  egress-history reads the PERSISTED proxyPoolEgressHistory ledger, newest
//          capped, oldest-first out, ok:null (we observed an IP, we never graded
//          it); it never smuggles the in-memory ring in as pseudo-history.
//
// Fixtures are synthetic integers/ids only — no credential anywhere.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tempDir;
let db;
let agg;

// ISOLATION — this file boots REAL scratch SQLite databases. Two hazards the
// suite's own neighbours assume are quiet: (1) the native better-sqlite3 handle
// keeps the event loop busy at file end, so a later file's `saveUsageStats`
// (fire-and-forget microtask) can time out or double-write; (2) the driver's
// global `_dbAdapter` singleton. We pin the driver to the in-process sql.js
// (which needs no close and never holds the loop) for THIS file's process and
// restore the operator's env after, so no other file is perturbed.
// ONE migration-chain boot for the whole file (seven minutes of chain × 9 cases
// would starve a neighbouring file's 5s waitFor in a shared process). Between
// cases we only EMPTY the three tables — cheap, and each case still sees a
// clean, correctly-schema'd harbour.
const savedEnv = {};
const TABLES = ["usageHistory", "proxyPoolHealthHistory", "proxyPoolEgressHistory"];

beforeAll(async () => {
  savedEnv.VELA_DB_DRIVER = process.env.VELA_DB_DRIVER;
  process.env.VELA_DB_DRIVER = "sql.js"; // in-process; no native handle to leak
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w2b-"));
  const driver = await import("../../src/lib/db/driver.js");
  db = await driver.getScratchAdapter(path.join(tempDir, "scratch.db"));
  agg = await import("../../src/lib/db/usageAggregation.js");
}, 120_000);

afterAll(async () => {
  try { await db?.close?.(); } catch { /* ignore */ }
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  if (savedEnv.VELA_DB_DRIVER === undefined) delete process.env.VELA_DB_DRIVER;
  else process.env.VELA_DB_DRIVER = savedEnv.VELA_DB_DRIVER;
  delete global._dbAdapter;
}, 30_000);

beforeEach(() => {
  for (const t of TABLES) db.run(`DELETE FROM ${t}`);
  usageTick = 0;
  agg.__resetUsageSeams(); // fresh seam probes against the (emptied) schema
});

// A usage row including W2a's poolId (NULL = unattributed). Distinct timestamps
// by default — the uq_uh_dedupe identity includes timestamp.
let usageTick = 0;
function insertUsage(over = {}) {
  const ts = over.timestamp ?? (Date.now() - 600_000 - (usageTick++));
  const cols = ["timestamp","provider","model","connectionId","keyId","keyPrefix","endpoint",
    "promptTokens","completionTokens","cost","status","statusClass","latencyMs","poolId"];
  const vals = [
    new Date(ts).toISOString(),
    over.provider ?? "openai", over.model ?? "gpt-4o", "", "", "", "/v1/chat/completions",
    over.promptTokens ?? 10, over.completionTokens ?? 5, over.cost ?? 0.002,
    over.status ?? "ok", over.statusClass ?? "ok", over.latencyMs ?? null,
    over.poolId ?? null,
  ];
  db.run(`INSERT INTO usageHistory(${cols.join(",")}) VALUES(${cols.map(()=>"?").join(",")})`, vals);
}

describe("the WRITE seam — saveRequestUsage lands poolId (plan R1)", () => {
  // getAdapter() reads the `state` captured when driver.js first loaded, so a
  // write must run on a FRESH module graph bound to THIS scratch DB. We seed the
  // global with our handle, resetModules, then import — the captured `state.instance`
  // IS our scratch adapter, and the repo's own INSERT runs against it.
  async function writeVia(fn) {
    const prev = global._dbAdapter;
    global._dbAdapter = { instance: db, initPromise: null, logged: true };
    try {
      vi.resetModules();
      const repo = await import("../../src/lib/db/repos/sqlite/usageRepo.js");
      await fn(repo.saveRequestUsage);
    } finally {
      global._dbAdapter = prev;
    }
  }

  it("a row written through the real repo round-trips its poolId to the census", async () => {
    // The READ tests above insert raw SQL — they prove the analytics query. This
    // one proves the WIRE: a caller's poolId survives saveRequestUsage → INSERT
    // → usageHistory.poolId → the census bucket. If the writer ever stopped
    // passing poolId, the census would silently lose the bucket and NOTHING else
    // would go red — exactly the R1 risk this case closes.
    await writeVia((saveRequestUsage) => saveRequestUsage({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 11, completion_tokens: 7 },
      poolId: "pool-wire", status: "ok", statusClass: "ok", latencyMs: 150,
      timestamp: new Date(Date.now() - 60_000).toISOString(),
    }));
    const row = db.get(`SELECT poolId, promptTokens FROM usageHistory ORDER BY id DESC LIMIT 1`);
    expect(row).toBeTruthy();
    expect(row.poolId).toBe("pool-wire");
    expect(row.promptTokens).toBe(11);

    agg.__resetUsageSeams();
    const res = await agg.poolAnalyticsImpl(db, { period: "24h" });
    const bucket = res.pools.find((p) => p.poolId === "pool-wire");
    expect(bucket).toBeTruthy();
    expect(bucket.requests).toBe(1);
    expect(bucket.promptTokens).toBe(11);
  });

  it("a caller with no poolId writes NULL (unattributed) — the census omits it", async () => {
    await writeVia((saveRequestUsage) => saveRequestUsage({
      provider: "openai", model: "gpt-4o",
      tokens: { prompt_tokens: 3, completion_tokens: 2 },
      status: "ok", statusClass: "ok",
      timestamp: new Date(Date.now() - 60_000).toISOString(),
    }));
    const row = db.get(`SELECT poolId FROM usageHistory ORDER BY id DESC LIMIT 1`);
    expect(row).toBeTruthy();
    expect(row.poolId).toBeNull();
    agg.__resetUsageSeams();
    const res = await agg.poolAnalyticsImpl(db, { period: "24h" });
    expect(res.pools.some((p) => p.poolId === null || p.poolId === "")).toBe(false);
  });
});

describe("poolAnalyticsImpl — the per-pool usage census", () => {
  it("buckets by poolId — integers only, p95 nearest-rank, NULL rows excluded", async () => {
    const t = (i) => Date.now() - 300_000 - i * 1_000;
    for (let i = 0; i < 3; i++) insertUsage({ poolId: "poolA", latencyMs: [100, 200, 300][i], timestamp: t(i) });
    insertUsage({ poolId: "poolA", status: "error", statusClass: "server_error", timestamp: t(3) });
    insertUsage({ poolId: "poolB", latencyMs: 50, cost: 0.5, timestamp: t(4) });
    insertUsage({ poolId: null, latencyMs: 999, timestamp: t(5) }); // unattributed — must not appear

    const res = await agg.poolAnalyticsImpl(db, { period: "24h" });
    expect(res.wired).toBe(true);
    const a = res.pools.find((p) => p.poolId === "poolA");
    const b = res.pools.find((p) => p.poolId === "poolB");
    expect(a.requests).toBe(4);
    expect(a.errors).toBe(1);
    expect(a.promptTokens).toBe(40); // 4 × 10
    expect(a.completionTokens).toBe(20); // 4 × 5
    expect(a.p95LatencyMs).toBe(300);
    expect(a.avgLatencyMs).toBe(200); // (100+200+300)/3
    expect(b.requests).toBe(1);
    expect(b.costUsd).toBeCloseTo(0.5, 6);
    expect(res.pools.some((p) => p.poolId === null || p.poolId === "")).toBe(false);
  });

  it("reports the attribution waterline (since), never a fabricated backfill", async () => {
    const ts = Date.now() - 120_000;
    insertUsage({ poolId: "poolA", timestamp: ts });
    const res = await agg.poolAnalyticsImpl(db, { period: "24h" });
    expect(res.since).toBeTruthy();
    // the waterline is the oldest attributed stamp, not the query's start
    expect(Math.abs(new Date(res.since).getTime() - ts)).toBeLessThan(2000);
  });

  it("a cold-but-migrated harbour is wired:true with an empty census and null waterline", async () => {
    // W2a's column exists → the seam is wired. No row ever carried a poolId →
    // the census is empty and the waterline (`since`) is null, which the ROUTE
    // renders as the "collecting" empty state. `wired` never conflates the two.
    agg.__resetUsageSeams();
    const res = await agg.poolAnalyticsImpl(db, { period: "24h" });
    expect(res.wired).toBe(true);
    expect(res.pools).toEqual([]);
    expect(res.since).toBeNull();
  });
});

describe("healthHistoryImpl — the per-pool outcome series", () => {
  it("buckets to the local minute with mean latency; unmeasured minute stays null", async () => {
    // Anchor to the START of a real minute 5m ago, so t0/t0b/t1 are all
    // deterministic instants inside that minute and inside the 24h window.
    const minute0 = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000;
    const t0 = new Date(minute0 + 1_000).toISOString();
    const t0b = new Date(minute0 + 20_000).toISOString();
    const t1 = new Date(minute0 + 50_000).toISOString(); // same minute, LAST row
    const ins = (poolId, verdict, latencyMs, createdAt) =>
      db.run(`INSERT INTO proxyPoolHealthHistory(poolId,verdict,latencyMs,createdAt) VALUES(?,?,?,?)`,
        [poolId, verdict, latencyMs, createdAt]);
    ins("poolA", "ok", 100, t0);
    ins("poolA", "ok", 300, t0b);
    // A LATER minute (minute0 + 2m) whose only row is unmeasured — its bucket
    // must carry the fail verdict and a NULL latency (never 0-faked).
    ins("poolA", "fail", null, new Date(minute0 + 120_000).toISOString());
    void t1; // t1 anchored the same-minute window; the fail lives in its own minute
    agg.__resetUsageSeams();

    // Deterministic window: passing `now` removes all wall-clock boundary flake.
    const res = await agg.healthHistoryImpl(db, { poolId: "poolA", period: "24h", now: minute0 + 300_000 });
    expect(res.collecting).toBe(false);
    expect(res.series.length).toBe(2);
    expect(res.series[0].latencyMs).toBe(200);
    expect(res.series[0].verdict).toBe("ok");
    expect(res.series[1].verdict).toBe("fail");
    expect(res.series[1].latencyMs).toBeNull();
    expect(new Date(res.series[0].ts).getTime()).toBeLessThan(new Date(res.series[1].ts).getTime());
  });

  it("scopes to one pool when poolId is given", async () => {
    const t = new Date(Date.now() - 5 * 60_000).toISOString();
    db.run(`INSERT INTO proxyPoolHealthHistory(poolId,verdict,createdAt) VALUES(?,?,?)`, ["p1", "ok", t]);
    db.run(`INSERT INTO proxyPoolHealthHistory(poolId,verdict,createdAt) VALUES(?,?,?)`, ["p2", "ok", t]);
    agg.__resetUsageSeams();
    const res = await agg.healthHistoryImpl(db, { poolId: "p1", period: "24h" });
    expect(res.series.every((s) => s.poolId === "p1")).toBe(true);
    expect(res.series.length).toBe(1);
  });
});

describe("egressHistoryImpl — the persisted egress ledger", () => {
  it("returns the persisted entries oldest-first, ok:null, scoped to the pool", async () => {
    const base = Date.now() - 60_000;
    const ins = (poolId, ip, country, dt) =>
      db.run(`INSERT INTO proxyPoolEgressHistory(poolId,ip,country,createdAt) VALUES(?,?,?,?)`,
        [poolId, ip, country, new Date(base + dt).toISOString()]);
    ins("poolA", "203.0.113.9", "NL", 0);
    ins("poolA", "203.0.113.4", "US", 5_000);
    ins("poolB", "203.0.113.1", "DE", 0);
    agg.__resetUsageSeams();

    const res = await agg.egressHistoryImpl(db, { poolId: "poolA", period: "24h" });
    expect(res.collecting).toBe(false);
    expect(res.entries.length).toBe(2);
    expect(res.entries[0].ip).toBe("203.0.113.9");
    expect(res.entries[1].ip).toBe("203.0.113.4");
    expect(res.entries.every((e) => e.ok === null)).toBe(true);
  });

  it("requires a poolId — no pool, no entries", async () => {
    const res = await agg.egressHistoryImpl(db, { poolId: null, period: "24h" });
    expect(res.entries).toEqual([]);
  });
});

describe("projectEgressHistory — the in-memory ring (live sample, labelled memory)", () => {
  it("labels current ip ok:true, past ips ok:null, and flags flapping", () => {
    const geo = {
      ip: "203.0.113.9", country: "NL", ts: Date.now(),
      ipHistory: [{ ip: "203.0.113.4", country: "US", ts: Date.now() - 60_000 }],
    };
    const r = agg.projectEgressHistory(geo, "p");
    expect(r.source).toBe("memory");
    expect(r.stable).toBe(false);
    expect(r.flapCount).toBe(1);
    expect(r.entries.find((e) => e.ip === "203.0.113.9").ok).toBe(true);
    expect(r.entries.find((e) => e.ip === "203.0.113.4").ok).toBeNull();
  });

  it("a never-probed pool is empty and stable:null", () => {
    const r = agg.projectEgressHistory(null, "p");
    expect(r.entries).toEqual([]);
    expect(r.stable).toBeNull();
  });
});
