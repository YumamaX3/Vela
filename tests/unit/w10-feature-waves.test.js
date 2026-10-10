/**
 * W10 · the feature waves — rules data, pooling knobs, hedged dispatch.
 *
 * Each feature carries its own sealing criterion (the plan's wave law):
 *
 *   F1 rules data     — settings.proxyRoutingRules feeds the rule-resolve
 *                       stage via the fleet snapshot; FIRST match pins the
 *                       candidate set. Sealed by: a matching rule narrows,
 *                       a disabled/missing rule never touches the route.
 *   F9 pooling knobs  — pool-row `pooling` flows through buildProxyOptionsPayload
 *                       (the ONE builder) into the dispatcher cache. Sealed by:
 *                       in-range knobs pass; out-of-range are DROPPED, never
 *                       clamped into range; the cache key splits on knobs.
 *   F3 hedged dialing — ctx.hedge races the primary against the next
 *                       candidate after hedgeDelayMs; first ok wins. Sealed by:
 *                       the hedge winner surfaces when the primary is slow,
 *                       and the sequential path is untouched when hedge is off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "C:/Users/navis/Documents/My Project/Ai Gateway/Vela";
const mod = (rel) => pathToFileURL(join(REPO, rel)).href;
let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vela-w10-"));
  globalThis.__velaProxyFleetState = { fitnessStore: new Map(), dirtyKeys: new Set(), proxyRoutingRules: [] };
  globalThis.__velaCircuitBreakerState = { store: new Map(), dirtyKeys: new Set(), flushTimer: null, flushArmed: false };
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.__velaProxyFleetState;
  delete globalThis.__velaCircuitBreakerState;
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
});

describe("W10 · F1 — rules data", () => {
  it("a matching rule pins the candidate set; a disabled rule never matches", async () => {
    const stages = await import(mod("src/lib/network/pipeline/stages.js"));
    const runner = await import(mod("src/lib/network/pipeline/runner.js"));
    const wire = await import(mod("src/lib/network/pipeline/wire.js"));
    stages._setRules([
      { id: "r-disabled", enabled: false, match: { provider: "prov" }, action: { poolId: "pool-nope" } },
      { id: "r-live", enabled: true, match: { provider: "prov", modelPrefix: "gpt" }, action: { poolIds: ["rule-a", "rule-b"] } },
    ]);
    stages._setBreaker({ isAvailable: () => true });
    stages._setFitnessStore(new Map());
    stages._setPoolIndex(new Map());
    await stubDispatcherNow(async (c) => ({ ok: true, poolId: c.poolId }));

    const ctx = wire.buildRouteContext({
      providerId: "prov", model: "gpt-4o", target: "https://api.example.com/v1",
      candidates: ["plain-a", "plain-b"], strategy: "smart",
      // The rule pins the CANDIDATE set; the draw still picks among it. The
      // incumbent pin makes the DRAW deterministic so the assertion tests the
      // rule, not the RNG.
      incumbentPoolId: "rule-a",
    });
    const out = await runner.runPipeline(ctx, stages.STAGE_NAMES);
    expect(["rule-a", "rule-b"]).toContain(out.poolId); // the rule's set, not the plain candidates
    expect(out.poolId).not.toBe("plain-a");
    expect(out.poolId).not.toBe("plain-b");
  });

  it("no matching rule leaves the candidate set untouched", async () => {
    const stages = await import(mod("src/lib/network/pipeline/stages.js"));
    const runner = await import(mod("src/lib/network/pipeline/runner.js"));
    const wire = await import(mod("src/lib/network/pipeline/wire.js"));
    stages._setRules([{ id: "r1", match: { provider: "other" }, action: { poolId: "x" } }]);
    stages._setBreaker({ isAvailable: () => true });
    stages._setFitnessStore(new Map());
    stages._setPoolIndex(new Map());
    await stubDispatcherNow(async (c) => ({ ok: true, poolId: c.poolId }));
    const ctx = wire.buildRouteContext({
      providerId: "prov", model: "m", target: "https://api.example.com/",
      candidates: ["plain-a", "plain-b"], strategy: "smart",
    });
    const out = await runner.runPipeline(ctx, stages.STAGE_NAMES);
    expect(["plain-a", "plain-b"]).toContain(out.poolId);
  });
});

describe("W10 · F9 — pooling knobs through the ONE builder", () => {
  it("in-range knobs survive the builder; out-of-range are DROPPED, never clamped", async () => {
    const { buildProxyOptionsPayload } = await import(mod("src/lib/network/connectionProxy.js"));
    const out = buildProxyOptionsPayload({
      connectionProxyEnabled: true,
      proxyPool: { pooling: { connections: 32, keepAliveTimeout: 4000, keepAliveMaxTimeout: 999_999_999 } },
    });
    expect(out.pooling).toEqual({ connections: 32, keepAliveTimeout: 4000 }); // maxTimeout dropped (over ceiling)
    const zeroed = buildProxyOptionsPayload({
      connectionProxyEnabled: true,
      proxyPool: { pooling: { connections: 0 } }, // 0 is not > 0 — dropped
    });
    expect(zeroed.pooling).toBeUndefined();
    const absent = buildProxyOptionsPayload({ connectionProxyEnabled: true });
    expect(absent.pooling).toBeUndefined();
  });
});

describe("W10 · F3 — hedged dispatch", () => {
  it("the hedge winner surfaces when the primary is slower than hedgeDelayMs", async () => {
    const stages = await import(mod("src/lib/network/pipeline/stages.js"));
    const runner = await import(mod("src/lib/network/pipeline/runner.js"));
    const wire = await import(mod("src/lib/network/pipeline/wire.js"));
    stages._setRules([]);
    stages._setBreaker({ isAvailable: () => true });
    stages._setFitnessStore(new Map());
    stages._setPoolIndex(new Map());
    // Primary sleeps past the hedge delay and answers for pool-primary;
    // the hedge answers instantly for pool-hedge → the hedge must win.
    await stubDispatcherNow(async (c) => {
      if (c.poolId === "pool-primary") {
        await new Promise((r) => setTimeout(r, 120));
        return { ok: true, poolId: "pool-primary" };
      }
      return { ok: true, poolId: c.poolId };
    });
    const ctx = wire.buildRouteContext({
      providerId: "prov", model: "m", target: "https://api.example.com/",
      candidates: ["pool-primary", "pool-hedge"], strategy: "smart",
      incumbentPoolId: "pool-primary", // hysteresis pins the draw → primary first
      hedge: true, hedgeDelayMs: 20,
    });
    const out = await runner.runPipeline(ctx, stages.STAGE_NAMES);
    expect(out.poolId).toBe("pool-hedge");
    expect(ctx.hedgedWinner).toBe(true);
  });

  it("hedge off — the sequential path is untouched", async () => {
    const stages = await import(mod("src/lib/network/pipeline/stages.js"));
    const runner = await import(mod("src/lib/network/pipeline/runner.js"));
    const wire = await import(mod("src/lib/network/pipeline/wire.js"));
    stages._setRules([]);
    stages._setBreaker({ isAvailable: () => true });
    stages._setFitnessStore(new Map());
    stages._setPoolIndex(new Map());
    await stubDispatcherNow(async (c) => ({ ok: true, poolId: c.poolId }));
    const ctx = wire.buildRouteContext({
      providerId: "prov", model: "m", target: "https://api.example.com/",
      candidates: ["p1", "p2"], strategy: "smart",
      incumbentPoolId: "p1", // deterministic: hysteresis pins p1
    });
    const out = await runner.runPipeline(ctx, stages.STAGE_NAMES);
    expect(out.poolId).toBe("p1");
    expect(ctx.hedgedWinner).toBeUndefined();
  });
});

// ── dispatcher stub plumbing (module-level seam) ──────────────────────────
async function stubDispatcherNow(fn) {
  const stages = await import(mod("src/lib/network/pipeline/stages.js"));
  stages._setDispatcher(fn);
}
