// Bounded pool — the three laws, each one measured on its own.
//
// ORDER: results come back aligned to input, even when later entries finish
// first. BOUND: no more than `concurrency` workers are ever in flight (and the
// current actually widens — the "spread the start" law). ISOLATION: one entry
// throwing is that entry's verdict, never the batch's.
import { describe, it, expect } from "vitest";
import { runPool, normalizeConcurrency, DEFAULT_POOL_CONCURRENCY } from "@/shared/utils/boundedPool.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A probe that records every call's in-flight window, so overlap is measured
// rather than assumed from wall-clock luck.
function probe(latencyMs = 20) {
  const state = { inFlight: 0, peak: 0, started: 0, finished: [] };
  const work = async (item) => {
    state.inFlight += 1;
    state.started += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    try {
      await sleep(latencyMs);
      return { id: item, ok: true };
    } finally {
      state.inFlight -= 1;
      state.finished.push(item);
    }
  };
  return { state, work };
}

describe("runPool — order preserved", () => {
  it("results[i] is items[i]'s verdict even when later items finish first", async () => {
    // item 0 is the slowest, so completion order is the REVERSE of input order;
    // a pool that pushed verdicts as they landed would return them reversed.
    const items = [60, 45, 30, 15, 1];
    const results = await runPool(items, async (ms) => {
      await sleep(ms);
      return `done-${ms}`;
    }, { concurrency: 5 });

    expect(results).toEqual(["done-60", "done-45", "done-30", "done-15", "done-1"]);
  });

  it("hands the worker the item's true index", async () => {
    const seen = [];
    await runPool(["a", "b", "c", "d"], async (item, index) => {
      await sleep((4 - index) * 5);
      seen[index] = `${index}:${item}`;
    }, { concurrency: 4 });
    expect(seen).toEqual(["0:a", "1:b", "2:c", "3:d"]);
  });
});

describe("runPool — bounded concurrency", () => {
  it("never has more than `concurrency` workers in flight", async () => {
    const { state, work } = probe(15);
    const items = Array.from({ length: 23 }, (_, i) => i);
    await runPool(items, work, { concurrency: 6 });

    expect(state.started).toBe(23);
    expect(state.peak).toBeLessThanOrEqual(6);
    expect(state.peak).toBeGreaterThan(1); // the bound is a ceiling, not a throttle to 1
  });

  it("actually widens the current — 24 slow entries on 6 workers beat the loop", async () => {
    const items = Array.from({ length: 24 }, (_, i) => i);
    const { state, work } = probe(25);

    const t0 = Date.now();
    await runPool(items, work, { concurrency: 6 });
    const pooled = Date.now() - t0;

    // Sequential would be 24 × 25ms = 600ms. Six workers: 4 waves ≈ 100ms.
    // Generous ceiling to stay honest on a loaded CI box, still far under the sum.
    expect(pooled).toBeLessThan(24 * 25 * 0.75);
    expect(state.peak).toBe(6);
  });

  it("one worker when concurrency is 1 — the old loop, kept as a floor", async () => {
    const { state, work } = probe(2);
    await runPool([1, 2, 3, 4], work, { concurrency: 1 });
    expect(state.peak).toBe(1);
    expect(state.finished).toEqual([1, 2, 3, 4]);
  });

  it("never starts more workers than there are items", async () => {
    const { state, work } = probe(5);
    await runPool([1, 2], work, { concurrency: 6 });
    expect(state.peak).toBe(2);
  });
});

describe("runPool — isolation and edges", () => {
  it("an entry that throws becomes its own verdict; the batch runs to the end", async () => {
    const items = ["ok-1", "boom", "ok-2", "ok-3"];
    const results = await runPool(items, async (item) => {
      await sleep(1);
      if (item === "boom") throw new Error("mint refused");
      return { ok: true, id: item };
    }, { concurrency: 2 });

    expect(results).toHaveLength(4);
    expect(results[0]).toEqual({ ok: true, id: "ok-1" });
    expect(results[1]).toEqual({ ok: false, error: "mint refused" });
    expect(results[2]).toEqual({ ok: true, id: "ok-2" });
    expect(results[3]).toEqual({ ok: true, id: "ok-3" });
  });

  it("isolates many failing entries at their own indices", async () => {
    const results = await runPool([0, 1, 2, 3, 4], (i) => {
      if (i % 2 === 1) throw new Error(`bad ${i}`);
      return { ok: true };
    }, { concurrency: 3 });
    expect(results.map((r) => r.ok)).toEqual([true, false, true, false, true]);
    expect(results[3].error).toBe("bad 3");
  });

  it("an error without a message still yields an honest verdict", async () => {
    const [only] = await runPool([1], () => { throw { message: "" }; });
    expect(only).toEqual({ ok: false, error: "Operation failed" });
  });

  it("a fatal error stops the batch and rejects — the caller's own statement", async () => {
    const items = [1, 2, 3, 4, 5, 6];
    const run = runPool(items, async (i) => {
      if (i === 2) {
        const error = new Error("the harbor is unreachable");
        error.fatal = true;
        throw error;
      }
      return { ok: true, id: i };
    }, { concurrency: 1 });
    await expect(run).rejects.toThrow("the harbor is unreachable");
  });

  it("validateInput refuses before any worker starts, so nothing is half-applied", async () => {
    let started = 0;
    const run = runPool([1, 2, 3], () => { started += 1; return "x"; }, {
      concurrency: 2,
      validateInput: (item) => { if (item === 3) throw new Error(`bad item ${item}`); },
    });
    await expect(run).rejects.toThrow("bad item 3");
    expect(started).toBe(0);
  });

  it("an empty list resolves to an empty aligned array without starting a worker", async () => {
    await expect(runPool([], () => "x")).resolves.toEqual([]);
    await expect(runPool(undefined, () => "x")).resolves.toEqual([]);
  });

  it("a worker that resolves synchronously still respects the bound", async () => {
    const state = { inFlight: 0, peak: 0 };
    await runPool(Array.from({ length: 20 }, (_, i) => i), (i) => {
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      state.inFlight -= 1;
      return i;
    }, { concurrency: 3 });
    expect(state.peak).toBeLessThanOrEqual(3);
  });
});

describe("normalizeConcurrency", () => {
  it("passes a real width through and floors bad widths to the default", () => {
    expect(normalizeConcurrency(6)).toBe(6);
    expect(normalizeConcurrency("4")).toBe(4);
    expect(normalizeConcurrency(2.9)).toBe(2);
    expect(normalizeConcurrency(0)).toBe(DEFAULT_POOL_CONCURRENCY);
    expect(normalizeConcurrency(-3)).toBe(DEFAULT_POOL_CONCURRENCY);
    expect(normalizeConcurrency(undefined)).toBe(DEFAULT_POOL_CONCURRENCY);
    expect(normalizeConcurrency(NaN)).toBe(DEFAULT_POOL_CONCURRENCY);
  });
});
