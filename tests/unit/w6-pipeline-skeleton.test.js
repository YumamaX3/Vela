/**
 * W6 — the pipeline skeleton, proven.
 *
 * Ships dark: nothing routes through the pipeline yet. This suite proves the
 * three contracts the later waves depend on — the stage interface, the
 * compile-time order validator, and the runner's fail-open law.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { defineStage, halt, isHalt, makeSpan } from "../../src/lib/network/pipeline/stage.js";
import { registerStage, compilePipeline, clearRegistry, listStages } from "../../src/lib/network/pipeline/registry.js";
import { runPipeline, clearPipelineCache } from "../../src/lib/network/pipeline/runner.js";

function ctx(over = {}) {
  return { providerId: "p", model: "m", target: new URL("https://example.com"), candidates: [], cursor: 0, poolId: null, pool: null, proxyOptions: null, affinityKey: "", budgetMs: 45000, spans: [], signals: null, ...over };
}

beforeEach(() => { clearRegistry(); clearPipelineCache(); });

describe("W6 · stage contract", () => {
  it("halt is branded and detectable, never null", () => {
    const h = halt("nope", "refuse");
    expect(isHalt(h)).toBe(true);
    expect(isHalt(null)).toBe(false);
    expect(isHalt(undefined)).toBe(false);
    expect(isHalt({})).toBe(false);
    expect(h.ok).toBe(false);
    expect(h.kind).toBe("refuse");
  });

  it("rejects an unknown kind and a missing fn", () => {
    expect(() => defineStage({ name: "x", kind: "nonsense", fn: () => {} })).toThrow(/unknown kind/);
    expect(() => defineStage({ name: "x", kind: "gate" })).toThrow(/requires fn/);
    expect(() => defineStage({ kind: "gate", fn: () => {} })).toThrow(/requires a name/);
  });

  it("spans are plain mutable records with no nested allocation", () => {
    const s = makeSpan();
    expect(s).toEqual({ stage: "", kind: "", ms: 0, decision: "", detail: "" });
    s.decision = "throw";
    expect(s.decision).toBe("throw");
  });
});

describe("W6 · compile-time order validation", () => {
  beforeEach(() => {
    registerStage(defineStage({ name: "a-gate", kind: "gate", sync: true, fn: (c) => c }));
    registerStage(defineStage({ name: "b-filter", kind: "filter", sync: true, fn: (c) => c }));
    registerStage(defineStage({ name: "c-draw", kind: "draw", sync: true, fn: (c) => c }));
    registerStage(defineStage({ name: "d-route", kind: "route", fn: async (c) => c }));
    registerStage(defineStage({ name: "e-terminal", kind: "terminal", fn: async (c) => c }));
  });

  it("accepts a legal order", () => {
    const p = compilePipeline(["a-gate", "b-filter", "c-draw", "d-route", "e-terminal"]);
    expect(p.stages).toHaveLength(5);
  });

  it("refuses two route stages", () => {
    expect(() => compilePipeline(["d-route", "d-route"])).toThrow(/two route stages/);
  });

  it("refuses two terminal stages", () => {
    expect(() => compilePipeline(["e-terminal", "e-terminal"])).toThrow(/two terminal stages/);
  });

  it("refuses a filter after a route", () => {
    expect(() => compilePipeline(["d-route", "b-filter"])).toThrow(/may not follow/);
  });

  it("refuses a draw after a terminal", () => {
    expect(() => compilePipeline(["e-terminal", "c-draw"])).toThrow(/may not follow/);
  });

  it("refuses an unregistered name, and lists what IS registered", () => {
    expect(() => compilePipeline(["a-gate", "ghost"])).toThrow(/unknown stage "ghost"/);
    expect(() => compilePipeline(["a-gate", "ghost"])).toThrow(/a-gate/);
    expect(listStages()).toContain("a-gate");
  });
});

describe("W6 · the runner's fail-open law", () => {
  beforeEach(() => {
    registerStage(defineStage({ name: "thrower", kind: "filter", sync: true, fn: () => { throw new Error("boom"); } }));
    registerStage(defineStage({ name: "setter", kind: "draw", sync: true, fn: (c) => { c.poolId = "pool-1"; return c; } }));
    registerStage(defineStage({ name: "crit", kind: "gate", sync: true, critical: true, fn: () => { throw new Error("fence down"); } }));
    registerStage(defineStage({ name: "halter", kind: "resolve", sync: true, fn: () => halt("stop here", "direct") }));
  });

  it("a non-critical throw is stamped and the pipeline CONTINUES", async () => {
    const out = await runPipeline(ctx(), ["thrower", "setter"]);
    // The throw did not become a verdict — the later stage still ran.
    expect(out.poolId).toBe("pool-1");
    expect(out.halted).toBe(false);
    const t = out.spans.find((s) => s.stage === "thrower");
    expect(t.decision).toBe("throw");
    expect(t.detail).toBe("boom");
  });

  it("a critical throw HALTS — the fence never fails open", async () => {
    const out = await runPipeline(ctx(), ["crit", "setter"]);
    expect(out.halted).toBe(true);
    expect(out.haltReason).toBe("fence down");
    expect(out.poolId).toBeNull();
    // The later stage must NOT have run.
    expect(out.spans.some((s) => s.stage === "setter")).toBe(false);
  });

  it("a branded halt short-circuits with the context as it stood", async () => {
    const out = await runPipeline(ctx(), ["setter", "halter"]);
    expect(out.halted).toBe(true);
    expect(out.haltReason).toBe("stop here");
    expect(out.poolId).toBe("pool-1"); // set before the halt
  });

  it("memoizes the compile — the same names hit the cache", async () => {
    await runPipeline(ctx(), ["thrower", "setter"]);
    const before = listStages().length;
    clearRegistry();
    // Registry is empty, but the compiled pipeline is cached, so this still runs.
    const out = await runPipeline(ctx(), ["thrower", "setter"]);
    expect(out.poolId).toBe("pool-1");
    expect(listStages()).toHaveLength(before - 4);
    clearPipelineCache();
  });
});
