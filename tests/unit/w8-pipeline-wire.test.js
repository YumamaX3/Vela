/**
 * W8 — the pipeline integration layer, proven.
 *
 * W8's first half wires the pipeline's injectable seams to the real fleet.
 * This suite proves the wire layer hands a request through all eight stages
 * and returns the pool the draw chose — the exact behavior W7's dispatch
 * defect had broken.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  wirePipeline, refreshPipelineSeams, buildRouteContext, unwirePipeline,
} from "../../src/lib/network/pipeline/wire.js";

beforeEach(() => { unwirePipeline(); });

describe("W8 · wirePipeline end-to-end", () => {
  it("routes a request through all eight stages and returns the drawn pool", async () => {
    const wired = wirePipeline({
      getRules: () => [],
      getPoolIndex: () => new Map([["pool-a", {}], ["pool-b", {}]]),
      breaker: { isAvailable: () => true },
      getFitnessStore: () => new Map(),
      dispatch: async (c) => ({ ok: true, poolId: c.poolId }),
      record: async () => {},
    });

    const ctx = buildRouteContext({
      providerId: "anthropic",
      model: "claude-sonnet-4",
      target: "https://api.anthropic.com/v1/messages",
      candidates: ["pool-a", "pool-b"],
      strategy: "smart",
    });

    const out = await wired.run(ctx);
    expect(out.halted).toBe(false);
    expect(["pool-a", "pool-b"]).toContain(out.poolId);
    // All eight spans present — the chain actually ran.
    expect(out.spans.map((s) => s.stage)).toEqual([
      "egress-fence", "rule-resolve", "group-select", "health-filter",
      "weighted-draw", "affinity-check", "dispatch", "outcome-record",
    ]);
  });

  it("buildRouteContext normalizes a string target into a URL", () => {
    const ctx = buildRouteContext({
      providerId: "p", model: "m", target: "https://example.com/x",
      candidates: ["a"],
    });
    expect(ctx.target).toBeInstanceOf(URL);
    expect(ctx.target.hostname).toBe("example.com");
    expect(ctx.budgetMs).toBe(45000);
    expect(ctx.strictProxy).toBe(false);
  });

  it("an SSRF refusal halts before any dispatch", async () => {
    let dispatched = false;
    const wired = wirePipeline({
      ssrfGate: () => ({ ok: false, reason: "private address" }),
      dispatch: async () => { dispatched = true; return { ok: true }; },
    });
    const out = await wired.run(buildRouteContext({
      providerId: "p", model: "m", target: "https://127.0.0.1/x", candidates: ["a"],
    }));
    expect(out.halted).toBe(true);
    expect(out.haltReason).toMatch(/ssrf/);
    expect(dispatched).toBe(false); // the fence held
  });

  it("refreshPipelineSeams swaps the pool index without re-wiring", async () => {
    const wired = wirePipeline({
      getPoolIndex: () => new Map([["pool-a", {}], ["pool-b", {}]]),
      dispatch: async (c) => ({ ok: true, poolId: c.poolId }),
    });
    refreshPipelineSeams({ getPoolIndex: () => new Map([["pool-b", {}]]) });
    const out = await wired.run(buildRouteContext({
      providerId: "p", model: "m", target: "https://example.com",
      candidates: ["pool-a", "pool-b"],
    }));
    // pool-a was dropped from the index, so only pool-b survives.
    expect(out.poolId).toBe("pool-b");
  });

  it("unwirePipeline returns every seam to its default", async () => {
    wirePipeline({ dispatch: async () => ({ ok: true }) });
    unwirePipeline();
    const fresh = wirePipeline({});
    const out = await fresh.run(buildRouteContext({
      providerId: "p", model: "m", target: "https://example.com", candidates: ["a"],
    }));
    expect(out.halted).toBe(true);
    expect(out.haltReason).toMatch(/no dispatcher/);
  });
});

describe("W8 · runSelection — the synchronous selection face", () => {
  it("returns the drawn pool synchronously, skipping the I/O stages", async () => {
    const { runSelection } = await import("../../src/lib/network/pipeline/runner.js");
    const wired = wirePipeline({
      getFitnessStore: () => new Map(),
      dispatch: async () => { throw new Error("dispatch must NOT run in selection"); },
      record: async () => { throw new Error("outcome-record must NOT run in selection"); },
    });
    const ctx = buildRouteContext({
      providerId: "p", model: "m", target: "https://example.com",
      candidates: ["pool-a", "pool-b"], strategy: "smart",
    });
    const chosen = runSelection(ctx, wired.names);
    expect(["pool-a", "pool-b"]).toContain(chosen);
    // Only the five sync selection stages ran — no dispatch, no outcome-record.
    expect(ctx.spans.map((s) => s.stage)).toEqual([
      "egress-fence", "rule-resolve", "group-select", "health-filter",
      "weighted-draw", "affinity-check",
    ]);
  });

  it("a critical stage throw returns null — the fence never fails open", async () => {
    const { runSelection } = await import("../../src/lib/network/pipeline/runner.js");
    const wired = wirePipeline({ ssrfGate: () => ({ ok: false, reason: "private" }) });
    const ctx = buildRouteContext({
      providerId: "p", model: "m", target: "https://127.0.0.1/x", candidates: ["a"],
    });
    expect(runSelection(ctx, wired.names)).toBeNull();
  });

  it("a breaker throw is absorbed by the stage and the chain continues", async () => {
    const { runSelection } = await import("../../src/lib/network/pipeline/runner.js");
    const wired = wirePipeline({
      breaker: { isAvailable: () => { throw new Error("breaker exploded"); } },
    });
    const ctx = buildRouteContext({
      providerId: "p", model: "m", target: "https://example.com", candidates: ["only"],
    });
    const chosen = runSelection(ctx, wired.names);
    expect(chosen).toBe("only"); // fail-open, NOT "pool dead"
    // health-filter absorbs the throw INTERNALLY and keeps the candidate, so
    // the span reads 'ok' — the stage's own guard is the first line of defence
    // and the runner's fail-open is the second. Nothing was dropped.
    const filter = ctx.spans.find((s) => s.stage === "health-filter");
    expect(filter.decision).toBe("ok");
    expect(ctx.dropped).toEqual([]);
  });
});
