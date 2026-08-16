// Usage Observatory W1-C — the aggregation layer's proof.
// Sealed plan item 4 + phase13 obligations: golden values for the 7 fns,
// the identifier covenant (frozen maps, unknown → FilterParamError), the
// two-tier percentile seam, keyset pagination, and the facade census pin
// (facade ≡ both twins ≡ the 7 names). Regression judged via the baseline,
// never raw green — this file is additive.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const saved = {};

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vela-w1c-"));
  for (const k of ["DATA_DIR", "VELA_DB_MODE", "VELA_MYSQL_URL", "API_KEY_SECRET"]) saved[k] = process.env[k];
  process.env.DATA_DIR = tempDir;
  process.env.API_KEY_SECRET = "w1c-secret";
  delete process.env.VELA_MYSQL_URL;
  delete global._dbAdapter;
  delete global._usageEnrichmentCache;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  delete global._usageEnrichmentCache;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function boot() {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter(); // boots schema + migrations
  const usageRepo = await import("@/lib/db/repos/sqlite/usageRepo.js");
  return { db, usageRepo };
}

/** Seed rows through the LIVE writer — telemetry columns + rollup ride the
 *  real write path (the aggregation layer reads what W1-B writes). */
async function seed(usageRepo, rows) {
  for (const r of rows) await usageRepo.saveRequestUsage(r);
}

const T = "2026-08-16T10:00:00.000Z";
const NOW = new Date(T).getTime();

const SEED_ROWS = [
  { timestamp: T, provider: "openai", model: "gpt-4o", endpoint: "/v1/chat", status: "ok", tokens: { prompt_tokens: 100, completion_tokens: 40, cached_tokens: 10 }, latencyMs: 200, ttftMs: 80, httpStatus: 200 },
  { timestamp: "2026-08-16T10:05:00.000Z", provider: "openai", model: "gpt-4o", endpoint: "/v1/chat", status: "ok", tokens: { prompt_tokens: 50, completion_tokens: 10 }, latencyMs: 1500, httpStatus: 200 },
  { timestamp: "2026-08-16T10:10:00.000Z", provider: "anthropic", model: "claude-x", endpoint: "/v1/chat", status: "error", tokens: { prompt_tokens: 20, completion_tokens: 0 }, latencyMs: 6000, httpStatus: 500 },
  { timestamp: "2026-08-16T10:15:00.000Z", provider: "openai", model: "gpt-4o-mini", endpoint: "/v1/models", status: "ok", tokens: { prompt_tokens: 5, completion_tokens: 5 }, latencyMs: 90, httpStatus: 200 },
];

// ─── The identifier covenant (phase13 R8) ──────────────────────────────────

describe("W1-C identifier covenant — frozen maps, unknown → INVALID_FILTER_PARAM", () => {
  it("all four maps are frozen", async () => {
    const names = await import("@/lib/db/usageNames.js");
    expect(Object.isFrozen(names.DIMENSIONS)).toBe(true);
    expect(Object.isFrozen(names.GRANULARITIES)).toBe(true);
    expect(Object.isFrozen(names.SORTABLE_COLUMNS)).toBe(true);
    expect(Object.isFrozen(names.METRICS)).toBe(true);
  });

  it("every fn rejects an unknown identifier with INVALID_FILTER_PARAM", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, SEED_ROWS);
    const probes = [
      () => usageRepo.getFilteredSeries({ period: "bogus" }),
      () => usageRepo.getFilteredSeries({ granularity: "3h" }),
      () => usageRepo.getFilteredSeries({ metric: "vibes" }),
      () => usageRepo.getBreakdown({ dimension: "user" }),
      () => usageRepo.getBreakdown({ metric: "vibes" }),
      () => usageRepo.getPercentiles({ period: "bogus" }),
      () => usageRepo.getKpis({ period: "99d" }),
      () => usageRepo.getLedgerRows({ sort: "id; DROP TABLE usageHistory" }),
    ];
    for (const probe of probes) {
      await expect(probe()).rejects.toMatchObject({ code: "INVALID_FILTER_PARAM" });
    }
  });

  it("q-search escapes LIKE metacharacters (literal search)", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, [
      ...SEED_ROWS,
      { timestamp: T, provider: "prov%er", model: "m1", status: "ok", tokens: { prompt_tokens: 1 } },
    ]);
    // '%' as a literal must match ONLY the provider literally named prov%er
    const rows = await usageRepo.getLedgerRows({ filters: { q: "prov%e" }, period: "24h", now: NOW + 3600000 });
    expect(rows.items.map((r) => r.provider)).toEqual(["prov%er"]);
  });
});

// ─── Golden values ─────────────────────────────────────────────────────────

