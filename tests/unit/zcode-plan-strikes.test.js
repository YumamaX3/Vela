// zcode-plan WAF strikes (G2/G11, Wave B) — pure helper + auth branch + fallback
// rule coverage. Isolated: no DB, no network, no wall clock beyond fake timers.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
}));
vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/lib/network/proxyFleet.js", () => ({ recordOutcome: vi.fn() }));
vi.mock("@/lib/network/pipeline/selection.js", () => ({ pickPool: vi.fn() }));
vi.mock("@/shared/constants/providers.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, resolveProviderId: (provider) => provider };
});
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const {
  recordZcodeWafStrike,
  clearZcodeStrikes,
  WAF_BENCH_MS,
  STRIKE_DECAY_MS,
} = await import("../../open-sse/services/zcodePlanStrikes.js");
const { checkFallbackError } = await import("../../open-sse/services/accountFallback.js");
const { markAccountUnavailable, clearAccountError } = await import("../../src/sse/services/auth.js");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-10-31T12:00:00.000Z");

describe("zcodePlanStrikes — constants", () => {
  it("bench is 6h, decay is 7 days", () => {
    expect(WAF_BENCH_MS).toBe(6 * HOUR);
    expect(STRIKE_DECAY_MS).toBe(7 * DAY);
  });
});

describe("recordZcodeWafStrike", () => {
  it("first strike: appends, no bench, returns the FULL zcodeStrikes patch", () => {
    const out = recordZcodeWafStrike({ other: 1 }, T0);
    expect(out).toEqual({
      patch: { waf: [T0], benchUntilMs: null, lastCleanMs: null },
      benchUntilMs: null,
      consecutiveWaf: 1,
    });
  });

  it("tolerates missing / malformed providerSpecificData", () => {
    expect(recordZcodeWafStrike(undefined, T0).consecutiveWaf).toBe(1);
    expect(recordZcodeWafStrike({ zcodeStrikes: { waf: "nope" } }, T0).patch.waf).toEqual([T0]);
  });

  it("second consecutive strike (no clean answer) benches 6h", () => {
    const first = recordZcodeWafStrike({}, T0);
    const data = { zcodeStrikes: first.patch };
    const second = recordZcodeWafStrike(data, T0 + HOUR);
    expect(second.consecutiveWaf).toBe(2);
    expect(second.benchUntilMs).toBe(T0 + HOUR + WAF_BENCH_MS);
    expect(second.patch).toEqual({
      waf: [T0, T0 + HOUR],
      benchUntilMs: T0 + HOUR + WAF_BENCH_MS,
      lastCleanMs: null,
    });
  });

  it("decay: a strike older than 7 days is dropped, so the next is not consecutive", () => {
    const data = { zcodeStrikes: { waf: [T0], benchUntilMs: null, lastCleanMs: null } };
    const later = T0 + STRIKE_DECAY_MS + 1;
    const out = recordZcodeWafStrike(data, later);
    expect(out.patch.waf).toEqual([later]);
    expect(out.benchUntilMs).toBeNull();
  });

  it("a strike exactly at the decay boundary is still kept", () => {
    const data = { zcodeStrikes: { waf: [T0] } };
    const out = recordZcodeWafStrike(data, T0 + STRIKE_DECAY_MS);
    expect(out.consecutiveWaf).toBe(2);
  });

  it("a clean answer truncates history — the next strike is first again", () => {
    const data = { zcodeStrikes: { waf: [T0], benchUntilMs: null, lastCleanMs: T0 + HOUR } };
    const out = recordZcodeWafStrike(data, T0 + 2 * HOUR);
    expect(out.consecutiveWaf).toBe(1);
    expect(out.patch.waf).toEqual([T0 + 2 * HOUR]);
  });

  it("rejects a non-finite clock", () => {
    expect(() => recordZcodeWafStrike({}, NaN)).toThrow(TypeError);
  });
});

describe("clearZcodeStrikes", () => {
  it("resets waf[] and clears benchUntilMs", () => {
    const data = { zcodeStrikes: { waf: [T0, T0 + HOUR], benchUntilMs: T0 + 7 * HOUR, lastCleanMs: null } };
    expect(clearZcodeStrikes(data)).toEqual({ waf: [], benchUntilMs: null, lastCleanMs: null });
  });

  it("with a clock: keeps strikes newer than the clean answer (concurrent failure owns them)", () => {
    const data = { zcodeStrikes: { waf: [T0, T0 + 2 * HOUR], benchUntilMs: null } };
    const out = clearZcodeStrikes(data, T0 + HOUR);
    expect(out.waf).toEqual([T0 + 2 * HOUR]);
    expect(out.lastCleanMs).toBe(T0 + HOUR);
  });

  it("returns null when there is no strike state", () => {
    expect(clearZcodeStrikes({})).toBeNull();
    expect(clearZcodeStrikes(undefined)).toBeNull();
  });

  it("does not mutate the input", () => {
    const data = { zcodeStrikes: { waf: [T0], benchUntilMs: T0 + HOUR } };
    clearZcodeStrikes(data);
    expect(data.zcodeStrikes.waf).toEqual([T0]);
  });
});

