// The scheduler's three modes, proven where a cache does damage.
//
// A shard cache has exactly three ways to hurt: it changes the answer (indexed
// serving something legacy would not), it goes stale across a revision, or it
// leaks identity into a diagnostic. Each `describe` below pins one.
import { describe, expect, it } from "vitest";
import {
  RoutingScheduler,
  SCHEDULER_MODES,
  SCHEDULER_DEFAULT_MODE,
  SCHEDULER_MISMATCH_LIMIT,
  resolveSchedulerMode,
} from "../../open-sse/shared/codebuddy/routingScheduler.js";

const entries = Object.freeze(["a", "b", "c", "d"]);
const run = (scheduler, over = {}) => scheduler.candidates({
  mode: "indexed",
  model: "glm-5.2",
  region: "intl",
  revisions: ["r1"],
  entries,
  evaluate: (e) => e !== "b",
  ...over,
});

describe("mode resolution never guesses upward", () => {
  it("accepts only the three known modes", () => {
    for (const mode of SCHEDULER_MODES) expect(resolveSchedulerMode(mode)).toBe(mode);
  });

  it("falls back to shadow — never indexed — for anything unknown", () => {
    for (const bad of [undefined, null, "", "active", "INDEXED", 42]) {
      expect(resolveSchedulerMode(bad)).toBe(SCHEDULER_DEFAULT_MODE);
    }
    expect(SCHEDULER_DEFAULT_MODE).toBe("shadow");
  });
});

describe("legacy evaluates every request and builds nothing", () => {
  it("returns the evaluated set with no shard retained", () => {
    const s = new RoutingScheduler();
    expect(run(s, { mode: "legacy" })).toEqual(["a", "c", "d"]);
    expect(run(s, { mode: "legacy" })).toEqual(["a", "c", "d"]);
    expect(s.shards.size).toBe(0);
    expect(s.stats.builds).toBe(0);
  });
});

describe("indexed serves the shard", () => {
  it("builds once, then hits", () => {
    const s = new RoutingScheduler();
    expect(run(s)).toEqual(["a", "c", "d"]);
    expect(run(s)).toEqual(["a", "c", "d"]);
    expect(s.stats.builds).toBe(1);
    expect(s.stats.hits).toBe(1);
  });

  it("hands out a copy, so a caller cannot corrupt the shard", () => {
    const s = new RoutingScheduler();
    const first = run(s);
    first.push("INTRUDER");
    expect(run(s)).toEqual(["a", "c", "d"]);
  });
});

describe("shadow serves legacy and counts disagreement", () => {
  it("returns the legacy answer even when the shard agrees", () => {
    const s = new RoutingScheduler();
    expect(run(s, { mode: "shadow" })).toEqual(["a", "c", "d"]);
    expect(s.mismatches.length).toBe(0);
    expect(s.stats.comparisons).toBe(1);
  });

  it("records a mismatch when the shard goes stale, and still serves legacy", () => {
    const s = new RoutingScheduler();
    run(s, { mode: "indexed" }); // build the shard for r1
    // r1's shard holds a,c,d. Now the predicate changes but the revision does NOT —
    // exactly the stale case a caller could hit if it forgot to bump the revision.
    const live = run(s, { mode: "shadow", evaluate: (e) => e === "a" });
    expect(live).toEqual(["a"]); // served legacy, not the stale shard
    expect(s.mismatches.length).toBe(1);
    expect(s.mismatches[0].legacy).toBe(1);
    expect(s.mismatches[0].indexed).toBe(3);
  });

  it("keeps the mismatch log bounded and identity-free", () => {
    const s = new RoutingScheduler();
    for (let i = 0; i < SCHEDULER_MISMATCH_LIMIT + 10; i++) {
      s.recordMismatch("m", "r", ["x", "y"], ["x"]);
    }
    expect(s.mismatches.length).toBe(SCHEDULER_MISMATCH_LIMIT);
    for (const row of s.mismatches) {
      // Counting only: no credential identity may appear in a diagnostic.
      expect(row.legacy).toBe(2);
      expect(row.indexed).toBe(1);
      expect(Object.keys(row.sample).sort()).toEqual(["extra", "missing"]);
    }
  });
});

describe("revisions key the cache", () => {
  it("a moved revision rebuilds rather than serving the old shard", () => {
    const s = new RoutingScheduler();
    run(s, { mode: "indexed", revisions: ["r1"] });
    const after = run(s, { mode: "indexed", revisions: ["r2"], evaluate: (e) => e === "d" });
    expect(after).toEqual(["d"]);
    expect(s.stats.builds).toBe(2);
    expect(s.shards.size).toBe(2);
  });
});

describe("the cache is bounded", () => {
  it("evicts the oldest key rather than growing without limit", () => {
    const s = new RoutingScheduler({ limit: 3 });
    for (const rev of ["r1", "r2", "r3", "r4"]) run(s, { mode: "indexed", revisions: [rev] });
    expect(s.shards.size).toBe(3);
    // r4 built last, so r1 was evicted; a repeat of r4 hits, a repeat of r1 rebuilds.
    const before = s.stats.builds;
    run(s, { mode: "indexed", revisions: ["r4"] });
    expect(s.stats.builds).toBe(before);
    run(s, { mode: "indexed", revisions: ["r1"] });
    expect(s.stats.builds).toBe(before + 1);
  });

  it("a throwing metric sink cannot break routing", () => {
    const s = new RoutingScheduler({ onMetric: () => { throw new Error("sink down"); } });
    expect(run(s)).toEqual(["a", "c", "d"]);
  });
});
