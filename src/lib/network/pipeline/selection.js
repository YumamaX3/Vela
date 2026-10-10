/**
 * pipeline/selection.js — the ONE pool-selection entry for the live path.
 *
 * W8 (second half) of the proxy control-plane rebirth — the cutover itself.
 *
 * This module is what `pick`, `pickSmart`, `pickRoundRobin`, and `repick` were
 * before the cutover, collapsed into a single truth:
 *
 *  - `pickPool(candidates, policy)` — the synchronous selection entry. Syncs
 *    the fleet's live fitness + breaker state into the pipeline seams, runs
 *    the selection stages (`runSelection`), and returns the chosen poolId.
 *  - `repickPool(model, excludePoolIds, opts)` — the bounded re-pick loop,
 *    re-expressed over the same selection entry (the pipeline's dispatch
 *    stage owns per-request retry; this serves the executor's recovery path,
 *    which re-picks ACROSS a fresh candidate set after a claim refusal).
 *
 * The seams sync on EVERY call — deliberately. The fleet's fitness store is
 * anchored on globalThis and mutated by recordOutcome on the hot path; a
 * wire-once snapshot would select on stale weights forever. The sync is two
 * Map copies over a few rows — nanoseconds against a 45s request budget.
 *
 * Fail-open law (the runner's, inherited): a selection that throws or chooses
 * nothing returns null, and the CALLER decides the fallback (first candidate,
 * abort, or account rotation) — never this module. The pre-cutover pick()
 * answered poolIds[0] on failure; that policy lives with the caller now,
 * stated where it can be read.
 *
 * Egress is untouched: selection stages only — `proxyAwareFetch` stays the
 * ONE fetch and `buildProxyOptionsPayload` stays the ONE payload builder.
 */
import { getProxyPools } from "../../db/repos/proxyPoolsRepo.js";
import { resolveConnectionProxyConfig } from "../connectionProxy.js";
import { isAvailable } from "../circuitBreaker.js";
import {
  STAGE_NAMES, _setBreaker, _setFitnessStore,
  _setRules, _setPoolIndex,
} from "./stages.js";
import { runSelection } from "./runner.js";
import { buildRouteContext } from "./wire.js";

/**
 * Sync the live fleet state into the pipeline seams. Called on every
 * selection — see the module header for why this is per-call, not wire-once.
 */
function syncSeams() {
  try {
    const store = new Map();
    // W9 fidelity fix: read the fleet's FULL fitness rows from the globalThis
    // anchor (the same Map loadFitness refills), not the getFitnessSummary
    // projection — the projection drops latencyEwmaMs, and a draw without the
    // latency signal weights a 5s pool equal to a 100ms one. The fleet's
    // rows are per-provider; selection reads the pool-pair grain (provider
    // ''), aggregating provider rows by SUMMING counts and EWMA-blending —
    // the same pooling getOrCreateFitness does per provider. Simplest honest
    // grain: prefer the '' provider row when present, else aggregate.
    const anchor = globalThis.__velaProxyFleetState;
    const source = anchor?.fitnessStore ?? new Map();
    const byPool = new Map();
    for (const [key, row] of source) {
      const poolId = key.split("|")[0];
      const provider = key.split("|")[1] ?? "";
      const cur = byPool.get(poolId);
      if (!cur) { byPool.set(poolId, { ...row, provider: "" }); continue; }
      if (provider === "" ) { byPool.set(poolId, { ...row, provider: "" }); continue; }
      if (cur.provider === "" && cur._explicitEmpty) { /* keep '' row */ continue; }
      // aggregate: sum counts, successEwma weighted by outcomes, latency EWMA weighted
      const tA = (cur.successCount||0)+(cur.failureCount||0);
      const tB = (row.successCount||0)+(row.failureCount||0);
      const total = tA + tB || 1;
      byPool.set(poolId, {
        ...cur,
        successCount: (cur.successCount||0) + (row.successCount||0),
        failureCount: (cur.failureCount||0) + (row.failureCount||0),
        successEwma: ((cur.successEwma||0.5)*tA + (row.successEwma||0.5)*tB) / total,
        latencyEwmaMs: ((cur.latencyEwmaMs||1000)*tA + (row.latencyEwmaMs||1000)*tB) / total,
        lastOutcomeAt: (cur.lastOutcomeAt ?? "") > (row.lastOutcomeAt ?? "") ? cur.lastOutcomeAt : row.lastOutcomeAt,
        unfit: Math.max(cur.unfit||0, row.unfit||0),
      });
    }
    for (const [poolId, row] of byPool) store.set(`${poolId}|`, row);
    _setFitnessStore(store);
    _setBreaker({
      isAvailable: (poolId, providerId) => isAvailable(poolId, providerId ?? "", ""),
    });
    // F1 (W10) — the rules read seam. proxyFleet.loadFitness() (async, boot)
    // reads `settings.proxyRoutingRules` and stashes the snapshot on the fleet
    // anchor; THIS seam stays SYNC (the selection entry is called from sync
    // switches — the plan's own W8 note) and reads the snapshot. FIRST match
    // wins (stage order). No validator stands here by design — an entry the
    // matcher cannot understand simply never matches, and a malformed array
    // is skipped wholesale by the stage's own Array guard.
    const rulesSnap = globalThis.__velaProxyFleetState?.proxyRoutingRules;
    _setRules(Array.isArray(rulesSnap) ? rulesSnap : []);
    _setPoolIndex(new Map());
  } catch {
    // A seam-sync failure leaves the previous seams in force — the runner's
    // fail-open law covers a stale seam; it must never cover a thrown stage.
  }
}