describe("checkFallbackError — zcode-plan 401/403", () => {
  it("benches a zcode-plan 401 for 24h", () => {
    expect(checkFallbackError(401, "unauthorized", 0, "zcode-plan")).toEqual({
      shouldFallback: true,
      cooldownMs: 24 * HOUR,
    });
  });

  it("benches a zcode-plan 403 for 24h", () => {
    expect(checkFallbackError(403, "forbidden", 0, "zcode-plan").cooldownMs).toBe(24 * HOUR);
  });

  it("leaves other providers' 401/403 on the generic 2-minute rule", () => {
    expect(checkFallbackError(401, "unauthorized", 0, "openai").cooldownMs).toBe(2 * 60 * 1000);
    expect(checkFallbackError(401, "unauthorized", 0, null).cooldownMs).toBe(2 * 60 * 1000);
    expect(checkFallbackError(403, "forbidden", 0, "openai").cooldownMs).toBe(2 * 60 * 1000);
  });
});

describe("auth.js — zcode-plan markAccountUnavailable / clearAccountError", () => {
  let now = T0;

  function conn(extra = {}) {
    return {
      id: "zc-1",
      provider: "zcode-plan",
      name: "zc-1",
      backoffLevel: 0,
      providerSpecificData: { zcodeQuota: { entitlements: [] } },
      ...extra,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    now = T0;
    vi.setSystemTime(now);
    dbMocks.updateProviderConnection.mockResolvedValue({});
    dbMocks.getProviderConnections.mockResolvedValue([conn()]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("first 405: no bench, but the strike patch is persisted (spread over existing data)", async () => {
    const result = await markAccountUnavailable("zc-1", 405, "risk control", "zcode-plan", "zcode-model");

    expect(result.shouldFallback).toBe(false);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith("zc-1", {
      providerSpecificData: {
        zcodeQuota: { entitlements: [] },
        zcodeStrikes: { waf: [T0], benchUntilMs: null, lastCleanMs: null },
      },
    });
    // The first-strike write is not an error-state write.
    const patch = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(patch).not.toHaveProperty("testStatus");
    expect(patch).not.toHaveProperty("lastError");
  });

  it("second consecutive 405: account-wide 6h bench persisted with the lock", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([
      conn({ providerSpecificData: { zcodeQuota: { entitlements: [] }, zcodeStrikes: { waf: [T0 - HOUR], benchUntilMs: null, lastCleanMs: null } } }),
    ]);

    const result = await markAccountUnavailable("zc-1", 405, "risk control", "zcode-plan", "zcode-model");

    expect(result).toEqual({ shouldFallback: true, cooldownMs: WAF_BENCH_MS });
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith("zc-1", {
      modelLock___all: new Date(T0 + WAF_BENCH_MS).toISOString(),
      providerSpecificData: {
        zcodeQuota: { entitlements: [] },
        zcodeStrikes: {
          waf: [T0 - HOUR, T0],
          benchUntilMs: T0 + WAF_BENCH_MS,
          lastCleanMs: null,
        },
      },
      testStatus: "unavailable",
      lastError: "risk control",
      errorCode: 405,
      lastErrorAt: new Date(T0).toISOString(),
      backoffLevel: 0,
    });
    // account-wide: no per-model lock written
    expect(dbMocks.updateProviderConnection.mock.calls.at(-1)[1]).not.toHaveProperty("modelLock_zcode-model");
  });

  it("the 6h bench is not truncated despite a resetsAtMs", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([
      conn({ providerSpecificData: { zcodeStrikes: { waf: [T0 - 1000], benchUntilMs: null, lastCleanMs: null } } }),
    ]);
    const result = await markAccountUnavailable("zc-1", 405, "risk control", "zcode-plan", "m", T0 + 60 * 1000);
    expect(result.cooldownMs).toBe(WAF_BENCH_MS);
  });

  it("non-405 zcode-plan statuses are untouched (no strike write on a 429 no-fallback path)", async () => {
    // A bare 429 classifies as rate_limit → backoff → fallback, and writes no strikes.
    await markAccountUnavailable("zc-1", 429, "slow down", "zcode-plan", "m");
    const patch = dbMocks.updateProviderConnection.mock.calls.at(-1)[1];
    expect(patch).not.toHaveProperty("providerSpecificData");
  });

  it("another provider's 405 neither strikes nor benches (405 is request-scoped there)", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([conn({ provider: "openai" })]);
    const result = await markAccountUnavailable("zc-1", 405, "method not allowed", "openai", "m");
    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("clearAccountError on a clean 200 resets the strikes", async () => {
    const row = conn({ testStatus: "unavailable", lastError: "risk control", providerSpecificData: { zcodeStrikes: { waf: [T0 - HOUR], benchUntilMs: T0 + HOUR, lastCleanMs: null } } });
    await clearAccountError("zc-1", { _connection: row }, "zcode-model");

    const patch = dbMocks.updateProviderConnection.mock.calls.at(-1)[1];
    expect(patch.providerSpecificData).toEqual({
      zcodeStrikes: { waf: [], benchUntilMs: null, lastCleanMs: T0 },
    });
    expect(patch.testStatus).toBe("active");
  });

  it("clearAccountError with no strike state leaves providerSpecificData alone", async () => {
    const row = conn({ testStatus: "unavailable", lastError: "boom" });
    await clearAccountError("zc-1", { _connection: row }, "zcode-model");
    const patch = dbMocks.updateProviderConnection.mock.calls.at(-1)[1];
    expect(patch).not.toHaveProperty("providerSpecificData");
  });

  it("clearAccountError for another provider does not clear zcodeStrikes", async () => {
    const row = conn({ provider: "openai", testStatus: "unavailable", lastError: "boom", providerSpecificData: { zcodeStrikes: { waf: [T0] } } });
    await clearAccountError("zc-1", { _connection: row }, "m");
    const patch = dbMocks.updateProviderConnection.mock.calls.at(-1)[1];
    expect(patch).not.toHaveProperty("providerSpecificData");
  });
});
