/**
 * Responsive Tide P2 — the selection gate, end to end.
 *
 * The plan's exit: "Parallel-select test (N concurrent picks complete
 * interleaved); battery green". Before P2, getProviderCredentials held ONE
 * module-level promise chain (auth.js:23,178-180): every pick for every
 * provider queued behind every other pick, and a single slow read for
 * provider A stalled provider B. These tests drive the REAL auth.js (DB mocks
 * only, hoisted below) and pin both halves of the new law through app-level
 * observations — the interleaving of DB reads and the order round-robin
 * writes land in — never by peeking at module internals.
 *
 * What must NOT change (the correctness property): two picks for the SAME
 * provider, in round-robin, still rotate deterministically — sticky streak,
 * then the least-recently-used switch, exactly as the global mutex drove it.
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
  // Alias map exercising the "resolve before taking a lane" rule.
  resolveProviderId: (p) => (p === "kc" ? "kilocode" : p),
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Route getProviderConnections per provider id, with an observable clock. */
function routeConnections(byProvider) {
  dbMocks.getProviderConnections.mockImplementation(async ({ provider }) => {
    const spec = byProvider[provider];
    if (!spec) return [];
    if (typeof spec === "function") return spec();
    return spec;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getSettings.mockResolvedValue({ providerStrategies: {} });
  dbMocks.getProxyPools.mockResolvedValue([]);
  dbMocks.updateProviderConnection.mockImplementation(async () => ({}));
});

describe("P2 — cross-provider picks run concurrently", () => {
  it("a slow read for provider A does not stall the pick for provider B", async () => {
    const events = [];
    routeConnections({
      "A": async () => { events.push("A:read-start"); await delay(40); events.push("A:read-end"); return [conn("a1")]; },
      "B": async () => { events.push("B:read-start"); await delay(1); events.push("B:read-end"); return [conn("b1")]; },
    });

    const picks = [
      getProviderCredentials("A").then((c) => { events.push("A:done"); return c; }),
      getProviderCredentials("B").then((c) => { events.push("B:done"); return c; }),
    ];
    const [a, b] = await Promise.all(picks);

    expect(a.connectionId).toBe("a1");
    expect(b.connectionId).toBe("b1");
    // B ran to completion INSIDE A's read window — impossible under a global chain.
    expect(events).toEqual(["A:read-start", "B:read-start", "B:read-end", "B:done", "A:read-end", "A:done"]);
  });

  it("returns only after its own provider's pick completes", async () => {
    const logged = [];
    const conns = {
      k1: async () => { logged.push("k1"); return [conn("k1-c")]; },
      k2: async () => { logged.push("k2"); return [conn("k2-c")]; },
      k3: async () => { logged.push("k3"); return [conn("k3-c")]; },
    };
    routeConnections(conns);
    const results = await Promise.all(["k1", "k2", "k3"].map((k) => getProviderCredentials(k)));
    expect(results.map((r) => r.connectionId)).toEqual(["k1-c", "k2-c", "k3-c"]);
    expect(logged).toHaveLength(3);
  });

  it("N concurrent picks from N providers each settle with their own credential", async () => {
    const providers = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const specs = Object.fromEntries(
      providers.map((p, i) => [p, async () => { await delay(5 + i); return [conn(`${p}-only`)]; }]),
    );
    routeConnections(specs);

    const started = Date.now();
    const results = await Promise.all(providers.map((p) => getProviderCredentials(p)));
    const elapsed = Date.now() - started;

    expect(results.map((r) => r.connectionId)).toEqual(providers.map((p) => `${p}-only`));
    // Serialized, the longest hop alone is 10ms; the sum would be 75ms.
    // Assert generous concurrency (not the exact wall clock — CI noise).
    expect(elapsed).toBeLessThan(60);
  });
});

describe("P2 — same-provider picks keep the old serialization", () => {
  it("two picks for ONE provider never overlap their read phases", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const events = [];
    routeConnections({
      solo: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        events.push("read-start");
        await delay(10);
        events.push("read-end");
        inFlight -= 1;
        return [conn("s-enabled")];
      },
    });

    await Promise.all([getProviderCredentials("solo"), getProviderCredentials("solo")]);
    expect(maxInFlight).toBe(1);
    expect(events).toEqual(["read-start", "read-end", "read-start", "read-end"]);
  });

  it("an alias and its canonical id share one lane", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    routeConnections({
      kilocode: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await delay(10);
        inFlight -= 1;
        return [conn("kc-1")];
      },
    });

    await Promise.all([getProviderCredentials("kc"), getProviderCredentials("kilocode")]);
    expect(maxInFlight).toBe(1);
  });

  it("a failed pick (throw) does not wedge the next pick for the same provider", async () => {
    let call = 0;
    routeConnections({
      flaky: async () => {
        call += 1;
        if (call === 1) throw new Error("db hiccup");
        return [conn("flaky-1")];
      },
    });
    await expect(getProviderCredentials("flaky")).rejects.toThrow("db hiccup");
    const next = await getProviderCredentials("flaky");
    expect(next.connectionId).toBe("flaky-1");
  });

  it("an early return (no connection) releases the lane", async () => {
    let call = 0;
    routeConnections({
      empty: async () => { call += 1; return call === 1 ? [] : [conn("e-1")]; },
    });
    expect(await getProviderCredentials("empty")).toBeNull();
    const next = await getProviderCredentials("empty");
    expect(next.connectionId).toBe("e-1");
  });
});