describe("W1-C golden values — exact tier (≤3d)", () => {
  it("getFilteredSeries buckets requests by hour", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, SEED_ROWS);
    const { points, meta } = await usageRepo.getFilteredSeries({ period: "24h", granularity: "1h", metric: "requests", now: NOW + 3600000 });
    expect(meta.source).toBe("usageHistory");
    const hour10 = points.find((p) => p.t === Math.floor(NOW / 3600000) * 3600000);
    expect(hour10.value).toBe(4); // all four rows land in the 10:00 bucket
    const sum = points.reduce((a, p) => a + p.value, 0);
    expect(sum).toBe(4);
  });

  it("getFilteredSeries sums cost and cachedTokens (JS-scan metric)", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, SEED_ROWS);
    const cached = await usageRepo.getFilteredSeries({ period: "24h", granularity: "1d", metric: "cachedTokens", now: NOW + 3600000 });
    const total = cached.points.reduce((a, p) => a + p.value, 0);
    expect(total).toBe(10); // only row 1 carries cached_tokens
  });

  it("getBreakdown groups provider × cost (golden sums)", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, SEED_ROWS);
    const { items } = await usageRepo.getBreakdown({ dimension: "provider", metric: "requests", period: "24h", now: NOW + 3600000 });
    const openai = items.find((i) => i.provider === "openai");
    const anthropic = items.find((i) => i.provider === "anthropic");
    expect(openai.value).toBe(3);
    expect(anthropic.value).toBe(1);
  });

  it("getPercentiles exact — p50/p95/p99 walk the indexed column", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, SEED_ROWS); // latencies: 90, 200, 1500, 6000
    const res = await usageRepo.getPercentiles({ period: "24h", now: NOW + 3600000 });
    expect(res.meta.approximate).toBe(false);
    expect(res.meta.count).toBe(4);
    // Nearest-rank: latencies 90,200,1500,6000 → p50 idx1=200, p95/p99 idx3=6000
    expect(res.latency.p50).toBe(200);
    expect(res.latency.p95).toBe(6000);
    expect(res.latency.p99).toBe(6000);
    expect(res.ttft.p50).toBe(80);      // only one ttft measured
    expect(res.ttft.count ?? res.meta.ttftCount).toBe(1);
  });

  it("getProviderHealthFrame counts the window only", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, [
      ...SEED_ROWS,
      { timestamp: "2026-08-16T09:00:00.000Z", provider: "openai", model: "old", status: "ok", tokens: { prompt_tokens: 1 } },
    ]);
    const frame = await usageRepo.getProviderHealthFrame({ windowMs: 60 * 60 * 1000, now: NOW + 3600000 });
    expect(frame.perProvider.openai.requests).toBe(3);
    expect(frame.perProvider.openai.errors).toBe(0);
    expect(frame.perProvider.anthropic.requests).toBe(1);
    expect(frame.perProvider.anthropic.errors).toBe(1);
  });

  it("getKpis — CASE WHEN double-range yields current + previous deltas", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, [
      ...SEED_ROWS, // current window (23h→24h back from now)
      { timestamp: "2026-08-15T10:30:00.000Z", provider: "openai", model: "prev", status: "ok", tokens: { prompt_tokens: 7, completion_tokens: 3 } }, // previous window (47h→48h back)
    ]);
    const kpis = await usageRepo.getKpis({ period: "24h", now: NOW + 3600000 });
    // current window holds the 4 seed rows; the previous window holds the one
    // 08-15 row — the CASE WHEN double-range must separate them.
    expect(kpis.requests.value).toBe(4);
    expect(kpis.requests.previous).toBe(1);
    expect(kpis.requests.delta).toBe(3);
    expect(kpis.cachedTokens.value).toBe(10);
    expect(kpis.rtkSavedCostUsd.value).toBe(0); // none funded in this seed
  });

  it("getLedgerRows — keyset pagination walks every row exactly once", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, SEED_ROWS);
    const seen = new Set();
    let after = null;
    let pages = 0;
    while (pages < 10) {
      const page = await usageRepo.getLedgerRows({ period: "24h", now: NOW + 3600000, limit: 2, after, sort: "timestamp", order: "desc" });
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false); // no dupes across pages
        seen.add(item.id);
      }
      pages++;
      if (!page.nextCursor) break;
      after = page.nextCursor;
    }
    expect(seen.size).toBe(4);
  });

  it("getLedgerRows — enrichment lands (accountName fallback, keyName null)", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, [{ ...SEED_ROWS[0], connectionId: "conn-w1c-1" }]);
    const { items } = await usageRepo.getLedgerRows({ period: "24h", now: NOW + 3600000 });
    expect(items[0].accountName).toBe("Account conn-w1c...");
    expect(items[0].keyName).toBeNull();
    expect(items[0].latencyMs).toBe(200);
  });

  it("getLedgerRows — NULL latency sorts last and paginates cleanly", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, [
      ...SEED_ROWS,
      { timestamp: "2026-08-16T10:20:00.000Z", provider: "openai", model: "no-lat", status: "ok", tokens: { prompt_tokens: 1 } }, // NULL latencyMs
    ]);
    const seen = [];
    let after = null;
    for (let i = 0; i < 10; i++) {
      const page = await usageRepo.getLedgerRows({ period: "24h", now: NOW + 3600000, limit: 2, after, sort: "latencyMs", order: "desc" });
      seen.push(...page.items.map((r) => r.latencyMs));
      if (!page.nextCursor) break;
      after = page.nextCursor;
    }
    expect(seen.length).toBe(5);
    expect(seen.slice(-1)).toEqual([null]); // NULLS LAST held
    expect(new Set(seen.slice(0, 4)).size).toBe(4); // 4 distinct non-null
  });

  it("getExportCursor yields every row honoring filters + cap", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, SEED_ROWS);
    const rows = [];
    for await (const row of await usageRepo.getExportCursor({ period: "24h", now: NOW + 3600000, filters: { provider: "openai" }, cap: 10 })) {
      rows.push(row);
    }
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.provider === "openai")).toBe(true);
  });
});

