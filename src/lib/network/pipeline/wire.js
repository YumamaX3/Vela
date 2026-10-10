/**
 * pipeline/wire.js — connect the pipeline's seams to the real fleet.
 *
 * W8 (first half) of the proxy control-plane rebirth.
 *
 * The eight stages were built with injectable seams (`_setBreaker`,
 * `_setFitnessStore`, `_setDispatcher`, …) so they could be proven pure. This
 * module is where those seams are connected to the live modules. It is
 * deliberately a SINGLE file with a SINGLE exported `wirePipeline(deps)`
 * function: the caller supplies the real modules, so this file imports nothing
 * heavy and stays directly testable.
 *
 * The cutover law from the plan: `proxyAwareFetch` is untouched, and the
 * pipeline sits strictly above it. `buildProxyOptionsPayload` stays the ONE
 * payload builder; `resolveConnectionProxyConfig` stays the ONE resolver. This
 * file must never assemble `proxyOptions` itself.
 */

import {
  _setSsrfGate, _setRules, _setPoolIndex, _setBreaker,
  _setFitnessStore, _setDispatcher, _setRecorder,
  STAGE_NAMES,
} from "./stages.js";
import { runPipeline, clearPipelineCache } from "./runner.js";
import { halt } from "./stage.js";
import { recordRoute } from "./ledger.js";

/**
 * @param {object} deps
 * @param {(url:URL, providerId:string)=>{ok:boolean,reason?:string}} [deps.ssrfGate]
 * @param {()=>Array} [deps.getRules]         returns the proxyRules array
 * @param {()=>Map}  [deps.getPoolIndex]      poolId → pool row
 * @param {object}   [deps.breaker]           { isAvailable, recordFailure, recordSuccess, onRetryAfter }
 * @param {()=>Map}  [deps.getFitnessStore]   `${poolId}|${provider}` → row
 * @param {Function} [deps.dispatch]          async (ctx) => { ok, reason? }
 * @param {Function} [deps.record]            async (ctx) => void
 * @returns {{run:Function, names:string[]}}
 */
export function wirePipeline(deps = {}) {
  if (deps.ssrfGate) _setSsrfGate(deps.ssrfGate);
  if (deps.getRules) _setRules(deps.getRules());
  if (deps.getPoolIndex) _setPoolIndex(deps.getPoolIndex());
  if (deps.breaker) _setBreaker(deps.breaker);
  if (deps.getFitnessStore) _setFitnessStore(deps.getFitnessStore());
  if (deps.dispatch) _setDispatcher(deps.dispatch);
  if (deps.record) _setRecorder(deps.record);

  return {
    names: STAGE_NAMES,
    /**
     * Run the wired pipeline for one request.
     * @param {object} ctx RouteContext (see stage.js)
     * @returns {Promise<{poolId:string|null, halted:boolean, haltReason?:string, spans:object[]}>}
     */
    run: async (ctx) => {
      const out = await runPipeline(ctx, STAGE_NAMES);
      // W11 (F10) — every routed request lands in the ledger: sampled by
      // default (successes keep span names only), failures keep the walk.
      recordRoute({
        providerId: ctx.providerId,
        model: ctx.model,
        poolId: out.poolId,
        strategy: ctx.strategy,
        ok: out.halted ? false : out.poolId != null,
        haltReason: out.haltReason ?? null,
        ms: (ctx.spans ?? []).reduce((sum, s) => sum + (s?.ms ?? 0), 0),
        spans: out.spans,
        full: globalThis.__velaRouteLedgerFull === true,
      });
      return out;
    },
  };
}

/** Refresh the pool index / rules from live sources without re-wiring the
 *  whole pipeline. Called by the fleet sweep and by pool CRUD. */
export function refreshPipelineSeams(deps = {}) {
  if (deps.getRules) _setRules(deps.getRules());
  if (deps.getPoolIndex) _setPoolIndex(deps.getPoolIndex());
  if (deps.getFitnessStore) _setFitnessStore(deps.getFitnessStore());
}

/**
 * Build a RouteContext for the no-auth virtual lane — the caller that W5 wired
 * to `pick()`. This is the shape the cutover will hand to `run()`.
 */
export function buildRouteContext({ providerId, model, target, candidates, strategy, incumbentPoolId, affinityKey, strictProxy, budgetMs, hedge, hedgeDelayMs }) {
  return {
    providerId, model,
    target: target instanceof URL ? target : new URL(target),
    candidates: Array.isArray(candidates) ? [...candidates] : [],
    cursor: 0,
    poolId: null, pool: null, proxyOptions: null,
    strategy: strategy || "smart",
    incumbentPoolId: incumbentPoolId || null,
    affinityKey: affinityKey || "",
    strictProxy: Boolean(strictProxy),
    budgetMs: budgetMs || 45000,
    // W10 (F3) — hedged dialing: opt-in per request via the strategy policy.
    hedge: hedge === true,
    hedgeDelayMs: typeof hedgeDelayMs === "number" && hedgeDelayMs > 0 ? hedgeDelayMs : 150,
    spans: [],
    signals: null,
  };
}

/** Test-only: reset every seam back to its default (unwired) state. */
export function unwirePipeline() {
  _setSsrfGate(null); _setRules([]); _setPoolIndex(new Map());
  _setBreaker(null); _setFitnessStore(new Map());
  _setDispatcher(null); _setRecorder(null);
  clearPipelineCache();
}

export { halt };
