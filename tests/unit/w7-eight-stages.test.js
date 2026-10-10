/**
 * W7 — the eight stages, proven.
 *
 * The no-config law: with nothing configured, every stage passes through
 * byte-identically. That is what makes W8's cutover safe.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearRegistry, listStages } from "../../src/lib/network/pipeline/registry.js";
import { runPipeline, clearPipelineCache } from "../../src/lib/network/pipeline/runner.js";
import {
  STAGE_NAMES, _setSsrfGate, _setRules, _setPoolIndex, _setBreaker,
  _setFitnessStore, _setDispatcher, _setRecorder,
} from "../../src/lib/network/pipeline/stages.js";

function ctx(over = {}) {
  return {
    providerId: "anthropic", model: "claude-sonnet-4",
    target: new URL("https://api.anthropic.com/v1/messages"),
    candidates: ["pool-a", "pool-b", "pool-c"], cursor: 0,
    poolId: null, pool: null, proxyOptions: null,
    affinityKey: "", budgetMs: 45000, spans: [], signals: null,
    ...over,
  };
}

// Importing stages.js registers all eight at module load. The registry is
// deliberately NOT cleared between tests — the stages are the subject, and
// clearing them would destroy it. Only the seams and the compile cache reset.
const stagesModule = await import("../../src/lib/network/pipeline/stages.js");

beforeEach(() => {
  clearPipelineCache();
  _setSsrfGate(null); _setRules([]); _setPoolIndex(new Map());
  _setBreaker(null); _setFitnessStore(new Map());
  _setDispatcher(null); _setRecorder(null);
});

describe("W7 · registration and order", () => {
  it("registers exactly the eight default stages", () => {
    expect(STAGE_NAMES).toHaveLength(8);
    for (const n of STAGE_NAMES) expect(listStages()).toContain(n);
  });
});

describe("W7 · the no-config pass-through law", () => {
  it("with nothing configured, the chain runs and halts at dispatch", async () => {
    const c = ctx();
    const out = await runPipeline(c, STAGE_NAMES);
    // No dispatcher wired → dispatch halts with 'refuse'. Everything before it
    // passed through untouched: the candidate set is unchanged.
    expect(out.halted).toBe(true);
    expect(out.haltReason).toMatch(/no dispatcher/);
    expect(c.candidates).toEqual(["pool-a", "pool-b", "pool-c"]);
  });

  it("egress-fence halts on an SSRF refusal, and the fence is CRITICAL", async () => {
    _setSsrfGate(() => ({ ok: false, reason: "private address" }));
    const out = await runPipeline(ctx(), STAGE_NAMES);
    expect(out.halted).toBe(true);
    expect(out.haltReason).toMatch(/ssrf: private address/);
    // Critical → the request halted, not continued.
    const fence = out.spans.find((s) => s.stage === "egress-fence");
    expect(fence.decision).toBe("halt");
  });
});

describe("W7 · rule-resolve", () => {
  it("first match pins a single pool", async () => {
    _setRules([
      { id: "r1", match: { hostSuffix: "anthropic.com" }, action: { poolId: "pool-pinned" } },
      { id: "r2", match: { hostSuffix: "openai.com" }, action: { poolId: "pool-other" } },
    ]);
    _setDispatcher(async (c) => ({ ok: true, poolId: c.poolId }));
    const out = await runPipeline(ctx(), STAGE_NAMES);
    expect(out.poolId).toBe("pool-pinned");
  });

  it("no rules → pass-through, byte-identical", async () => {
    _setDispatcher(async (c) => ({ ok: true, poolId: c.poolId }));
    const c = ctx();
    await runPipeline(c, STAGE_NAMES);
    expect(c.candidates).toEqual(["pool-a", "pool-b", "pool-c"]);
  });
});

describe("W7 · health-filter — the three-verdict law", () => {
  it("a breaker-cooled pool is dropped, and the rest survive", async () => {
    _setBreaker({ isAvailable: (id) => id !== "pool-b" });
    _setDispatcher(async (c) => ({ ok: true, poolId: c.poolId }));
    const c = ctx();
    await runPipeline(c, STAGE_NAMES);
    expect(c.dropped).toEqual(["pool-b"]);
    expect(c.candidates).toEqual(["pool-a", "pool-c"]);
  });

  it("a breaker THROW is fail-open — it must not read as 'pool dead'", async () => {
    _setBreaker({ isAvailable: () => { throw new Error("breaker exploded"); } });
    _setDispatcher(async (c) => ({ ok: true, poolId: c.poolId }));
    const c = ctx();
    const out = await runPipeline(c, STAGE_NAMES);
    // Nothing was dropped, and a pool was still chosen.
    expect(c.dropped).toEqual([]);
    expect(out.poolId).not.toBeNull();
  });
});

describe("W7 · weighted-draw and hysteresis", () => {
  it("a single candidate is chosen without a draw", async () => {
    _setDispatcher(async (c) => ({ ok: true, poolId: c.poolId }));
    const out = await runPipeline(ctx({ candidates: ["only"] }), STAGE_NAMES);
    expect(out.poolId).toBe("only");
  });

  it("the incumbent loses when a challenger vastly exceeds it", async () => {
    // pool-a is the incumbent with a mediocre weight; pool-b is far better.
    _setFitnessStore(new Map([
      ["pool-a|", { successCount: 5, failureCount: 5, latencyEwmaMs: 1000, lastOutcomeAt: new Date().toISOString() }],
      ["pool-b|", { successCount: 100, failureCount: 0, latencyEwmaMs: 100, lastOutcomeAt: new Date().toISOString() }],
    ]));
    _setDispatcher(async (c) => ({ ok: true, poolId: c.poolId }));
    // The draw is random, so the assertion is pinned by fixing the draw point
    // near the top of the total weight — which lands on pool-b and proves the
    // hysteresis guard did NOT pin the incumbent.
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const out = await runPipeline(
        ctx({ incumbentPoolId: "pool-a", candidates: ["pool-a", "pool-b"] }),
        STAGE_NAMES
      );
      expect(out.poolId).toBe("pool-b");
    } finally {
      spy.mockRestore();
    }
  });

  it("a near-equal challenger does NOT displace the incumbent (no thrash)", async () => {
    const now = new Date().toISOString();
    _setFitnessStore(new Map([
      ["pool-a|", { successCount: 50, failureCount: 0, latencyEwmaMs: 200, lastOutcomeAt: now }],
      ["pool-b|", { successCount: 50, failureCount: 0, latencyEwmaMs: 205, lastOutcomeAt: now }],
    ]));
    _setDispatcher(async (c) => ({ ok: true, poolId: c.poolId }));
    const out = await runPipeline(
      ctx({ incumbentPoolId: "pool-a", candidates: ["pool-a", "pool-b"] }),
      STAGE_NAMES
    );
    expect(out.poolId).toBe("pool-a");
  });
});

describe("W7 · affinity-check — stateless consistent hashing", () => {
  it("the same key always maps to the same pool", async () => {
    _setDispatcher(async (c) => ({ ok: true, poolId: c.poolId }));
    const first = await runPipeline(ctx({ affinityKey: "session-xyz" }), STAGE_NAMES);
    const second = await runPipeline(ctx({ affinityKey: "session-xyz" }), STAGE_NAMES);
    expect(first.poolId).toBe(second.poolId);
    expect(["pool-a", "pool-b", "pool-c"]).toContain(first.poolId);
  });

  it("no affinity key → the draw still runs", async () => {
    _setDispatcher(async (c) => ({ ok: true, poolId: c.poolId }));
    const out = await runPipeline(ctx({ affinityKey: "" }), STAGE_NAMES);
    expect(out.poolId).not.toBeNull();
  });
});

describe("W7 · dispatch and outcome-record", () => {
  it("a strictProxy failure refuses rather than retrying", async () => {
    _setDispatcher(async () => ({ ok: false, reason: "socks5 refused" }));
    const out = await runPipeline(ctx({ strictProxy: true, candidates: ["pool-a"] }), STAGE_NAMES);
    expect(out.halted).toBe(true);
    expect(out.haltReason).toMatch(/dispatch refused/);
  });

  it("outcome-record runs and never throws even if the recorder explodes", async () => {
    _setDispatcher(async (c) => ({ ok: true, poolId: c.poolId }));
    _setRecorder(() => { throw new Error("recorder down"); });
    const out = await runPipeline(ctx({ candidates: ["pool-a"] }), STAGE_NAMES);
    expect(out.halted).toBe(false);
    expect(out.poolId).toBe("pool-a");
  });
});