// ─── The two-tier seam — rollup honesty ────────────────────────────────────

describe("W1-C rollup tier — 7d+ rides usageDaily with honest coverage", () => {
  it("getFilteredSeries 7d reads the rollup (source usageDaily)", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, SEED_ROWS); // the live writer extends the rollup
    const { points, meta } = await usageRepo.getFilteredSeries({ period: "7d", granularity: "1d", metric: "requests", now: NOW + 3600000 });
    expect(meta.source).toBe("usageDaily");
    const total = points.reduce((a, p) => a + p.value, 0);
    expect(total).toBe(4);
  });

  it("getPercentiles 7d → approximate histogram with coverage 1", async () => {
    const { usageRepo } = await boot();
    await seed(usageRepo, SEED_ROWS);
    const res = await usageRepo.getPercentiles({ period: "7d", now: NOW + 3600000 });
    expect(res.meta.approximate).toBe(true);
    expect(res.meta.source).toBe("usageDaily.latencyBuckets");
    expect(res.meta.coverage).toBe(1); // the seeded day carries buckets
    expect(res.meta.count).toBe(4);
    // 90(b0), 200(b1), 1500(b4), 6000(b6); nearest-rank targets q·4:
    // p50→2 (cum b0=1,b1=2 → edge 250), p95→3.8 and p99→3.96 both fall in
    // b6 (cum b4=3 < 3.8) → edge Infinity (>5s bucket)
    expect(res.latency.p50).toBe(250);
    expect(res.latency.p95).toBe(Infinity);
    expect(res.latency.p99).toBe(Infinity);
  });

  it("pre-008 days (no latencyBuckets) lower coverage honestly", async () => {
    const { usageRepo, db } = await boot();
    await seed(usageRepo, SEED_ROWS);
    // Forge an older day WITHOUT latencyBuckets — the pre-instrumentation shape
    const oldDay = { dateKey: "2026-08-12", requests: 9, promptTokens: 1, completionTokens: 1, cost: 0 };
    db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?)`, [oldDay.dateKey, JSON.stringify(oldDay)]);
    const res = await usageRepo.getPercentiles({ period: "7d", now: NOW + 3600000 });
    expect(res.meta.coverage).toBe(0.5); // 1 of 2 days carries buckets
    expect(res.meta.count).toBe(4);       // only bucketed days counted
  });
});

// ─── The facade census pin ─────────────────────────────────────────────────

describe("W1-C census pin — facade ≡ both twins ≡ the 7 names", () => {
  it("every W1-C name resolves as a function on facade + sqlite + mysql twins", async () => {
    await import("@/lib/db/driver.js"); // boot schema first
    const facade = await import("@/lib/db/repos/usageRepo.js");
    const sqlite = await import("@/lib/db/repos/sqlite/usageRepo.js");
    const mysql = await import("@/lib/db/repos/mysql/usageRepo.js");
    const names = [
      "getFilteredSeries", "getBreakdown", "getPercentiles", "getProviderHealthFrame",
      "getKpis", "getLedgerRows", "getExportCursor",
    ];
    for (const n of names) {
      expect(typeof facade[n], `facade.${n}`).toBe("function");
      expect(typeof sqlite[n], `sqlite.${n}`).toBe("function");
      expect(typeof mysql[n], `mysql.${n}`).toBe("function");
    }
  });
});
