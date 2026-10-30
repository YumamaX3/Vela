// M5 — zcode-plan auto-claim tick. Every case injects all four deps (isEnabled,
// loadConnections, claim, persist) so the module's dynamic imports into the DB are
// never reached; the interval timers are left alone.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("../../src/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn(),
}));
vi.mock("../../open-sse/services/zcodePlanClaim.js", () => ({
  claimAllOffered: vi.fn(),
  sendWarmEvents: vi.fn(),
}));

import { getProviderConnections } from "../../src/lib/db/repos/connectionsRepo.js";
import { getSettings } from "../../src/lib/db/repos/settingsRepo.js";
import { claimAllOffered } from "../../open-sse/services/zcodePlanClaim.js";
import { runZcodePlanAutoClaimTick } from "../../open-sse/services/zcodePlanAutoClaim.js";

const SIX_HOURS = 6 * 60 * 60 * 1000;

function conn(id, overrides = {}) {
  return {
    id,
    provider: "zcode-plan",
    isActive: true,
    providerSpecificData: {},
    ...overrides,
  };
}

function deps(overrides = {}) {
  return {
    isEnabled: vi.fn(async () => true),
    loadConnections: vi.fn(async () => []),
    claim: vi.fn(async () => ({ claim: { claimed: ["Pro"], skipped: [], problems: [], alreadyOwned: false }, problems: [] })),
    persist: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runZcodePlanAutoClaimTick — disabled", () => {
  it("setting off → {ran: 0} and no connection load", async () => {
    const d = deps({ isEnabled: vi.fn(async () => false) });
    expect(await runZcodePlanAutoClaimTick(d)).toEqual({ ran: 0 });
    expect(d.loadConnections).not.toHaveBeenCalled();
    expect(d.claim).not.toHaveBeenCalled();
    expect(getProviderConnections).not.toHaveBeenCalled();
    expect(getSettings).not.toHaveBeenCalled();
  });
});

describe("runZcodePlanAutoClaimTick — enabled", () => {
  it("claims active zcode-plan connections and persists the {claim, problems} result", async () => {
    const fresh = conn("c1");
    const d = deps({ loadConnections: vi.fn(async () => [fresh]) });

    const out = await runZcodePlanAutoClaimTick(d);
    expect(out).toEqual({ ran: 1 });
    expect(d.claim).toHaveBeenCalledTimes(1);
    expect(d.claim.mock.calls[0][0]).toBe(fresh);
    expect(d.persist).toHaveBeenCalledTimes(1);

    const [persistedConn, result] = d.persist.mock.calls[0];
    expect(persistedConn).toBe(fresh);
    expect(result.claim.claimed).toEqual(["Pro"]);
    expect(result.problems).toEqual([]);
  });

  it("filters to provider zcode-plan and isActive !== false", async () => {
    const connections = [
      conn("keep-1"),
      conn("other-provider", { provider: "glm" }),
      conn("inactive", { isActive: false }),
      conn("keep-2", { isActive: undefined }),
      null,
    ];
    const d = deps({ loadConnections: vi.fn(async () => connections) });

    const out = await runZcodePlanAutoClaimTick(d);
    expect(out).toEqual({ ran: 2 });
    expect(d.claim.mock.calls.map(([c]) => c.id)).toEqual(["keep-1", "keep-2"]);
  });

  it("a non-array load counts as zero connections", async () => {
    const d = deps({ loadConnections: vi.fn(async () => null) });
    expect(await runZcodePlanAutoClaimTick(d)).toEqual({ ran: 0 });
    expect(d.claim).not.toHaveBeenCalled();
  });
});

describe("runZcodePlanAutoClaimTick — the 6h gap", () => {
  it("skips a connection claimed within the last 6h", async () => {
    const recent = conn("recent", {
      providerSpecificData: { zcodeLastAutoClaimAt: new Date(Date.now() - SIX_HOURS + 60_000).toISOString() },
    });
    const d = deps({ loadConnections: vi.fn(async () => [recent]) });

    expect(await runZcodePlanAutoClaimTick(d)).toEqual({ ran: 0 });
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.persist).not.toHaveBeenCalled();
  });

  it("claims again once the last claim is older than 6h", async () => {
    const old = conn("old", {
      providerSpecificData: { zcodeLastAutoClaimAt: new Date(Date.now() - SIX_HOURS - 60_000).toISOString() },
    });
    const d = deps({ loadConnections: vi.fn(async () => [old]) });

    expect(await runZcodePlanAutoClaimTick(d)).toEqual({ ran: 1 });
    expect(d.claim).toHaveBeenCalledTimes(1);
    expect(d.persist).toHaveBeenCalledTimes(1);
  });

  it("mixes fresh and stale connections in one round", async () => {
    const stale = conn("stale", {
      providerSpecificData: { zcodeLastAutoClaimAt: "2020-01-01T00:00:00.000Z" },
    });
    const fresh = conn("fresh", {
      providerSpecificData: { zcodeLastAutoClaimAt: new Date().toISOString() },
    });
    const never = conn("never");
    const d = deps({ loadConnections: vi.fn(async () => [stale, fresh, never]) });

    expect(await runZcodePlanAutoClaimTick(d)).toEqual({ ran: 2 });
    expect(d.claim.mock.calls.map(([c]) => c.id)).toEqual(["stale", "never"]);
  });
});

