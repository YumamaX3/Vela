// Proxy Console Separation W2b — the three telemetry routes at the HTTP edge.
//
// PINS, per route:
//   • the POSTURE law (§3.4) — `proxyUrl` / any `scheme://` string can NEVER cross
//     the wire (structural walk, same shape the census test uses), while the poolId
//     and {id,name,type} label a UI needs DO cross;
//   • the HONESTY flags — analytics reports `wired`+`since` (the attribution
//     waterline), health-history reports `collecting`, egress reports its source;
//   • FAILURE IS LOUD — a thrown dependency is a 500 with no census-shaped body.
//
// The storage seam is `openStoreAdapter` (the harbour doorway) + the engine-neutral
// impls; every route reaches the store through exactly that pair, so the mocks
// intercept there and nowhere else.
import { describe, it, expect, vi, beforeEach } from "vitest";

const CRED = "s3cretpass";
const HOST = "203.0.113.7";

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) =>
      new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "content-type": "application/json" },
      }),
  },
}));
vi.mock("@/sse/utils/logger.js", () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }));

// The store doorway + the engine-neutral impls share one import surface.
const dbIndex = vi.hoisted(() => ({
  openStoreAdapter: vi.fn(),
  getProxyPools: vi.fn(),
}));
vi.mock("@/lib/db/index.js", () => dbIndex);

const agg = vi.hoisted(() => ({
  poolAnalyticsImpl: vi.fn(),
  poolProviderMapImpl: vi.fn(),
  healthHistoryImpl: vi.fn(),
  egressHistoryImpl: vi.fn(),
  projectEgressHistory: vi.fn(),
}));
vi.mock("@/lib/db/usageAggregation.js", () => agg);

const geo = vi.hoisted(() => ({ getPoolGeo: vi.fn() }));
vi.mock("@/lib/network/poolGeo.js", () => ({ getPoolGeo: geo.getPoolGeo }));

const analyticsRoute = await import("@/app/api/proxy-pools/analytics/route.js");
const healthRoute = await import("@/app/api/proxy-pools/health-history/route.js");
const egressRoute = await import("@/app/api/proxy-pools/egress-history/route.js");

const FAKE_DB = { __db: true };
function req(path) { return new Request(`http://localhost:32060${path}`); }

