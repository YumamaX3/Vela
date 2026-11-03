/**
 * Health-aware account selection — the gate finally READS its own verdict.
 *
 * markAccountUnavailable stamps `testStatus:"unavailable"` on every benched
 * connection; until this tide, routing never looked. (docs/9router-pro-port-
 * register.md:137: "testStatus written but never read in selection".) These
 * tests drive the REAL auth.js — DB mocks only, hoisted below — and pin:
 *
 *   1. fill-first      — the first CLEAN account is picked, not a leading suspect
 *   2. step-back, not   — a suspect account still serves when no clean one
 *      exclusion         remains (no starvation of a fully-benched fleet)
 *   3. round-robin     — a suspect never holds the sticky seat, and a suspect
 *                        with no history never jumps the rotation
 *   4. exclusion first — exclude/lock filtering still outranks the health tier
 *   5. preferred pin   — a pinned CLEAN account is honoured; a pinned SUSPECT
 *                        account steps back in favour of clean candidates
 *   6. fail-open       — a throwing testStatus getter reads as clean
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  FREE_TIER_PROVIDERS: {},
  resolveProviderId: (p) => p,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

function conn(id, extra = {}) {
  return {
    id,
    provider: "p",
    authType: "apikey",
    apiKey: `key-${id}`,
    isActive: true,
    ...extra,
  };
}

function serve(rows) {
  dbMocks.getProviderConnections.mockResolvedValue(rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getSettings.mockResolvedValue({ providerStrategies: {} });
  dbMocks.getProxyPools.mockResolvedValue([]);
  dbMocks.updateProviderConnection.mockImplementation(async () => ({}));
});

describe("health tier — fill-first", () => {
  it("serves the first CLEAN account when a suspect leads the priority list", async () => {
    serve([
      conn("suspect", { testStatus: "unavailable", priority: 1 }),
      conn("clean", { testStatus: "active", priority: 2 }),
    ]);

    const picked = await getProviderCredentials("p");
    expect(picked.connectionId).toBe("clean");
  });

  it("keeps DB priority order within the clean tier (stable sort)", async () => {
    serve([
      conn("suspect", { testStatus: "unavailable", priority: 1 }),
      conn("clean-a", { testStatus: "active", priority: 2 }),
      conn("clean-b", { testStatus: "active", priority: 2 }),
    ]);

    const first = await getProviderCredentials("p");
    expect(first.connectionId).toBe("clean-a");
  });

  it("treats every non-'unavailable' status as clean (untested/unknown/error/active)", async () => {
    serve([
      conn("untested", { testStatus: "untested" }),
      conn("suspect", { testStatus: "unavailable" }),
    ]);

    const picked = await getProviderCredentials("p");
    expect(picked.connectionId).toBe("untested");
  });
});

describe("health tier — step down, not exclusion", () => {
  it("serves a suspect account when no clean candidate remains", async () => {
    serve([
      conn("suspect", { testStatus: "unavailable" }),
    ]);

    const picked = await getProviderCredentials("p");
    expect(picked.connectionId).toBe("suspect");
  });

  it("steps back when every remaining candidate is excluded", async () => {
    serve([
      conn("clean", { testStatus: "active" }),
      conn("suspect", { testStatus: "unavailable" }),
    ]);

    const picked = await getProviderCredentials("p", new Set(["clean"]));
    expect(picked.connectionId).toBe("suspect");
  });
});

describe("health tier — round-robin shape preserved", () => {
  it("does not hand the sticky seat to a suspect with a fresh lastUsedAt", async () => {
    const now = new Date().toISOString();
    serve([
      conn("suspect", { testStatus: "unavailable", lastUsedAt: now, consecutiveUseCount: 1 }),
      conn("clean", { testStatus: "active", lastUsedAt: new Date(Date.now() - 60_000).toISOString(), consecutiveUseCount: 1 }),
    ]);
    dbMocks.getSettings.mockResolvedValue({
      fallbackStrategy: "round-robin",
      providerStrategies: {},
    });

    const picked = await getProviderCredentials("p");
    expect(picked.connectionId).toBe("clean");
  });

  it("does not let a never-used suspect jump the rotation ahead of clean candidates", async () => {
    serve([
      conn("suspect", { testStatus: "unavailable" }), // no lastUsedAt → would sort first when oldest-first
      conn("clean-old", { testStatus: "active", lastUsedAt: new Date(Date.now() - 60_000).toISOString(), consecutiveUseCount: 3 }),
      conn("clean-new", { testStatus: "active", lastUsedAt: new Date().toISOString(), consecutiveUseCount: 3 }),
    ]);
    dbMocks.getSettings.mockResolvedValue({
      fallbackStrategy: "round-robin",
      providerStrategies: {},
    });

    const picked = await getProviderCredentials("p");
    // clean-old is the least-recently-used CLEAN account; the suspect (no
    // history, which the oldest-first sort would otherwise rank first) steps back.
    expect(picked.connectionId).toBe("clean-old");
  });

  it("still rotates deterministically among clean accounts", async () => {
    serve([
      conn("a", { testStatus: "active", lastUsedAt: new Date().toISOString(), consecutiveUseCount: 3 }),
      conn("b", { testStatus: "active", lastUsedAt: new Date(Date.now() - 60_000).toISOString(), consecutiveUseCount: 3 }),
    ]);
    dbMocks.getSettings.mockResolvedValue({
      fallbackStrategy: "round-robin",
      providerStrategies: { p: { stickyRoundRobinLimit: 3 } },
    });

    const picked = await getProviderCredentials("p");
    expect(picked.connectionId).toBe("b");
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith("b", expect.objectContaining({ consecutiveUseCount: 1 }));
  });
});

describe("health tier — preferred pin", () => {
  it("honours a pinned CLEAN account over the health tier", async () => {
    serve([
      conn("clean", { testStatus: "active" }),
      conn("pinned", { testStatus: "active" }),
    ]);

    const picked = await getProviderCredentials("p", null, null, { preferredConnectionId: "pinned" });
    expect(picked.connectionId).toBe("pinned");
  });

  it("steps a pinned SUSPECT account back for a clean candidate", async () => {
    serve([
      conn("clean", { testStatus: "active" }),
      conn("pinned-suspect", { testStatus: "unavailable" }),
    ]);

    const picked = await getProviderCredentials("p", null, null, { preferredConnectionId: "pinned-suspect" });
    expect(picked.connectionId).toBe("clean");
  });

  it("still honours a pinned suspect when it is the only candidate", async () => {
    serve([conn("pinned-suspect", { testStatus: "unavailable" })]);

    const picked = await getProviderCredentials("p", null, null, { preferredConnectionId: "pinned-suspect" });
    expect(picked.connectionId).toBe("pinned-suspect");
  });
});

describe("health tier — fail-open", () => {
  it("reads a throwing testStatus getter as clean and keeps serving", async () => {
    const hostile = conn("hostile");
    Object.defineProperty(hostile, "testStatus", {
      enumerable: true,
      get() { throw new Error("status read failed"); },
    });
    serve([hostile, conn("other", { testStatus: "active" })]);

    const picked = await getProviderCredentials("p");
    // No throw, and both are "clean" — DB order decides, as before this tide.
    expect(picked.connectionId).toBe("hostile");
  });
});
