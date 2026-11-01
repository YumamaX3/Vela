/**
 * Responsive Tide P2 — the keyed mutex itself.
 *
 * Pins the two laws the selection gate now depends on:
 *   · same key  → strict FIFO serialization (the round-robin read-then-write
 *     must never interleave with another pick for the same provider);
 *   · different keys → full concurrency (provider A's slow read must not delay
 *     provider B — the old global mutex's failure).
 * Plus the two failure laws: a throw frees the lane, and lanes never leak.
 */
import { describe, expect, it } from "vitest";
import { createKeyedMutex } from "../../src/lib/perf/keyedMutex.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

describe("keyedMutex — same key serializes, FIFO", () => {
  it("never overlaps two fn bodies on one key, and runs them in arrival order", async () => {
    const m = createKeyedMutex();
    const events = [];
    let active = 0;
    let maxActive = 0;

    const work = (name, ms) => m.run("p", async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`start:${name}`);
      await delay(ms);
      events.push(`end:${name}`);
      active -= 1;
      return name;
    });

    const results = await Promise.all([
      work("a", 20),
      work("b", 0),
      work("c", 0),
    ]);

    expect(maxActive).toBe(1);
    expect(events).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
    expect(results).toEqual(["a", "b", "c"]);
  });

  it("serializes a synchronous (non-awaiting) body too — the next call still queues", async () => {
    const m = createKeyedMutex();
    const order = [];
    const p1 = m.run("k", () => { order.push("sync-1"); return 1; });
    const p2 = m.run("k", () => { order.push("sync-2"); return 2; });
    // Bodies run on microtasks (they follow the prior tail), so neither has run
    // synchronously — what matters is that they never interleave.
    expect(order).toEqual([]);
    expect(await p1).toBe(1);
    expect(await p2).toBe(2);
    expect(order).toEqual(["sync-1", "sync-2"]);
  });

  it("a throwing body frees the lane and the throw reaches only its caller", async () => {
    const m = createKeyedMutex();
    const boom = m.run("k", async () => { throw new Error("boom"); });
    const after = m.run("k", async () => "ok");
    await expect(boom).rejects.toThrow("boom");
    await expect(after).resolves.toBe("ok");
    await tick();
    expect(m.size()).toBe(0);
  });
});

describe("keyedMutex — different keys run concurrently", () => {
  it("a slow key does not delay another key", async () => {
    const m = createKeyedMutex();
    const events = [];
    let releasedA;
    const aStarted = new Promise((r) => { releasedA = r; });

    const a = m.run("a", async () => {
      events.push("a:start");
      await aStarted; // A hangs until the test says so
      events.push("a:end");
    });
    const b = m.run("b", async () => {
      events.push("b:start");
      await delay(5);
      events.push("b:end");
    });

    // B must start and finish while A is still parked.
    await b;
    expect(events).toEqual(["a:start", "b:start", "b:end"]);
    releasedA();
    await a;
    expect(events).toEqual(["a:start", "b:start", "b:end", "a:end"]);
  });

  it("N keys across M in-flight picks each complete, all overlapping", async () => {
    const m = createKeyedMutex();
    let active = 0;
    let maxActive = 0;
    const keys = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const runs = keys.map((k) => m.run(k, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(10);
      active -= 1;
      return k;
    }));
    const done = await Promise.all(runs);
    expect(done).toEqual(keys);
    expect(maxActive).toBe(keys.length);
  });
});

describe("keyedMutex — bookkeeping hygiene", () => {
  it("drops the lane once its last queued body settles", async () => {
    const m = createKeyedMutex();
    const p1 = m.run("x", async () => delay(1));
    const p2 = m.run("x", async () => delay(1));
    expect(m.size()).toBe(1); // one lane, two queued bodies
    await Promise.all([p1, p2]);
    await tick();
    expect(m.size()).toBe(0);
  });

  it("keys are coerced to strings — '1' and 1 share a lane", async () => {
    const m = createKeyedMutex();
    const order = [];
    const a = m.run(1, async () => { await delay(5); order.push("num"); });
    const b = m.run("1", async () => { order.push("str"); });
    await Promise.all([a, b]);
    await delay(0); // lane release is a microtask behind the last body
    expect(order).toEqual(["num", "str"]);
    expect(m.size()).toBe(0);
  });
});
