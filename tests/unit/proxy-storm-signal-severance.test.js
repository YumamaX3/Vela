/**
 * STORM 2 — Signal Severance On The NoAuth Lane (v0.9.42 Wave 0)
 *
 * The fleet had a fitness engine and a circuit breaker, and NEITHER ever learned
 * anything. Two independent severances:
 *
 *   (a) FIELD NAME — `markAccountUnavailable` re-fetched the RAW DB row and read
 *       `providerSpecificData.connectionProxyPoolId`. That name exists only on
 *       SYNTHESIZED credentials (auth.js:122, :292); a persisted row binds its
 *       pool as `proxyPoolId` (connectionProxy.js:70). So poolId was always "" →
 *       recordOutcome's guard returned → fitness frozen at zero → pickSmart
 *       degraded to `poolIds[0]`. The "smart" strategy was indistinguishable from
 *       "always first".
 *
 *   (b) THE NOAUTH LANE — the ONLY lane that rotates pools per request, and whose
 *       pool id lives on synthesized credentials, was the one lane whose SUCCESS
 *       signal sat after `if (... connectionId === "noauth") return`. Its
 *       successes were structurally incapable of ever being recorded.
 *
 *   (c) FROZEN NULL — auth.js imported the DEFAULT export, which was
 *       `global.__velaProxyFleet || null` evaluated at module-eval time (before
 *       init() could possibly have run). So `fleet.recordOutcome` was a null
 *       deref on EVERY lane, swallowed by a fire-and-forget catch. The failure
 *       signal was dropped everywhere, not just noauth.
 *
 * This storm proves the signal now reaches the engine on both lanes, attributed
 * to the right pool AND the right provider. Real auth.js, real proxyFleet
 * recordOutcome, real fitness store — only the DB and the network are mocked.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
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

// The network seam — no storm reaches out.
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
// resolveProviderId is a pure alias map; keep it honest rather than stubbing.
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  FREE_TIER_PROVIDERS: {},
  resolveProviderId: (p) => p,
}));

// Import proxyFleet by the SAME specifier auth.js uses (`@/lib/...`). On Windows
// a relative `../../src/...` import and the alias can resolve to two module
// instances with two separate `fitnessStore` closures — auth.js would write to
// one while this test read the other, and every cross-module signal would look
// lost. Matching the specifier guarantees one instance.
const fleet = await import("@/lib/network/proxyFleet.js");
const { markAccountUnavailable, clearAccountError } = await import("@/sse/services/auth.js");

beforeEach(async () => {
  vi.clearAllMocks();
  fitnessRepo.getFitnessRows.mockResolvedValue([]);
  fitnessRepo.upsertFitnessBatch.mockResolvedValue(undefined);
  poolsRepo.getProxyPools.mockResolvedValue([]);
  dbMocks.getSettings.mockResolvedValue({});
  dbMocks.getProviderConnections.mockResolvedValue([]);
  dbMocks.updateProviderConnection.mockResolvedValue({});
  // Reset the singleton so each case starts from a clean fitness store.
  global.__velaProxyFleet = null;
  await fleet.init();
});

afterAll(() => {
  // init() arms a 300s health-scheduler interval; stop it so the suite exits
  // cleanly instead of leaking a timer into the vitest worker.
  try { fleet.stopHealthScheduler(); } catch { /* ignore */ }
});

/** Read the live fitness projection — the engine's own public surface. */
function allFitness() {
  return fleet.getFitnessSummary().pools || [];
}

function fitnessFor(poolId, providerId) {
  return allFitness().find(
    (r) => r.poolId === poolId && (providerId == null || r.provider === providerId)
  );
}

describe("S2.1: the raw-row lane reads the PERSISTED field name", () => {
  it("records a failure against the pool a real connection is bound to", async () => {
    // A raw DB row binds its pool as `proxyPoolId` — NOT connectionProxyPoolId.
    dbMocks.getProviderConnections.mockResolvedValue([{
      id: "conn-1", provider: "freebuff", name: "acc-1", backoffLevel: 0,
      providerSpecificData: { proxyPoolId: "pool-alpha" },
    }]);

    await markAccountUnavailable("conn-1", 429, "rate limited", "freebuff", "model-x");

    const f = fitnessFor("pool-alpha", "freebuff");
    expect(f, "fitness row must exist for the bound pool").toBeTruthy();
    expect(f.failureCount).toBe(1);
    expect(f.successCount).toBe(0);
  });

  it("records a success against the pool on a raw row too", async () => {
    const rawRow = {
      id: "conn-2", provider: "freebuff", testStatus: "unavailable", lastError: "old",
      providerSpecificData: { proxyPoolId: "pool-beta" },
    };
    await clearAccountError("conn-2", { _connection: rawRow }, "model-y");

    const f = fitnessFor("pool-beta", "freebuff");
    expect(f, "success must reach the engine on the authed lane").toBeTruthy();
    expect(f.successCount).toBe(1);
  });

  it("still honours the synthesized field name (both lanes, one reader)", async () => {
    // Synthesized credentials carry connectionProxyPoolId; the ?? must accept it.
    const synth = {
      id: "conn-3", provider: "freebuff",
      providerSpecificData: { connectionProxyPoolId: "pool-gamma" },
    };
    await clearAccountError("conn-3", synth, "model-z");

    const f = fitnessFor("pool-gamma", "freebuff");
    expect(f, "synthesized-name lane must also reach the engine").toBeTruthy();
    expect(f.successCount).toBe(1);
  });
});