describe("runZcodePlanAutoClaimTick — fail-open per connection", () => {
  it("a throwing claim is swallowed, the round continues, ran still counts it", async () => {
    const boom = conn("boom");
    const fine = conn("fine");
    const d = deps({
      loadConnections: vi.fn(async () => [boom, fine]),
      claim: vi.fn(async (c) => {
        if (c.id === "boom") throw new Error("upstream exploded");
        return { claim: { claimed: [], skipped: [], problems: [], alreadyOwned: true }, problems: [] };
      }),
    });

    const out = await runZcodePlanAutoClaimTick(d);
    expect(out).toEqual({ ran: 2 });
    expect(d.claim).toHaveBeenCalledTimes(2);
    // the thrown connection is never persisted; the healthy one is
    expect(d.persist).toHaveBeenCalledTimes(1);
    expect(d.persist.mock.calls[0][0].id).toBe("fine");
  });

  it("a throwing connection load leaves the round empty, not rejected", async () => {
    const d = deps({ loadConnections: vi.fn(async () => { throw new Error("db down"); }) });
    await expect(runZcodePlanAutoClaimTick(d)).resolves.toEqual({ ran: 0 });
  });

  it("a throwing isEnabled is swallowed at top level", async () => {
    const d = deps({ isEnabled: vi.fn(async () => { throw new Error("settings down"); }) });
    await expect(runZcodePlanAutoClaimTick(d)).resolves.toEqual({ ran: 0 });
  });

  it("a throwing persist does not abort the remaining connections", async () => {
    const a = conn("a");
    const b = conn("b");
    const d = deps({
      loadConnections: vi.fn(async () => [a, b]),
      persist: vi.fn(async () => { throw new Error("write failed"); }),
    });

    expect(await runZcodePlanAutoClaimTick(d)).toEqual({ ran: 2 });
    expect(d.claim).toHaveBeenCalledTimes(2);
    expect(d.persist).toHaveBeenCalledTimes(2);
  });
});

describe("runZcodePlanAutoClaimTick — concurrency guard", () => {
  it("a concurrent tick returns {ran: 0} and never double-claims", async () => {
    let releaseLoad;
    const gate = new Promise((resolve) => {
      releaseLoad = resolve;
    });
    const first = deps({ loadConnections: vi.fn(async () => { await gate; return [conn("c")]; }) });
    const second = deps();

    const slow = runZcodePlanAutoClaimTick(first);
    // let the first tick flip tickRunning before the second asks
    await Promise.resolve();
    await Promise.resolve();

    const concurrent = await runZcodePlanAutoClaimTick(second);
    expect(concurrent).toEqual({ ran: 0 });
    // the guard fires before the second tick even reads settings
    expect(second.loadConnections).not.toHaveBeenCalled();
    expect(second.claim).not.toHaveBeenCalled();

    releaseLoad();
    expect(await slow).toEqual({ ran: 1 });
    expect(first.claim).toHaveBeenCalledTimes(1);
  });

  it("the guard is released after a round — the next tick runs", async () => {
    const d1 = deps({ loadConnections: vi.fn(async () => [conn("c")]) });
    await runZcodePlanAutoClaimTick(d1);

    const d2 = deps({ loadConnections: vi.fn(async () => [conn("c")]) });
    expect(await runZcodePlanAutoClaimTick(d2)).toEqual({ ran: 1 });
  });
});

// The module-level fallbacks exist but must never be reached with injected deps —
// this pins that the tick does not touch the DB when all four deps are supplied.
describe("runZcodePlanAutoClaimTick — injected deps never reach the DB", () => {
  it("no connectionsRepo / settingsRepo / claim-service import is used", async () => {
    const d = deps({ loadConnections: vi.fn(async () => [conn("c")]) });
    await runZcodePlanAutoClaimTick(d);
    expect(getSettings).not.toHaveBeenCalled();
    expect(getProviderConnections).not.toHaveBeenCalled();
    expect(claimAllOffered).not.toHaveBeenCalled();
  });
});
