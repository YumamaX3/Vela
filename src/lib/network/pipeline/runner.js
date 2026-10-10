/**
 * pipeline/runner.js — the execution loop.
 *
 * W6 of the proxy control-plane rebirth.
 *
 * THE LAW: fail-open belongs to the runner, not to each stage. The old code let
 * a ReferenceError inside proxyFleet.js become {ok:false}, which the sweep read
 * as "pool dead" — the fleet self-liquidation, where the fleet disabled its own
 * healthy pools because a typo threw. Here a stage's throw is caught, stamped
 * into the span with decision='throw', and the pipeline CONTINUES with the
 * context as it stood. A stage physically cannot misreport itself as a verdict.
 *
 * The one exception is `critical: true` (the egress fence): a throw there HALTS
 * the request, because a security stage must never inherit the availability
 * stage's fail posture.
 */

import { isHalt, makeSpan } from "./stage.js";
import { compilePipeline } from "./registry.js";

const CACHE_KEY = "__velaRoutePipelineCache";
const cache = (globalThis[CACHE_KEY] ??= new Map());

/** Memoized compile — the hot path pays one Map lookup, never a re-validate. */
function getCompiled(names) {
  const key = names.join(">");
  let hit = cache.get(key);
  if (!hit) {
    hit = compilePipeline(names);
    cache.set(key, hit);
  }
  return hit;
}

/** Test-only: drop the compile cache. */
export function clearPipelineCache() {
  cache.clear();
}

/**
 * W8 — the SYNCHRONOUS selection entry.
 *
 * `pick()` in proxyFleet.js is sync and is called from a sync switch on the
 * hot path; making it async would change every caller's signature. So the
 * pipeline gets a sync face that runs ONLY the selection stages — the ones
 * declared `sync: true` — and returns the chosen poolId (or null).
 *
 * Egress is untouched: dispatch and outcome-record are deliberately excluded,
 * because they perform I/O and because `buildProxyOptionsPayload` stays the ONE
 * payload builder and `proxyAwareFetch` stays the ONE fetch.
 *
 * The law is unchanged: a stage throw is stamped and the chain CONTINUES, so a
 * broken stage can never read as "pool dead". A `critical` stage's throw
 * returns null, which the caller reads as "no selection" and falls back.
 *
 * @param {object} ctx RouteContext
 * @param {string[]} names ordered stage names
 * @returns {string|null} the chosen poolId, or null if nothing was chosen
 */
export function runSelection(ctx, names) {
  const { stages } = getCompiled(names);
  ctx.spans ??= [];
  ctx.cursor ??= 0;
  for (const stage of stages) {
    if (!stage.sync) continue; // selection only — no I/O stages
    const span = makeSpan();
    span.stage = stage.name;
    span.kind = stage.kind;
    const t0 = process.hrtime.bigint();
    let result;
    try {
      result = stage.fn(ctx);
    } catch (err) {
      span.ms = Number(process.hrtime.bigint() - t0) / 1e6;
      span.decision = "throw";
      span.detail = err && err.message ? err.message : String(err);
      ctx.spans.push(span);
      if (stage.critical) return null; // the fence never fails open
      continue;
    }
    span.ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (isHalt(result)) {
      span.decision = "halt";
      span.detail = result.reason;
      ctx.spans.push(span);
      return ctx.poolId ?? null;
    }
    span.decision = "ok";
    ctx.spans.push(span);
    if (result && typeof result === "object") ctx = result;
  }
  return ctx.poolId ?? null;
}

/**
 * Run a compiled pipeline over a route context.
 * @param {object} ctx RouteContext (see stage.js)
 * @param {string[]} [names] ordered stage names; default is the caller's
 *        responsibility to pass providerStrategies[providerId].pipeline
 * @returns {Promise<{poolId:string|null, proxyOptions:object|null, halted:boolean, spans:object[]}>}
 */
export async function runPipeline(ctx, names) {
  const { stages } = getCompiled(names);
  ctx.spans ??= [];
  ctx.cursor ??= 0;

  for (const stage of stages) {
    const span = makeSpan();
    span.stage = stage.name;
    span.kind = stage.kind;
    const t0 = process.hrtime.bigint();

    let result;
    try {
      result = stage.sync ? stage.fn(ctx) : await stage.fn(ctx);
    } catch (err) {
      span.ms = Number(process.hrtime.bigint() - t0) / 1e6;
      span.decision = "throw";
      span.detail = err && err.message ? err.message : String(err);
      ctx.spans.push(span);
      // A critical stage (the security fence) halts; everything else continues
      // with the context exactly as it stood.
      if (stage.critical) {
        return { poolId: null, proxyOptions: null, halted: true, haltReason: err.message, spans: ctx.spans };
      }
      continue;
    }

    span.ms = Number(process.hrtime.bigint() - t0) / 1e6;

    if (isHalt(result)) {
      span.decision = "halt";
      span.detail = result.reason;
      ctx.spans.push(span);
      return { poolId: ctx.poolId ?? null, proxyOptions: ctx.proxyOptions ?? null, halted: true, haltReason: result.reason, spans: ctx.spans };
    }

    span.decision = "ok";
    ctx.spans.push(span);
    // A stage may return a (possibly mutated) context; adopt it.
    if (result && typeof result === "object") ctx = result;
  }

  return { poolId: ctx.poolId ?? null, proxyOptions: ctx.proxyOptions ?? null, halted: false, spans: ctx.spans };
}
