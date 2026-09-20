/**
 * W6 · Account hygiene — accountSemaphore unit tests
 * (plan `2026-09-20-sibling-harbor-ports` §3.1 row 6, FR-9).
 *
 * Covers the three behaviours the plan names for this module:
 *   (a) N parallel acquires on one account serialize (FIFO order, one holder);
 *   (b) the bounded queue drops-and-logs when full rather than growing;
 *   plus the port's supporting surface: key building, bypass, markBlocked with
 *   a per-category default duration, stats, and idle cleanup.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  acquire,
  markBlocked,
  getAccountSemaphoreStats,
  isSemaphoreCapacityError,
  buildAccountSemaphoreKey,
  deriveProxyBucketHash,
  resolveAccountSemaphoreKey,
  resolveAccountSemaphoreMaxConcurrency,
  resetAccountSemaphore,
  SemaphoreCapacityError,
  DEFAULT_MAX_QUEUE_SIZE,
} from "../../open-sse/services/accountSemaphore.js";
import { clearProviderResilienceCache } from "../../open-sse/config/providerProfiles.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  resetAccountSemaphore();
  clearProviderResilienceCache();
});
afterEach(() => {
  resetAccountSemaphore();
});

describe("accountSemaphore · key building", () => {
  it("builds a provider:accountKey:proxyHash string", () => {
    expect(buildAccountSemaphoreKey({ provider: "kimchi", accountKey: "acc-1" })).toBe("kimchi:acc-1:direct");
    expect(buildAccountSemaphoreKey({ provider: "kimchi", accountKey: "acc-1", proxyHash: "pool-abc" }))
      .toBe("kimchi:acc-1:pool-abc");
  });

  it("stringifies non-string values", () => {
    expect(buildAccountSemaphoreKey({ provider: 42, accountKey: null })).toBe("42:null:direct");
  });

  it("derives the same proxy bucket for accounts sharing a proxy", () => {
    const a = deriveProxyBucketHash({ connectionProxyEnabled: true, connectionProxyUrl: "http://p:1" });
    const b = deriveProxyBucketHash({ connectionProxyEnabled: true, connectionProxyUrl: "http://p:1" });
    const c = deriveProxyBucketHash({ connectionProxyEnabled: true, connectionProxyUrl: "http://p:2" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(deriveProxyBucketHash({})).toBe("direct");
    expect(deriveProxyBucketHash({ proxyPoolId: "pool-x" })).toMatch(/^pool-/);
  });
});

describe("accountSemaphore · (a) N parallel acquires on one account serialize", () => {
  it("grants exactly one holder at a time and preserves FIFO order", async () => {
    const key = buildAccountSemaphoreKey({ provider: "serialize-n", accountKey: "acc" });
    const N = 6;
    let inFlight = 0;
    let maxInFlight = 0;
    const order = [];

    const run = async (i) => {
      const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 5000 });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(i);
      await tick(1); // hold the slot long enough for the others to queue
      inFlight--;
      release();
    };

    // All N acquire() calls are issued synchronously in index order, so the
    // queue order is deterministic and the FIFO assertion is not a race.
    await Promise.all(Array.from({ length: N }, (_, i) => run(i)));

    expect(order).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxInFlight).toBe(1);
  });

  it("reports the correct running/queued counts while saturated", async () => {
    const key = buildAccountSemaphoreKey({ provider: "counts", accountKey: "acc" });
    const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 5000 });
    const waiters = [
      acquire(key, { maxConcurrency: 1, timeoutMs: 5000 }),
      acquire(key, { maxConcurrency: 1, timeoutMs: 5000 }),
    ];
    const stats = getAccountSemaphoreStats().find((s) => s.key === key);
    expect(stats.running).toBe(1);
    expect(stats.queued).toBe(2);
    expect(stats.maxConcurrency).toBe(1);

    release();
    const r1 = await waiters[0];
    r1();
    const r2 = await waiters[1];
    r2();
  });

  it("does not double-release a slot when the release fn is called twice", async () => {
    const key = buildAccountSemaphoreKey({ provider: "double-release", accountKey: "acc" });
    const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 5000 });
    release();
    release();
    await tick();
    // Gate cleaned up; no negative running count survives.
    const stats = getAccountSemaphoreStats().find((s) => s.key === key);
    expect(stats).toBeUndefined();
  });
});

describe("accountSemaphore · (b) bounded queue drops-and-logs instead of growing", () => {
  it("rejects with a queue_full capacity error and logs once when the bound is reached", async () => {
    const key = buildAccountSemaphoreKey({ provider: "bounded-drop", accountKey: "acc" });
    const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 5000 });
    const warnings = [];
    const log = { warn: (m) => warnings.push(m) };
    const maxQueueSize = 2;

    const queued = [
      acquire(key, { maxConcurrency: 1, timeoutMs: 5000, maxQueueSize, log }),
      acquire(key, { maxConcurrency: 1, timeoutMs: 5000, maxQueueSize, log }),
    ];

    // The third waiter exceeds the bound → rejected immediately, not queued.
    let dropped = null;
    try {
      await acquire(key, { maxConcurrency: 1, maxQueueSize, log });
    } catch (e) {
      dropped = e;
    }
    expect(dropped).toBeInstanceOf(SemaphoreCapacityError);
    expect(isSemaphoreCapacityError(dropped)).toBe(true);
    expect(dropped.reason).toBe("queue_full");
    expect(dropped.maxQueueSize).toBe(maxQueueSize);

    const stats = getAccountSemaphoreStats().find((s) => s.key === key);
    expect(stats.queued).toBe(maxQueueSize); // the queue did NOT grow
    expect(stats.dropped).toBe(1);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("queue full");
    expect(warnings[0]).toContain("2/2");
    // The drop line names the provider, never the account segment of the key.
    expect(warnings[0]).toContain("bounded-drop");
    expect(warnings[0]).not.toContain(":acc:");

    release();
    const r1 = await queued[0];
    r1();
    const r2 = await queued[1];
    r2();
  });

  it("keeps dropping (and counting) every request past the bound", async () => {
    const key = buildAccountSemaphoreKey({ provider: "bounded-many", accountKey: "acc" });
    const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 5000 });
    const warnings = [];
    const log = { warn: (m) => warnings.push(m) };
    const queued = [acquire(key, { maxConcurrency: 1, timeoutMs: 5000, maxQueueSize: 1, log })];

    const results = await Promise.allSettled([
      acquire(key, { maxConcurrency: 1, maxQueueSize: 1, log }),
      acquire(key, { maxConcurrency: 1, maxQueueSize: 1, log }),
      acquire(key, { maxConcurrency: 1, maxQueueSize: 1, log }),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(warnings).toHaveLength(3);

    const stats = getAccountSemaphoreStats().find((s) => s.key === key);
    expect(stats.queued).toBe(1);
    expect(stats.dropped).toBe(3);

    release();
    const r1 = await queued[0];
    r1();
  });

  it("defaults the queue bound to DEFAULT_MAX_QUEUE_SIZE", async () => {
    const key = buildAccountSemaphoreKey({ provider: "bounded-default", accountKey: "acc" });
    const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 5000 });
    const queued = [];
    for (let i = 0; i < DEFAULT_MAX_QUEUE_SIZE; i++) {
      queued.push(acquire(key, { maxConcurrency: 1, timeoutMs: 5000, log: null }));
    }
    await expect(acquire(key, { maxConcurrency: 1, log: null })).rejects.toThrow(SemaphoreCapacityError);
    const stats = getAccountSemaphoreStats().find((s) => s.key === key);
    expect(stats.queued).toBe(DEFAULT_MAX_QUEUE_SIZE);

    release();
    for (const q of queued) {
      const r = await q;
      r();
    }
  });

  it("times out a queued waiter when no slot ever frees", async () => {
    const key = buildAccountSemaphoreKey({ provider: "timeout", accountKey: "acc" });
    const release = await acquire(key, { maxConcurrency: 1 });
    await expect(acquire(key, { maxConcurrency: 1, timeoutMs: 40 }))
      .rejects.toThrow(SemaphoreCapacityError);
    release();
  });

  it("bypasses entirely when maxConcurrency is 0 or null", async () => {
    const k1 = buildAccountSemaphoreKey({ provider: "bypass-0", accountKey: "acc" });
    const k2 = buildAccountSemaphoreKey({ provider: "bypass-null", accountKey: "acc" });
    const r1 = await acquire(k1, { maxConcurrency: 0 });
    const r2 = await acquire(k2, { maxConcurrency: null });
    expect(typeof r1).toBe("function");
    expect(typeof r2).toBe("function");
    r1();
    r2();
  });
});

describe("accountSemaphore · markBlocked", () => {
  it("queues new acquires while the gate is blocked", async () => {
    const key = buildAccountSemaphoreKey({ provider: "block-1", accountKey: "acc" });
    const release = await acquire(key, { maxConcurrency: 1 });
    markBlocked(key, 100);
    await expect(acquire(key, { maxConcurrency: 1, timeoutMs: 30 }))
      .rejects.toThrow(SemaphoreCapacityError);
    release();
  });

  it("wakes queued waiters automatically when the block expires", async () => {
    const key = buildAccountSemaphoreKey({ provider: "block-wake", accountKey: "acc" });
    const release = await acquire(key, { maxConcurrency: 1 });
    let granted = false;
    markBlocked(key, 80);
    const second = acquire(key, { maxConcurrency: 1, timeoutMs: 5000 }).then((rel) => {
      granted = true;
      return rel;
    });
    release();
    await tick(30);
    expect(granted).toBe(false); // slot free, but gate still blocked
    const release2 = await second; // granted by the block-expiry wake timer alone
    expect(granted).toBe(true);
    release2();
  });

  it("falls back to the provider's auth-category cooldown when no duration is given", async () => {
    // api-key category default cooldown is 30s (providerProfiles.js) — the
    // omitted-duration call must use it rather than a hardcoded constant.
    const key = buildAccountSemaphoreKey({ provider: "openai", accountKey: "acc" });
    const release = await acquire(key, { maxConcurrency: 1 });
    markBlocked(key); // no duration
    const stats = getAccountSemaphoreStats().find((s) => s.key === key);
    const remaining = new Date(stats.blockedUntil).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(25_000);
    expect(remaining).toBeLessThanOrEqual(30_000);
    release();
  });
});

describe("accountSemaphore · resolve helpers", () => {
  it("returns null when provider or connectionId is missing", () => {
    expect(resolveAccountSemaphoreKey({ provider: null, connectionId: "x" })).toBe(null);
    expect(resolveAccountSemaphoreKey({ provider: "kimchi", connectionId: null })).toBe(null);
  });

  it("returns provider:connectionId:proxyHash when present", () => {
    expect(resolveAccountSemaphoreKey({ provider: "kimchi", connectionId: "acc-7" })).toBe("kimchi:acc-7:direct");
  });

  it("resolves max concurrency with an explicit bypass", () => {
    expect(resolveAccountSemaphoreMaxConcurrency(null)).toBe(3);
    expect(resolveAccountSemaphoreMaxConcurrency({})).toBe(3);
    expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: { maxConcurrency: 0 } })).toBe(null);
    expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: { maxConcurrency: null } })).toBe(null);
    expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: { maxConcurrency: 5 } })).toBe(5);
  });
});

describe("accountSemaphore · idle cleanup", () => {
  it("deletes the gate once all slots are released and the queue is empty", async () => {
    const key = buildAccountSemaphoreKey({ provider: "cleanup", accountKey: "acc" });
    const release = await acquire(key, { maxConcurrency: 1 });
    expect(getAccountSemaphoreStats().some((s) => s.key === key)).toBe(true);
    release();
    await tick(20);
    expect(getAccountSemaphoreStats().some((s) => s.key === key)).toBe(false);
  });
});