/**
 * The selection entry — replaces pick()/pickSmart/pickRoundRobin/pickProxyPoolId.
 *
 * @param {string[]} poolIds candidate pool ids (already filtered for proxyUrl)
 * @param {{strategy?: string, providerId?: string, incumbentPoolId?: string|null, pinnedPoolId?: string|null}} policy
 * @returns {string|null} the chosen poolId, or null when nothing was chosen
 */
export function pickPool(poolIds, policy = {}) {
  if (!Array.isArray(poolIds) || poolIds.length === 0) return null;
  if (poolIds.length === 1) return poolIds[0];
  const { strategy = "smart", providerId = "", incumbentPoolId = null } = policy;
  syncSeams();
  try {
    const ctx = buildRouteContext({
      providerId, model: "", target: "https://selection.local/",
      candidates: poolIds, strategy,
      incumbentPoolId: incumbentPoolId ?? policy.pinnedPoolId ?? null,
    });
    return runSelection(ctx, STAGE_NAMES);
  } catch {
    return null; // the caller owns the fallback policy
  }
}

/**
 * The bounded re-pick loop — replaces repick(). Serves the freebuff
 * executor's egress-blocked recovery: re-select among pools NOT excluded,
 * rebuilding the proxy options each time, under an attempt cap and budget.
 *
 * @param {string} _model retained for call-shape parity with the deleted
 *   repick(); selection is model-blind by design (the breaker/fitness keys
 *   the pipeline reads are per-pool, not per-model)
 * @param {string[]} excludePoolIds pools already refused this request
 * @param {{maxAttempts?: number, budgetMs?: number, providerId?: string}} opts
 * @returns {Promise<{poolId: string, providerId: string, proxyOptions: object}|null>}
 */
export async function repickPool(_model, excludePoolIds, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const budgetMs = opts.budgetMs ?? 8000;
  const providerId = opts.providerId ?? "freebuff";
  try {
    const deadline = Date.now() + budgetMs;
    const excluded = new Set(excludePoolIds || []);
    let attempts = 0;
    while (attempts < maxAttempts && Date.now() < deadline) {
      const allPools = await getProxyPools({ isActive: true });
      const poolIds = allPools.filter((p) => p.proxyUrl && !excluded.has(p.id)).map((p) => p.id);
      if (poolIds.length === 0) break;
      const next = pickPool(poolIds, { strategy: "smart", providerId });
      if (!next) break;
      const resolved = await resolveConnectionProxyConfig({ proxyPoolId: next });
      if (!resolved) {
        excluded.add(next); // unfit config — never pick it again this round
        attempts++;
        continue;
      }
      return { poolId: next, providerId, proxyOptions: resolved };
    }
    return null; // exhausted
  } catch (err) {
    console.error("[pipeline/selection] repickPool failed:", err?.message ?? err);
    return null;
  }
}

