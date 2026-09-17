/**
 * Proxy Fitness deck + unified state sweeper (v0.9.65, MIBP parity).
 *
 * The MIBP fork carries a dedicated proxy-fitness surface: every (pool,
 * provider) block visible in one place, clear-one/clear-all actions, and a
 * periodic sweeper that relaxes expired blocks. Vela already held the fitness
 * *engine* (EWMA, richer than MIBP's) — this suite proves the new surface
 * wiring: clearAllFitness (all + per-provider), the clear-all route contract,
 * and pruneExpiredBlocks (expired marks relax back to neutral and persist).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

const fitnessRepo = vi.hoisted(() => ({
  getFitnessRows: vi.fn(),
  upsertFitnessBatch: vi.fn(),
  resetFitness: vi.fn(),
}));

const poolsRepo = vi.hoisted(() => ({
  getProxyPools: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProxyPool: vi.fn(),
  deleteProxyPool: vi.fn(),
}));

vi.mock("undici", () => ({
  fetch: vi.fn().mockRejectedValue(new Error("no network in tests")),
  ProxyAgent: class { async close() {} },
  Socks5ProxyAgent: class { async close() {} },
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/db/repos/proxyFitnessRepo.js", () => fitnessRepo);
vi.mock("../../src/lib/db/repos/proxyPoolsRepo.js", () => poolsRepo);
vi.mock("@/models", () => ({ getProxyPoolById: poolsRepo.getProxyPoolById }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  FREE_TIER_PROVIDERS: {},
  resolveProviderId: (p) => p,
}));

// Same specifier as the storm suites — one module instance, one fitness store.
const fleet = await import("@/lib/network/proxyFleet.js");
const { POST: clearAllRoute } = await import(
  "../../src/app/api/proxy-pools/fitness/clear-all/route.js"
);

beforeEach(async () => {
  vi.clearAllMocks();
  fitnessRepo.getFitnessRows.mockResolvedValue([]);
  fitnessRepo.upsertFitnessBatch.mockResolvedValue(undefined);
  poolsRepo.getProxyPools.mockResolvedValue([]);
  dbMocks.getSettings.mockResolvedValue({});
  dbMocks.getProviderConnections.mockResolvedValue([]);
  dbMocks.updateProviderConnection.mockResolvedValue({});
  global.__velaProxyFleet = null;
});

afterAll(() => {
  try { fleet.stopHealthScheduler(); } catch { /* ignore */ }
});

// Boot-shaped seed: write the rows the store HYDRATES from, then re-init.
// Mutating the summary projection would only touch a copy — the store is the
// truth, and hydration is how the store gets built.
async function seedStore(rows) {
  fitnessRepo.getFitnessRows.mockResolvedValue(rows);
  global.__velaProxyFleet = null;
  await fleet.init();
}

function fitnessFor(poolId, providerId) {
  return (fleet.getFitnessSummary().pools || []).find(
    (r) => r.poolId === poolId && r.provider === providerId
  );
}

describe("clearAllFitness — the deck's Clear All", () => {
  it("clears every pool and provider, memory and DB together", async () => {
    await seedStore([
      { poolId: "pool-a", provider: "freebuff", unfit: 1, unfitReason: "country_blocked", unfitUntil: new Date(Date.now() + 3.6e6).toISOString() },
      { poolId: "pool-b", provider: "qoder", unfit: 1, unfitReason: "ip_capped", unfitUntil: new Date(Date.now() + 3.6e6).toISOString() },
    ]);
    expect(fitnessFor("pool-a", "freebuff")).toBeTruthy();
    expect(fitnessFor("pool-b", "qoder")).toBeTruthy();

    const cleared = await fleet.clearAllFitness(null);

    expect(fitnessFor("pool-a", "freebuff")).toBeUndefined();
    expect(fitnessFor("pool-b", "qoder")).toBeUndefined();
    expect(cleared).toBe(2);
  });

  it("scopes a per-provider clear to that provider only", async () => {
    await seedStore([
      { poolId: "pool-a", provider: "freebuff", unfit: 1, unfitReason: "country_blocked", unfitUntil: new Date(Date.now() + 3.6e6).toISOString() },
      { poolId: "pool-a", provider: "qoder", unfit: 1, unfitReason: "ip_capped", unfitUntil: new Date(Date.now() + 3.6e6).toISOString() },
    ]);

    await fleet.clearAllFitness("freebuff");

    expect(fitnessFor("pool-a", "freebuff")).toBeUndefined();
    expect(fitnessFor("pool-a", "qoder")).toBeTruthy();
  });
});

describe("POST /api/proxy-pools/fitness/clear-all — the route contract", () => {
  it("delegates to clearAllFitness with a provider scope from the body", async () => {
    await seedStore([
      { poolId: "pool-a", provider: "freebuff", unfit: 1, unfitReason: "country_blocked", unfitUntil: new Date(Date.now() + 3.6e6).toISOString() },
    ]);

    const res = await clearAllRoute(
      new Request("http://localhost/api/proxy-pools/fitness/clear-all", {
        method: "POST",
        body: JSON.stringify({ provider: "freebuff" }),
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.cleared).toBeGreaterThanOrEqual(1);
    expect(fitnessFor("pool-a", "freebuff")).toBeUndefined();
  });

  it("clears everything on an empty body and answers 500 when the DB fails", async () => {
    const ok = await clearAllRoute(
      new Request("http://localhost/api/proxy-pools/fitness/clear-all", { method: "POST" })
    );
    expect((await ok.json()).success).toBe(true);

    // The adapter seam is driver.js's own global — fail db.run for one call.
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const originalRun = adapter.run.bind(adapter);
    adapter.run = vi.fn().mockRejectedValue(new Error("boom"));
    try {
      const bad = await clearAllRoute(
        new Request("http://localhost/api/proxy-pools/fitness/clear-all", { method: "POST" })
      );
      expect(bad.status).toBe(500);
    } finally {
      adapter.run = originalRun;
    }
  });
});

describe("pruneExpiredBlocks — the unified state sweeper's engine", () => {
  it("relaxes an expired unfit mark back to neutral and persists it", async () => {
    await seedStore([
      { poolId: "pool-a", provider: "freebuff", unfit: 1, unfitReason: "country_blocked", unfitUntil: new Date(Date.now() - 1000).toISOString() },
    ]);
    expect(fitnessFor("pool-a", "freebuff").unfit).toBeTruthy();

    const relaxed = fleet.pruneExpiredBlocks();

    expect(relaxed).toBe(1);
    const rec = fitnessFor("pool-a", "freebuff");
    expect(rec.unfit).toBeFalsy();
    expect(rec.unfitUntil).toBeNull();
    // The relaxation is flushed to the DB on the next sweep cycle.
    await fleet.flushNow();
    expect(fitnessRepo.upsertFitnessBatch).toHaveBeenCalled();
  });

  it("leaves a live block untouched", async () => {
    await seedStore([
      { poolId: "pool-a", provider: "freebuff", unfit: 1, unfitReason: "country_blocked", unfitUntil: new Date(Date.now() + 60_000).toISOString() },
    ]);

    fleet.pruneExpiredBlocks();

    expect(fitnessFor("pool-a", "freebuff").unfit).toBeTruthy();
  });

  it("returns 0 on an empty store without throwing", async () => {
    await seedStore([]);
    expect(fleet.pruneExpiredBlocks()).toBe(0);
  });
});
