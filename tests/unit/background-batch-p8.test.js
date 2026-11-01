/**
 * P8 · background-write batching — the Responsive Tide
 * (plans/2026-11-01-responsive-tide-performance.md §III, mend P8).
 *
 * THE EXIT (the plan's words): "Sweep test; battery green" — the sweeps'
 * per-item work is capped in flight, yields a real macrotask between groups, and
 * a failing item never wedges the round.
 *
 * Two instruments, deliberately separate:
 *   • the helper (backgroundBatch) — MEASURED with timers and counters: peak
 *     in-flight never exceeds the bound; a `setImmediate`-scheduled observer runs
 *     BETWEEN waves (proof the loop was handed back); failures are contained;
 *   • the three sweeps — driven through their real tick functions with injected
 *     deps (the existing house pattern: zcode-plan-auto-claim.test.js), proving
 *     the bound and the breathing reach the actual sweeps, and that neither the
 *     `tickRunning` latch nor the per-item ordering regressed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("../../open-sse/services/zcodePlanQuota.js", () => ({
  refreshZcodeQuotaForConnection: vi.fn(),
  quotaResetAtMs: vi.fn(),
}));

import { runBoundedBatch, yieldToLoop } from "../../open-sse/utils/backgroundBatch.js";
import {
  runZcodePlanSweepTick,
  ZCODE_SWEEP_CONCURRENCY,
  ZCODE_SWEEP_YIELD_EVERY,
} from "../../open-sse/services/zcodePlanSweep.js";
import {
  runZcodePlanAutoClaimTick,
  ZCODE_AUTO_CLAIM_CONCURRENCY,
  ZCODE_AUTO_CLAIM_YIELD_EVERY,
} from "../../open-sse/services/zcodePlanAutoClaim.js";
import { getUndiciTuning } from "../../src/lib/perf/undiciDispatcher.js";
import {
  NETWORK_CHECK_INTERVAL_MS,
  SLEEP_DETECT_MS,
  NETWORK_SETTLE_MS,
  RESTART_COOLDOWN_MS,
} from "../../src/lib/tunnel/shared/watchdogConfig.js";

// The sweeps' schedulers unref their timers; a tick leaves none behind, but the
// auto-claim module may have been imported by another suite with its scheduler
// running — we never start it here, and the injected deps keep the DB untouched.

describe("P8 — runBoundedBatch: the ceiling", () => {
  it("never runs more than `concurrency` items at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const stats = await runBoundedBatch(
      items,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
      },
      { concurrency: 4, every: 4 }
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1); // it IS parallel — a serial loop would peak at 1
    expect(stats).toEqual({ processed: 20, failed: 0, yields: 5 });
  });

  it("runs every item exactly once, in order, across the waves", async () => {
    const seen = [];
    await runBoundedBatch([1, 2, 3, 4, 5, 6, 7], async (n) => { seen.push(n); }, { concurrency: 3, every: 3 });
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("an empty batch is a no-op that never touches the loop", async () => {
    const onItem = vi.fn();
    expect(await runBoundedBatch([], onItem)).toEqual({ processed: 0, failed: 0, yields: 0 });
    expect(onItem).not.toHaveBeenCalled();
  });
});

describe("P8 — runBoundedBatch: the breathing", () => {
  it("a timer scheduled DURING the batch fires in the GAPS between waves (the loop is handed back)", async () => {
    // The observer is scheduled from inside the first item — i.e. after the batch
    // has started monopolising microtasks — and must land before the batch ends.
    let observedAt = -1;
    let itemsFinishedAtFirstYield = 0;
    let done = 0;
    await runBoundedBatch(
      Array.from({ length: 12 }, (_, i) => i),
      async (n) => {
        if (n === 0) {
          setImmediate(() => { observedAt = done; });
        }
        await Promise.resolve();
        done += 1;
      },
      { concurrency: 2, every: 4 }
    );
    expect(observedAt).toBeGreaterThan(0); // it ran
    expect(observedAt).toBeLessThan(12); // and it ran BEFORE the batch was over
    expect((itemsFinishedAtFirstYield = done)).toBe(12);
  });

  it("yieldToLoop resolves on a macrotask, not a microtask", async () => {
    let microtask = false;
    const order = [];
    Promise.resolve().then(() => { microtask = true; order.push("micro"); });
    await yieldToLoop();
    order.push("immediate");
    expect(order).toEqual(["micro", "immediate"]);
    expect(microtask).toBe(true);
  });

  it("reports the number of yields — the cadence is pinned, never incidental", async () => {
    const stats = await runBoundedBatch([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], async () => {}, { concurrency: 2, every: 2 });
    expect(stats.yields).toBe(5);
    const sparse = await runBoundedBatch([0, 0, 0], async () => {}, { concurrency: 2, every: 5 });
    expect(sparse.yields).toBe(0);
  });
});

describe("P8 — runBoundedBatch: fail-open per item", () => {
  it("a throwing item is counted and reported, and the batch finishes the rest", async () => {
    const errors = [];
    const stats = await runBoundedBatch(
      [1, 2, 3, 4],
      async (n) => { if (n % 2 === 0) throw new Error(`boom-${n}`); },
      { concurrency: 2, every: 2, onError: (item, index, err) => errors.push([item, index, err.message]) }
    );
    expect(stats.processed).toBe(2);
    expect(stats.failed).toBe(2);
    expect(errors).toEqual([[2, 1, "boom-2"], [4, 3, "boom-4"]]);
  });

  it("an onError that itself throws does not abort the batch", async () => {
    const stats = await runBoundedBatch(
      [1, 2],
      async () => { throw new Error("x"); },
      { onError: () => { throw new Error("reporter broke"); } }
    );
    expect(stats.failed).toBe(2);
  });

  it("never rejects — the sweeps' try/finally latch depends on that", async () => {
    await expect(runBoundedBatch([1], async () => { throw new Error("x"); })).resolves.toBeTruthy();
  });
});

describe("P8 — the zcode-plan quota sweep", () => {
  it("is capped at ZCODE_SWEEP_CONCURRENCY in flight and yields on its cadence", async () => {
    let inFlight = 0;
    let peak = 0;
    const conns = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, provider: "zcode-plan", isActive: true }));
    await runZcodePlanSweepTick({
      loadConnections: async () => conns,
      refreshConnection: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
      },
    });
    expect(peak).toBe(ZCODE_SWEEP_CONCURRENCY);
    expect(peak).toBeLessThan(conns.length); // the old Promise.allSettled peaked at 10
  });

  it("a failing refresh is swallowed and the round completes (latch released)", async () => {
    const calls = [];
    await runZcodePlanSweepTick({
      loadConnections: async () => [
        { id: "a", provider: "zcode-plan" },
        { id: "b", provider: "zcode-plan" },
      ],
      refreshConnection: async (c) => {
        calls.push(c.id);
        if (c.id === "a") throw new Error("billing 500");
      },
    });
    expect(calls.sort()).toEqual(["a", "b"]);
    // A second tick still runs — the previous one did not wedge `tickRunning`.
    let secondRan = false;
    await runZcodePlanSweepTick({
      loadConnections: async () => [{ id: "c", provider: "zcode-plan" }],
      refreshConnection: async () => { secondRan = true; },
    });
    expect(secondRan).toBe(true);
  });

  it("the cadence constants are the documented ones", () => {
    expect(ZCODE_SWEEP_CONCURRENCY).toBe(4);
    expect(ZCODE_SWEEP_YIELD_EVERY).toBe(4);
  });
});

describe("P8 — the zcode-plan auto-claim", () => {
  function conn(id, extra = {}) {
    return { id, provider: "zcode-plan", isActive: true, ...extra };
  }
  const deps = (connections, claim = vi.fn(async () => ({ claim: { claimed: ["Pro"], skipped: [] }, problems: [] })), persist = vi.fn()) => ({
    isEnabled: vi.fn(async () => true),
    loadConnections: vi.fn(async () => connections),
    claim,
    persist,
  });

  it("is capped at ZCODE_AUTO_CLAIM_CONCURRENCY and claims each fresh mooring exactly once", async () => {
    let inFlight = 0;
    let peak = 0;
    const claim = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { claim: { claimed: [], skipped: [] }, problems: [] };
    });
    const conns = Array.from({ length: 6 }, (_, i) => conn(`c${i}`));
    const d = deps(conns, claim, vi.fn());
    expect(await runZcodePlanAutoClaimTick(d)).toEqual({ ran: 6 });
    expect(peak).toBe(ZCODE_AUTO_CLAIM_CONCURRENCY);
    expect(d.persist).toHaveBeenCalledTimes(6);
  });

  it("the 6h-gap filter runs BEFORE the batch — a fully-skipped round never yields", async () => {
    const recent = new Date().toISOString();
    const conns = [conn("r1", { providerSpecificData: { zcodeLastAutoClaimAt: recent } })];
    const claim = vi.fn();
    let setImmediateCalls = 0;
    const real = globalThis.setImmediate;
    globalThis.setImmediate = (...args) => { setImmediateCalls += 1; return real(...args); };
    try {
      const d = deps(conns, claim);
      expect(await runZcodePlanAutoClaimTick(d)).toEqual({ ran: 0 });
      expect(claim).not.toHaveBeenCalled();
      expect(d.persist).not.toHaveBeenCalled();
      expect(setImmediateCalls).toBe(0);
    } finally {
      globalThis.setImmediate = real;
    }
  });

  it("each claim's persist still follows ITS claim (causality kept across the waves)", async () => {
    const events = [];
    const claim = vi.fn(async (c) => { events.push(`claim:${c.id}`); return { claim: {}, problems: [] }; });
    const persist = vi.fn(async (c) => { events.push(`persist:${c.id}`); });
    const d = deps([conn("x"), conn("y")], claim, persist);
    await runZcodePlanAutoClaimTick(d);
    expect(events).toEqual(["claim:x", "claim:y", "persist:x", "persist:y"]);
  });

  it("a throwing claim is swallowed and the round reports the rest (latch released)", async () => {
    const claim = vi.fn(async (c) => {
      if (c.id === "boom") throw new Error("claim failed");
      return { claim: {}, problems: [] };
    });
    const d = deps([conn("boom"), conn("fine")], claim, vi.fn());
    expect(await runZcodePlanAutoClaimTick(d)).toEqual({ ran: 2 });
    expect(d.persist).toHaveBeenCalledTimes(1);
    // The next tick is not blocked by a leftover latch.
    const d2 = deps([conn("again")]);
    expect(await runZcodePlanAutoClaimTick(d2)).toEqual({ ran: 1 });
  });

  it("the concurrency guard still refuses a concurrent tick", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const first = deps([conn("slow")]);
    first.loadConnections = vi.fn(async () => { await gate; return [conn("slow")]; });
    const slow = runZcodePlanAutoClaimTick(first);
    await Promise.resolve();
    await Promise.resolve();
    const second = deps([]);
    expect(await runZcodePlanAutoClaimTick(second)).toEqual({ ran: 0 });
    release();
    expect(await slow).toEqual({ ran: 1 });
  });

  it("the cadence constants are the documented ones", () => {
    expect(ZCODE_AUTO_CLAIM_CONCURRENCY).toBe(2);
    expect(ZCODE_AUTO_CLAIM_YIELD_EVERY).toBe(2);
  });
});

describe("P8 — the network monitor cadence", () => {
  it("polls at 30s (was 5s) — 6× fewer interface reads and reachability probes", () => {
    expect(NETWORK_CHECK_INTERVAL_MS).toBe(30_000);
  });

  it("the sleep-detection window holds at the tested 30s — NOT re-derived from the poll cadence", () => {
    // The pre-mend expression was `NETWORK_CHECK_INTERVAL_MS * 6` = 30s at a 5s
    // poll. Re-deriving it from the 30s cadence would silently stretch it to 3
    // minutes and swallow short sleeps; it is now an explicit idiom instead.
    expect(SLEEP_DETECT_MS).toBe(30_000);
    expect(SLEEP_DETECT_MS).not.toBe(NETWORK_CHECK_INTERVAL_MS * 6);
  });

  it("the settle window and restart cooldown are untouched; a transition is still caught inside the cooldown", () => {
    expect(NETWORK_SETTLE_MS).toBe(2_500);
    expect(RESTART_COOLDOWN_MS).toBe(120_000);
    // Worst-case latency to notice a DHCP bounce = one poll; it must land well
    // inside the cooldown that gates a repeated restart.
    expect(NETWORK_CHECK_INTERVAL_MS).toBeLessThan(RESTART_COOLDOWN_MS / 2);
  });
});

describe("P8 — the P7 seam stays independent", () => {
  it("importing the batch helper does not install the dispatcher", () => {
    expect(getUndiciTuning().installed).toBe(false);
  });
});

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });
