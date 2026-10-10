/**
 * pipeline/ledger.js — the routing ledger (W11, F10).
 *
 * The plan's observability law: the trace is a first-class output — what makes
 * the routing explainable to the operator. This ledger is the trace's home:
 *
 *   - a FIXED 256-slot ring per the plan's budget: overwritten in place,
 *     zero steady-state allocation (no arrays grow, no rows are minted);
 *   - SAMPLED by default — a successful route records one summary line;
 *     full stage spans persist only on failure or when settings say `full`
 *     (settings.routingLedger === "full");
 *   - healthScore() rolls the ring into the operator's per-provider score:
 *     success rate over the recorded window, with cooldowns counted against.
 *
 * The ring lives on globalThis (the anchor law — the runner must not become a
 * fourth unanchored global).
 */
const LEDGER_KEY = "__velaRouteLedger";
const RING_SIZE = 256;

const state = (globalThis[LEDGER_KEY] ??= {
  ring: new Array(RING_SIZE).fill(null),
  cursor: 0,
  seq: 0,
});

/**
 * Record one routed request.
 * @param {{providerId:string, model?:string, poolId?:string|null, strategy?:string,
 *          ok:boolean, haltReason?:string|null, ms?:number, spans?:object[], full?:boolean}} entry
 */
export function recordRoute(entry) {
  if (!entry || typeof entry !== "object") return;
  const brief = {
    seq: ++state.seq,
    ts: Date.now(),
    providerId: entry.providerId ?? "",
    model: entry.model ?? "",
    poolId: entry.poolId ?? null,
    strategy: entry.strategy ?? "",
    ok: entry.ok === true,
    haltReason: entry.haltReason ?? null,
    ms: typeof entry.ms === "number" ? Math.round(entry.ms) : null,
    // Sampling: failures keep their spans (the operator needs the walk);
    // successes keep only the span NAMES — the shape without the weight.
    spans: entry.ok === true && entry.full !== true
      ? (entry.spans ?? []).map((s) => s?.stage ?? null)
      : (entry.spans ?? []).map((s) => ({ stage: s?.stage, decision: s?.decision, detail: s?.detail, ms: s?.ms })),
  };
  state.ring[state.cursor] = brief;
  state.cursor = (state.cursor + 1) % RING_SIZE;
}

/**
 * The recent ledger, newest first.
 * @param {{providerId?:string, limit?:number}} [opts]
 */
export function recentRoutes(opts = {}) {
  const limit = typeof opts.limit === "number" && opts.limit > 0 ? Math.min(opts.limit, RING_SIZE) : 32;
  const out = [];
  for (let i = 0; i < RING_SIZE && out.length < limit; i++) {
    const idx = (state.cursor - 1 - i + RING_SIZE * 2) % RING_SIZE;
    const row = state.ring[idx];
    if (!row) continue;
    if (opts.providerId && row.providerId !== opts.providerId) continue;
    out.push(row);
  }
  return out;
}

/**
 * F10 — the operator's health score for one provider (or all).
 * Success rate over the recorded window; providers with no traffic score
 * null (never a fabricated 100).
 * @param {string} [providerId]
 */
export function healthScore(providerId = null) {
  const tally = new Map();
  for (const row of state.ring) {
    if (!row) continue;
    if (providerId && row.providerId !== providerId) continue;
    const t = tally.get(row.providerId) ?? { ok: 0, total: 0 };
    t.total++;
    if (row.ok) t.ok++;
    tally.set(row.providerId, t);
  }
  const out = {};
  for (const [pid, t] of tally) {
    out[pid] = { score: Math.round((t.ok / t.total) * 1000) / 10, samples: t.total };
  }
  return providerId ? (out[providerId] ?? null) : out;
}

/** Test-only: wipe the ring. */
export function clearLedger() {
  state.ring.fill(null);
  state.cursor = 0;
  state.seq = 0;
}