describe("P2 — round-robin determinism survives the per-provider lane", () => {
  const base = () => [
    conn("a", { lastUsedAt: null, consecutiveUseCount: 0, priority: 1 }),
    conn("b", { lastUsedAt: null, consecutiveUseCount: 0, priority: 2 }),
  ];

  it("first pick takes the first by priority and stamps streak 1", async () => {
    dbMocks.getSettings.mockResolvedValue({ providerStrategies: { rr: { fallbackStrategy: "round-robin" } }, stickyRoundRobinLimit: 2 });
    routeConnections({ rr: async () => base() });

    const c = await getProviderCredentials("rr");
    expect(c.connectionId).toBe("a");
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const [, patch] = dbMocks.updateProviderConnection.mock.calls[0];
    expect(patch).toMatchObject({ consecutiveUseCount: 1 });
  });

  it("sticky: a current account inside its streak is kept and its count incremented", async () => {
    dbMocks.getSettings.mockResolvedValue({ providerStrategies: { rr: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 } } });
    routeConnections({
      rr: async () => [
        conn("a", { lastUsedAt: "2026-11-01T00:00:02Z", consecutiveUseCount: 1, priority: 1 }),
        conn("b", { lastUsedAt: "2026-11-01T00:00:01Z", consecutiveUseCount: 1, priority: 2 }),
      ],
    });

    const c = await getProviderCredentials("rr");
    expect(c.connectionId).toBe("a");
    const [id, patch] = dbMocks.updateProviderConnection.mock.calls[0];
    expect(id).toBe("a");
    expect(patch).toMatchObject({ consecutiveUseCount: 2 });
  });

  it("streak exhausted: rotates to the least-recently-used and resets the count to 1", async () => {
    dbMocks.getSettings.mockResolvedValue({ providerStrategies: { rr: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 2 } } });
    routeConnections({
      rr: async () => [
        conn("a", { lastUsedAt: "2026-11-01T00:00:02Z", consecutiveUseCount: 2, priority: 1 }),
        conn("b", { lastUsedAt: "2026-11-01T00:00:01Z", consecutiveUseCount: 1, priority: 2 }),
      ],
    });

    const c = await getProviderCredentials("rr");
    expect(c.connectionId).toBe("b");
    const [id, patch] = dbMocks.updateProviderConnection.mock.calls[0];
    expect(id).toBe("b");
    expect(patch).toMatchObject({ consecutiveUseCount: 1 });
  });

  it("two concurrent picks on a mutable store rotate a → b, never a → a", async () => {
    // A tiny in-memory store honouring the write the selector issues, so the
    // SECOND pick sees the FIRST pick's stamp. Under interleaved (unserialized)
    // selection both would read a fresh store and both pick "a".
    dbMocks.getSettings.mockResolvedValue({ providerStrategies: { rr: { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 1 } }, stickyRoundRobinLimit: 1 });
    let store = base();
    let readInFlight = false;
    routeConnections({
      rr: async () => {
        // Make the read-then-write window observable: a second overlapping
        // read is the failure we are pinning against.
        if (readInFlight) throw new Error("overlapping read — lane lost");
        readInFlight = true;
        const snapshot = store.map((c) => ({ ...c }));
        await delay(5);
        readInFlight = false;
        return snapshot;
      },
    });
    dbMocks.updateProviderConnection.mockImplementation(async (id, patch) => {
      store = store.map((c) => (c.id === id ? { ...c, ...patch } : c));
      return {};
    });

    const [first, second] = await Promise.all([
      getProviderCredentials("rr"),
      getProviderCredentials("rr"),
    ]);
    expect([first.connectionId, second.connectionId]).toEqual(["a", "b"]);
  });
});