function offenders(tree) {
  const out = [];
  (function walk(node, p) {
    if (typeof node === "string") {
      if (/[a-z][a-z0-9+.-]*:\/\//i.test(node)) out.push(`${p} = ${node}`);
      if (node.includes(CRED)) out.push(`${p} contains credential`);
      return;
    }
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${p}[${i}]`));
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "proxyUrl" || k === "proxyUrlDedupeToken") out.push(`${p}.${k}`);
        walk(v, `${p}.${k}`);
      }
    }
  })(tree, "$");
  return out;
}

const rawPool = { id: "poolA", name: "US-east proxy", type: "http",
  proxyUrl: `http://user1:${CRED}@${HOST}:1080`, isActive: true };

beforeEach(() => {
  vi.clearAllMocks();
  dbIndex.openStoreAdapter.mockResolvedValue(FAKE_DB);
});

// ─────────────────────────────────────────────────────────────────────────
describe("GET /api/proxy-pools/analytics", () => {
  it("emits poolId + {id,name,type} label and NEVER the pool row (posture law)", async () => {
    dbIndex.getProxyPools.mockResolvedValue([rawPool]);
    agg.poolProviderMapImpl.mockResolvedValue(new Map([["poolA", new Set(["openai"])]]));
    agg.poolAnalyticsImpl.mockResolvedValue({
      period: "24h", wired: true, since: "2026-11-05T00:00:00.000Z", source: "usageHistory",
      pools: [{ poolId: "poolA", requests: 5, errors: 0, promptTokens: 50, completionTokens: 25,
        costUsd: 0.01, avgLatencyMs: 120, p95LatencyMs: 300, latencyCount: 5 }],
      meta: { period: "24h" },
    });
    const res = await analyticsRoute.GET(req("/api/proxy-pools/analytics?period=24h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.wired).toBe(true);
    expect(body.since).toBe("2026-11-05T00:00:00.000Z");
    expect(body.pools[0].poolId).toBe("poolA");
    expect(body.pools[0].label).toEqual({ id: "poolA", name: "US-east proxy", type: "http" });
    expect(body.pools[0].providers).toEqual(["openai"]);
    expect(agg.poolAnalyticsImpl).toHaveBeenCalledWith(FAKE_DB, { period: "24h" });
    expect(rawPool.proxyUrl).toContain(CRED); // fixture really held a credential
    expect(offenders(body)).toEqual([]);
  });

  it("reports wired:false + collecting while pre-migrate — never a fake count", async () => {
    dbIndex.getProxyPools.mockResolvedValue([]);
    agg.poolProviderMapImpl.mockResolvedValue(new Map());
    agg.poolAnalyticsImpl.mockResolvedValue({ period: "24h", wired: false, since: null, source: "usageHistory", pools: [], meta: { period: "24h" } });
    const body = await (await analyticsRoute.GET(req("/api/proxy-pools/analytics"))).json();
    expect(body.wired).toBe(false);
    expect(body.since).toBeNull();
    expect(body.pools).toEqual([]);
    expect(body.meta.collecting).toBe(true);
  });

  it("a cold-but-migrated harbour is wired:true yet still collecting (null waterline)", async () => {
    dbIndex.getProxyPools.mockResolvedValue([]);
    agg.poolProviderMapImpl.mockResolvedValue(new Map());
    agg.poolAnalyticsImpl.mockResolvedValue({ period: "24h", wired: true, since: null, source: "usageHistory", pools: [], meta: { period: "24h" } });
    const body = await (await analyticsRoute.GET(req("/api/proxy-pools/analytics"))).json();
    // The seam landed, but no usage has been attributed yet: `collecting` rides
    // the WATERLINE, so a quiet harbour never reads as "migration never landed".
    expect(body.wired).toBe(true);
    expect(body.since).toBeNull();
    expect(body.meta.collecting).toBe(true);
  });

  it("collects:false once the waterline is set — a busy harbour is not 'collecting'", async () => {
    dbIndex.getProxyPools.mockResolvedValue([]);
    agg.poolProviderMapImpl.mockResolvedValue(new Map());
    agg.poolAnalyticsImpl.mockResolvedValue({ period: "24h", wired: true, since: "2026-11-05T00:00:00.000Z", source: "usageHistory", pools: [{ poolId: "poolA", requests: 3 }], meta: {} });
    const body = await (await analyticsRoute.GET(req("/api/proxy-pools/analytics"))).json();
    expect(body.meta.collecting).toBe(false);
    expect(body.since).toBe("2026-11-05T00:00:00.000Z");
  });

  it("a label failure is fail-open — the census still answers", async () => {
    dbIndex.getProxyPools.mockRejectedValue(new Error("pool list down"));
    agg.poolProviderMapImpl.mockRejectedValue(new Error("conn down"));
    agg.poolAnalyticsImpl.mockResolvedValue({ period: "24h", wired: true, since: null, source: "usageHistory",
      pools: [{ poolId: "poolA", requests: 1 }], meta: {} });
    const res = await analyticsRoute.GET(req("/api/proxy-pools/analytics"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pools[0].label).toEqual({ id: "poolA", name: null, type: null });
    expect(body.pools[0].providers).toEqual([]);
  });

  it("400s on an unknown period before opening the store", async () => {
    const res = await analyticsRoute.GET(req("/api/proxy-pools/analytics?period=bogus"));
    expect(res.status).toBe(400);
    expect((await res.json()).field).toBe("period");
    expect(dbIndex.openStoreAdapter).not.toHaveBeenCalled();
  });

  it("500s LOUDLY on a store/impl failure — no empty census", async () => {
    agg.poolAnalyticsImpl.mockRejectedValue(new Error("db down"));
    const res = await analyticsRoute.GET(req("/api/proxy-pools/analytics"));
    expect(res.status).toBe(500);
    expect(await res.json()).not.toHaveProperty("pools");
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("GET /api/proxy-pools/health-history", () => {
  it("collects (empty) and carries no pool row", async () => {
    agg.healthHistoryImpl.mockResolvedValue({ poolId: null, period: "24h", series: [], collecting: true, source: "proxyPoolHealthHistory", meta: {} });
    const body = await (await healthRoute.GET(req("/api/proxy-pools/health-history"))).json();
    expect(body.collecting).toBe(true);
    expect(body.series).toEqual([]);
    expect(offenders(body)).toEqual([]);
  });

  it("scopes to poolId and returns the series", async () => {
    agg.healthHistoryImpl.mockResolvedValue({
      poolId: "poolA", period: "24h",
      series: [{ poolId: "poolA", ts: "2026-11-05T00:00:00.000Z", verdict: "ok", latencyMs: 120 }],
      collecting: false, source: "proxyPoolHealthHistory", meta: {},
    });
    const body = await (await healthRoute.GET(req("/api/proxy-pools/health-history?poolId=poolA"))).json();
    expect(body.poolId).toBe("poolA");
    expect(agg.healthHistoryImpl).toHaveBeenCalledWith(FAKE_DB, { poolId: "poolA", period: "24h" });
    expect(body.series.length).toBe(1);
  });

  it("400s on an unknown period", async () => {
    const res = await healthRoute.GET(req("/api/proxy-pools/health-history?period=nope"));
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe("GET /api/proxy-pools/egress-history", () => {
  it("requires a poolId", async () => {
    const res = await egressRoute.GET(req("/api/proxy-pools/egress-history"));
    expect(res.status).toBe(400);
  });

  it("reads the PERSISTED ledger when it is live — no proxyUrl", async () => {
    agg.egressHistoryImpl.mockResolvedValue({
      poolId: "poolA", period: "24h", collecting: false, source: "proxyPoolEgressHistory",
      entries: [{ ts: "2026-11-05T00:00:00.000Z", ip: "203.0.113.9", country: "NL", ok: null }],
    });
    geo.getPoolGeo.mockReturnValue(null);
    const body = await (await egressRoute.GET(req("/api/proxy-pools/egress-history?poolId=poolA"))).json();
    expect(body.source).toBe("proxyPoolEgressHistory");
    expect(body.entries.length).toBe(1);
    expect(body.collecting).toBe(false);
    expect(offenders(body)).toEqual([]);
  });

  it("falls through to the memory ring (collecting:true) when the ledger has no table", async () => {
    agg.egressHistoryImpl.mockResolvedValue({ poolId: "poolA", period: "24h", collecting: true, entries: [], source: "proxyPoolEgressHistory" });
    geo.getPoolGeo.mockReturnValue({ ip: "203.0.113.9", country: "NL", ts: Date.now(), ipHistory: [] });
    agg.projectEgressHistory.mockReturnValue({ poolId: "poolA", entries: [{ ts: new Date().toISOString(), ip: "203.0.113.9", country: "NL", ok: true }], stable: true, flapCount: 0, source: "memory" });
    const body = await (await egressRoute.GET(req("/api/proxy-pools/egress-history?poolId=poolA"))).json();
    expect(body.source).toBe("memory");
    expect(body.collecting).toBe(true);
    expect(offenders(body)).toEqual([]);
  });
});
