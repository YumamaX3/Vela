/**
 * pipeline/stages.js — the eight routing stages.
 *
 * W7 of the proxy control-plane rebirth. Each stage is a pure function over a
 * RouteContext (except dispatch, which is the one stage that performs I/O).
 * Stages 1–6 and 8 are directly unit-testable: no DB, no timers, no network.
 *
 * The no-config law: with nothing configured, every stage must pass through
 * byte-identically. That is what makes W8's cutover safe — the pipeline can
 * land dark and behave exactly as the old switch did.
 */

import { defineStage, halt, makeSpan } from "./stage.js";
import { registerStage } from "./registry.js";
import { createHash } from "node:crypto";

// ─── Stage 1 · egress-fence (gate, sync, CRITICAL) ────────────────────────
// Runs the SSRF gate on the target. Does NOT replace the fence inside
// proxyAwareFetch — that stays as defense-in-depth. This stage is critical:
// a throw here HALTS, because a security stage must never fail open.
let ssrfGate = null;
export function _setSsrfGate(fn) { ssrfGate = fn; } // test seam

registerStage(defineStage({
  name: "egress-fence",
  kind: "gate",
  sync: true,
  critical: true,
  fn: (ctx) => {
    if (ssrfGate) {
      const verdict = ssrfGate(ctx.target, ctx.providerId);
      if (verdict && verdict.ok === false) {
        return halt(`ssrf: ${verdict.reason || "refused"}`, "refuse");
      }
    }
    return ctx;
  },
}));

// ─── Stage 2 · rule-resolve (resolve, sync) ───────────────────────────────
// First-match rule over (host, model, providerId). No rules → pass-through,
// byte-identical. Rules arrive as data; evaluation is pure.
let ruleSet = [];
export function _setRules(rules) { ruleSet = Array.isArray(rules) ? rules : []; }

function matchRule(rule, ctx) {
  if (rule.enabled === false) return false;
  const m = rule.match || {};
  if (m.hostSuffix && !ctx.target.hostname.endsWith(m.hostSuffix)) return false;
  if (m.provider && m.provider !== "*" && m.provider !== ctx.providerId) return false;
  if (m.modelPrefix && !ctx.model.startsWith(m.modelPrefix)) return false;
  return true;
}

registerStage(defineStage({
  name: "rule-resolve",
  kind: "resolve",
  sync: true,
  fn: (ctx) => {
    for (const rule of ruleSet) {
      if (!matchRule(rule, ctx)) continue;
      const action = rule.action || {};
      if (action.poolId) {
        ctx.candidates = [action.poolId];
        ctx.cursor = 0;
      } else if (Array.isArray(action.poolIds)) {
        ctx.candidates = [...action.poolIds];
        ctx.cursor = 0;
      }
      ctx.routeId = rule.id ?? null;
      return ctx;
    }
    return ctx;
  },
}));

// ─── Stage 3 · group-select (resolve, sync) ───────────────────────────────
// Expands the provider's configured pool list into the candidate set, applying
// tag/group membership, weight, and backup-tier ordering. With no groups
// configured the candidate set passes through unchanged.
let poolIndex = new Map(); // poolId → pool row (refreshed by the sweep)
export function _setPoolIndex(idx) { poolIndex = idx instanceof Map ? idx : new Map(); }