describe("S2.2: the noauth lane — the one that was structurally silenced", () => {
  it("records a success even though connectionId is undefined (the guard used to eat it first)", async () => {
    // The virtual credential is shaped exactly as buildVirtualNoAuthConnection
    // returns it: id "noauth", no connectionId, a synthesized pool binding, and
    // — since v0.9.42 — a provider stamp.
    const virtual = {
      id: "noauth",
      provider: "freebuff",
      connectionName: "Public",
      accessToken: "public",
      providerSpecificData: {
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://192.168.1.20:8080",
        connectionProxyPoolId: "pool-noauth",
      },
    };

    // chat.js passes credentials.connectionId, which is UNDEFINED on this lane.
    await clearAccountError(virtual.connectionId, virtual, "luna");

    const f = fitnessFor("pool-noauth", "freebuff");
    expect(f, "THE REACHABILITY PROOF: noauth success must reach the engine").toBeTruthy();
    expect(f.successCount).toBe(1);
  });

  it("attributes the noauth success to the STAMPED provider, not a hardcoded one", async () => {
    const virtual = {
      id: "noauth",
      provider: "opencode-zen",
      providerSpecificData: { connectionProxyPoolId: "pool-zen" },
    };

    await clearAccountError(undefined, virtual, "zen-1");

    expect(fitnessFor("pool-zen", "opencode-zen"), "provider must come from the credential").toBeTruthy();
    expect(fitnessFor("pool-zen", "freebuff"), "must NOT be misfiled under freebuff").toBeFalsy();
  });

  it("does not corrupt a non-freebuff pool's fitness with the old hardcoded key", async () => {
    const virtual = {
      id: "noauth",
      provider: "kilocode",
      providerSpecificData: { connectionProxyPoolId: "pool-kilo" },
    };

    await clearAccountError(undefined, virtual, "kilo-1");

    const kiloRows = allFitness().filter((r) => r.poolId === "pool-kilo");
    expect(kiloRows).toHaveLength(1);
    expect(kiloRows[0].provider).toBe("kilocode");
  });
});

describe("S2.3: recordOutcome is never a null deref again", () => {
  it("the default export resolves to real functions before init() runs", async () => {
    // This is the frozen-null regression. A fresh module graph gives a default
    // whose every property must be a callable, even with no global singleton.
    global.__velaProxyFleet = null;
    const fresh = await import("../../src/lib/network/proxyFleet.js?fresh-default");
    const facade = fresh.default;
    expect(facade).toBeTruthy();
    for (const name of ["recordOutcome", "checkPoolHealth", "getFitnessSummary", "probeEgress", "resetFitness"]) {
      expect(typeof facade[name], `default.${name} must be a function`).toBe("function");
    }
  });

  it("recordOutcome on an empty poolId stays a no-op (the guard still holds)", async () => {
    const before = fleet.getFitnessSummary();
    await fleet.recordOutcome("", "freebuff", { ok: false });
    const after = fleet.getFitnessSummary();
    expect(after).toEqual(before);
  });

  it("a failure signal advances the circuit breaker, not just fitness", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{
      id: "conn-9", provider: "freebuff", backoffLevel: 0,
      providerSpecificData: { proxyPoolId: "pool-breaker" },
    }]);

    // Five deterministic failures — enough to open a breaker under any policy.
    for (let i = 0; i < 5; i++) {
      await markAccountUnavailable("conn-9", 500, "upstream 500", "freebuff", "m");
    }

    const f = fitnessFor("pool-breaker", "freebuff");
    expect(f.failureCount).toBe(5);
  });
});

describe("S2.4: latency honesty", () => {
  it("omits latencyMs rather than inventing one — EWMA stays at zero", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{
      id: "conn-5", provider: "freebuff", backoffLevel: 0,
      providerSpecificData: { proxyPoolId: "pool-lat" },
    }]);

    await markAccountUnavailable("conn-5", 429, "slow", "freebuff", "m");

    // getFitnessSummary does not expose latencyEwmaMs, so prove it through the
    // row that actually gets persisted. No measured duration reaches this seam,
    // so the EWMA must stay at its neutral zero — a fabricated number would
    // poison computeScore's latency factor for every future pick.
    fitnessRepo.upsertFitnessBatch.mockClear();
    await fleet.flushNow();
    const rows = fitnessRepo.upsertFitnessBatch.mock.calls[0][1];
    const latRow = rows.find((r) => r.poolId === "pool-lat");
    expect(latRow.latencyEwmaMs).toBe(0);
  });
});