registerStage(defineStage({
  name: "group-select",
  kind: "resolve",
  sync: true,
  fn: (ctx) => {
    if (!Array.isArray(ctx.candidates) || ctx.candidates.length === 0) return ctx;
    // Drop candidates that are not in the pool index (deleted pools).
    // Unknown pools PASS — the index may be cold on a fresh chunk, and dropping
    // on a cold index would be the fleet self-liquidation again.
    if (poolIndex.size === 0) return ctx;
    const kept = ctx.candidates.filter((id) => poolIndex.has(id));
    if (kept.length === 0) return ctx;
    // W10 (F7) — the GOST borrow: backup tiers + weights from the pool rows.
    // A pool's data blob may carry `weight` (number, default 1) and
    // `backupOf` (poolId). TIER LAW: primaries (no backupOf) sail first in
    // the caller's order; backups follow, grouped by their primary, stable
    // within tier by weight desc then caller order. The weighted draw still
    // picks among them — this ordering is the DISPATCH fallback order (the
    // dispatch stage walks candidates[?] on failure), not a second draw.
    const tierOf = (id) => {
      const row = poolIndex.get(id);
      const w = typeof row?.weight === "number" && Number.isFinite(row.weight) && row.weight > 0 ? row.weight : 1;
      const backup = typeof row?.backupOf === "string" && row.backupOf && kept.includes(row.backupOf) ? row.backupOf : null;
      return { id, backup, w, idx: kept.indexOf(id) };
    };
    const meta = kept.map(tierOf);
    const primaries = meta.filter((m) => !m.backup);
    const backups = meta.filter((m) => m.backup);
    // Backups ordered AFTER their primary's position, grouped by primary.
    const groupKey = (m) => primaries.findIndex((p) => p.id === m.backup);
    backups.sort((a, b) => (groupKey(a) - groupKey(b)) || (b.w - a.w) || (a.idx - b.idx));
    const ordered = [...primaries, ...backups].map((m) => m.id);
    ctx.candidates = ordered;
    ctx.cursor = 0;
    return ctx;
  },
}));

// ─── Stage 4 · health-filter (filter, sync) ───────────────────────────────
// Drops candidates the breaker has cooled. THE THREE-VERDICT LAW: an
// `indeterminate` probe verdict is a PASS, never a drop. Auto-disable fires
// only on `dead`, and that lives in the sweep, not here.
let breaker = null;
export function _setBreaker(mod) { breaker = mod; }

registerStage(defineStage({
  name: "health-filter",
  kind: "filter",
  sync: true,
  fn: (ctx) => {
    if (!breaker || !Array.isArray(ctx.candidates)) return ctx;
    const dropped = [];
    const kept = [];
    for (const id of ctx.candidates) {
      let available = true;
      try {
        available = breaker.isAvailable(id, ctx.providerId, ctx.model);
      } catch {
        available = true; // fail-open: a breaker throw must not read as "dead"
      }
      if (available) kept.push(id);
      else dropped.push(id);
    }
    if (kept.length > 0) {
      ctx.candidates = kept;
      ctx.cursor = 0;
    }
    ctx.dropped = dropped;
    return ctx;
  },
}));

// ─── Stage 5 · weighted-draw (draw, sync) ─────────────────────────────────
// The EWMA draw lifted from pickSmart, preserving α=0.3 and the 7-day
// half-life read-time decay. ADDS HYSTERESIS: the incumbent wins unless a
// challenger's weight exceeds it by `tolerance` (default 1.15) — pooled thrash
// made structurally impossible.
const EWMA_ALPHA = 0.3;
const HALF_LIFE_DAYS = 7;
const HYSTERESIS_TOLERANCE = 1.15;
let fitnessStore = new Map();
export function _setFitnessStore(store) {
  // Mutate IN PLACE. Reassigning the binding would leave the weighted-draw
  // stage holding the Map it captured at module load, so a test (or a sweep
  // refresh) would appear to have no effect.
  fitnessStore.clear();
  if (store instanceof Map) for (const [k, v] of store) fitnessStore.set(k, v);
}

function weightOf(poolId) {
  const row = fitnessStore.get(`${poolId}|${""}`);
  if (!row) return 1;
  const total = (row.successCount || 0) + (row.failureCount || 0);
  if (total === 0) return 1;
  const successRate = row.successCount / total;
  // W9 fidelity fix: the draw's scoring must be the FLEET's computeScore, not
  // a lookalike. The original 1000/latency factor made the draw's latency
  // pressure 10× steeper than the fitness score every operator surface shows
  // (getFitnessSummary → score) — and the golden-parity fixture caught the
  // drift the day the oracle expired. The fleet's own formulas, verbatim:
  // latencyFactor = max(0, 1 - latency/5000) (normalized over 5s, 0 allowed),
  // decay = 0.5 + 0.5 * 0.5^(ageDays/7) (age decay TOWARD neutral 0.5).
  const latencyFactor = row.latencyEwmaMs > 0
    ? Math.max(0, 1 - row.latencyEwmaMs / 5000)
    : 1;
  const ageDays = row.lastOutcomeAt ? (Date.now() - Date.parse(row.lastOutcomeAt)) / 86400000 : 0;
  const decay = 0.5 + 0.5 * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  return Math.max(0.01, successRate * latencyFactor * decay);
}

registerStage(defineStage({
  name: "weighted-draw",
  kind: "draw",
  sync: true,
  fn: (ctx) => {
    if (!Array.isArray(ctx.candidates) || ctx.candidates.length === 0) return ctx;
    if (ctx.candidates.length === 1) {
      ctx.poolId = ctx.candidates[0];
      return ctx;
    }
    // Hysteresis: the incumbent wins unless a challenger exceeds it by the
    // tolerance ratio. This is the two-line guard that stops thrash.
    if (ctx.incumbentPoolId && ctx.candidates.includes(ctx.incumbentPoolId)) {
      const incumbentW = weightOf(ctx.incumbentPoolId);
      let bestW = 0;
      for (const id of ctx.candidates) bestW = Math.max(bestW, weightOf(id));
      if (bestW <= incumbentW * HYSTERESIS_TOLERANCE) {
        ctx.poolId = ctx.incumbentPoolId;
        return ctx;
      }
    }
    // Weighted draw.
    const weights = ctx.candidates.map(weightOf);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < ctx.candidates.length; i++) {
      if (r < weights[i]) { ctx.poolId = ctx.candidates[i]; return ctx; }
      r -= weights[i];
    }
    ctx.poolId = ctx.candidates[ctx.candidates.length - 1];
    return ctx;
  },
}));

// ─── Stage 6 · affinity-check (draw, sync) ────────────────────────────────
// Stateless consistent hashing — no binding table, no hot-path write. A hit
// pins and EARLY-EXITS, skipping the weighted draw entirely, so a sticky
// session can never override health (health-filter already ran).
registerStage(defineStage({
  name: "affinity-check",
  kind: "draw",
  sync: true,
  fn: (ctx) => {
    if (!ctx.affinityKey || !Array.isArray(ctx.candidates) || ctx.candidates.length === 0) {
      return ctx; // no affinity configured → pass through
    }
    const sorted = [...ctx.candidates].sort();
    const h = createHash("sha1").update(ctx.affinityKey).digest().readUInt32BE(0);
    ctx.poolId = sorted[h % sorted.length];
    return ctx;
  },
}));

// ─── Stage 7 · dispatch (route, AWAITED) ──────────────────────────────────
// The ONE stage that performs I/O. Pops candidates[cursor], resolves the
// payload through the single builder, and calls proxyAwareFetch. Retry is
// bounded by ctx.budgetMs (the freebuff executor passes its own caps to
// repickPool since the W8 cutover deleted MAX_REPICKS / REPICK_BUDGET_MS).
let dispatcher = null;
export function _setDispatcher(fn) { dispatcher = fn; }

registerStage(defineStage({
  name: "dispatch",
  kind: "route",
  fn: async (ctx) => {
    if (!dispatcher) return halt("no dispatcher wired", "refuse");
    const started = Date.now();
    const candidates = Array.isArray(ctx.candidates) ? ctx.candidates : [];
    // Honour the pool the draw (or affinity) chose. The previous version
    // unconditionally wrote `candidates[cursor]` on entry, which DISCARDED the
    // weighted draw's answer and always dispatched candidates[0] — the draw was
    // correct all along, this stage was throwing its result away.
    let attemptPool = ctx.poolId || candidates[0] || null;
    const tried = new Set();
    // W10 (F3) — the GOST borrow: hedged/parallel dialing. When the strategy
    // enables it, the runner races the primary against the NEXT candidate
    // after `hedgeDelayMs` (default 150ms); the first `ok` verdict wins and
    // the loser is abandoned (its outcome feeds the breaker through the
    // dispatcher's own record path, so a consistently-losing hedge target is
    // cooled exactly like a failed primary). The race is BOUNDED: at most
    // two in flight, and only while candidates remain and the budget holds.
    const hedging = ctx.hedge === true && candidates.length > 1;
    while (attemptPool && !tried.has(attemptPool)) {
      tried.add(attemptPool);
      ctx.poolId = attemptPool;
      if (hedging) {
        const nextPool = candidates.find((c) => !tried.has(c)) || null;
        if (nextPool) {
          tried.add(nextPool);
          const hedgeCtx = { ...ctx, poolId: nextPool };
          const delay = typeof ctx.hedgeDelayMs === "number" && ctx.hedgeDelayMs > 0 ? ctx.hedgeDelayMs : 150;
          const primary = dispatcher(ctx).then((r) => ({ winner: attemptPool, r }));
          const hedge = new Promise((resolve) => {
            setTimeout(() => resolve(null), delay); // delay gate, not a dial
          }).then((gate) => (gate === null ? dispatcher(hedgeCtx).then((r) => ({ winner: nextPool, r })) : gate));
          const race = await Promise.race([primary, hedge]);
          ctx.elapsedMs = Date.now() - started;
          if (race && race.r && race.r.ok !== false) {
            ctx.poolId = race.winner;
            ctx.dispatchResult = race.r;
            ctx.hedgedWinner = race.winner !== attemptPool;
            return ctx;
          }
          // Neither won yet: fall through to the sequential retry loop with
          // both pools marked tried — the primary's failure result governs.
          ctx.dispatchResult = race?.r ?? null;
          if (ctx.strictProxy) {
            return halt(`dispatch refused: ${ctx.dispatchResult?.reason || "failed"}`, "refuse");
          }
          if (ctx.elapsedMs >= ctx.budgetMs) {
            return halt("repick budget exhausted", "retry");
          }
          attemptPool = candidates.find((c) => !tried.has(c)) || null;
          continue;
        }
      }
      const result = await dispatcher(ctx);
      ctx.elapsedMs = Date.now() - started;
      ctx.dispatchResult = result;
      if (!result || result.ok !== false) return ctx; // success (or no verdict)
      if (ctx.strictProxy) {
        return halt(`dispatch refused: ${result.reason || "failed"}`, "refuse");
      }
      if (ctx.elapsedMs >= ctx.budgetMs) {
        return halt("repick budget exhausted", "retry");
      }
      attemptPool = candidates.find((c) => !tried.has(c)) || null;
    }
    return halt("all candidates exhausted", "retry");
  },
}));

// ─── Stage 8 · outcome-record (terminal, AWAITED) ─────────────────────────
// Classifies the result and feeds the fitness engine, the breaker, and
// recordClaimGate — which finally gains its first-ever caller. Never throws.
let recorder = null;
export function _setRecorder(fn) { recorder = fn; }

registerStage(defineStage({
  name: "outcome-record",
  kind: "terminal",
  fn: async (ctx) => {
    if (recorder) {
      try { await recorder(ctx); } catch { /* never throws */ }
    }
    return ctx;
  },
}));

/** The default eight-stage chain, in order. */
export const STAGE_NAMES = [
  "egress-fence", "rule-resolve", "group-select", "health-filter",
  "weighted-draw", "affinity-check", "dispatch", "outcome-record",
];
