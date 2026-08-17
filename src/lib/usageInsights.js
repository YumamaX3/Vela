// Usage Observatory W4-B — the Lookout signal registry (auto-insights).
//
// Sealed plan W4-B: "auto-insights (Lookout signal registry: threshold +
// attribution + i18n template + evidence deep-link, column-guards,
// quiet-state)". This module is the PURE evaluator: pre-fetched Observatory
// data in (getKpis + breakdowns + percentiles), an ordered insight list out.
// No I/O, no SQL — the repo twin feeds it, the route serves it, and the
// InsightsStrip renders it.
//
// Every signal carries:
//   • kind       — the registry key (stable for UI/tests)
//   • severity   — high | medium | low (orders the strip)
//   • i18nKey    — the English template literal (seeded in every locale)
//   • params     — interpolation values ({param} substitution in t())
//   • evidence   — a Needle deep-link (facet params, never an opaque id)
//
// Column guards: every signal demands a minimum sample before it may speak —
// a 3-request window never accuses, and telemetry that is absent (pre-008
// rows, unclassified statusClass) is excluded from the denominator rather
// than counted against it. The quiet-state is honest: no signals → [] →
// the strip says so.
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL).

export const MAX_INSIGHTS = 4;

/** The thresholds — one frozen home for every trigger level. */
export const INSIGHT_THRESHOLDS = Object.freeze({
  minTotalRequests: 20,      // the error signals stay quiet below this sample
  errorRateRatio: 0.08,      // classified errors / classified total
  errorShareRatio: 0.4,      // one statusClass's share of all errors
  providerCostShare: 0.6,    // one provider's share of window cost
  minCostForShare: 0.01,     // $ floor — noise below this never accuses
  costSpikeRatio: 2.0,       // cur ≥ 2× prev window cost
  minSpikeCost: 0.01,        // and a $ floor on the current side too
  latencyP95Ms: 5000,        // p95 above this speaks
  latencyHighMs: 10000,      // above this escalates to high
  minLatencySample: 50,      // telemetry count floor for latency
});

const TH = INSIGHT_THRESHOLDS;

/** The classes that count as errors — ok and unclassified ("") do not. */
const ERROR_CLASSES = new Set(["client_error", "upstream_error", "timeout", "rate_limited"]);

/** 1-decimal percentage (0.081 → 8.1). */
const pct = (x) => Math.round(x * 1000) / 10;

const sum = (items) => items.reduce((a, i) => a + (i.value || 0), 0);

/** Evaluate every signal from pre-fetched Observatory data.
 *  @param {object} data { kpis, statusBreakdown, providerCost, latency }
 *  @returns {{kind,severity,i18nKey,params,evidence}[]} ordered, capped. */
export function evaluateInsights({ kpis, statusBreakdown, providerCost, latency } = {}) {
  const insights = [];

  // ── 1. elevated_errors — the window's error rate climbed ───────────────
  const statusItems = statusBreakdown?.items || [];
  const classified = statusItems.filter((i) => i.statusClass === "ok" || ERROR_CLASSES.has(i.statusClass));
  const classifiedTotal = sum(classified);
  const errorTotal = sum(statusItems.filter((i) => ERROR_CLASSES.has(i.statusClass)));
  if (classifiedTotal >= TH.minTotalRequests && errorTotal / classifiedTotal >= TH.errorRateRatio) {
    insights.push({
      kind: "elevated_errors",
      severity: errorTotal / classifiedTotal >= 0.2 ? "high" : "medium",
      i18nKey: "{pct}% of requests in this window failed — error rate is elevated",
      params: { pct: pct(errorTotal / classifiedTotal) },
      evidence: { tab: "analytics" },
    });

    // ── 2. error_class_dominant — one failure class owns the mix ─────────
    // Only speaks inside an already-elevated window; the share is measured
    // against the errors themselves, never the whole window.
    const worst = statusItems
      .filter((i) => ERROR_CLASSES.has(i.statusClass))
      .sort((a, b) => (b.value || 0) - (a.value || 0))[0];
    if (worst && errorTotal > 0 && (worst.value || 0) / errorTotal >= TH.errorShareRatio) {
      insights.push({
        kind: "error_class_dominant",
        severity: "medium",
        i18nKey: "Most failures are {statusClass} ({pct}% of errors)",
        params: { statusClass: worst.statusClass, pct: pct((worst.value || 0) / errorTotal) },
        evidence: { tab: "analytics" },
      });
    }
  }

  // ── 3. cost_concentration — one provider owns the window's spend ───────
  const costItems = providerCost?.items || []; // breakdownImpl sorts desc
  const totalCost = sum(costItems);
  const topProvider = costItems[0];
  if (totalCost >= TH.minCostForShare && topProvider && (topProvider.value || 0) / totalCost >= TH.providerCostShare) {
    insights.push({
      kind: "cost_concentration",
      severity: "medium",
      i18nKey: "{provider} accounts for {pct}% of spend in this window",
      params: { provider: topProvider.provider, pct: pct((topProvider.value || 0) / totalCost) },
      evidence: { tab: "overview", prov: topProvider.provider },
    });
  }

  // ── 4. cost_spike — this window's spend vs the one before it ──────────
  const curCost = kpis?.cost?.value ?? 0;
  const prevCost = kpis?.cost?.previous ?? 0;
  if (prevCost > 0 && curCost >= TH.costSpikeRatio * prevCost && curCost >= TH.minSpikeCost) {
    insights.push({
      kind: "cost_spike",
      severity: "high",
      i18nKey: "Spend is {times}× the previous period",
      params: { times: Math.round((curCost / prevCost) * 10) / 10 },
      evidence: { tab: "overview" },
    });
  }

  // ── 5. high_latency — p95 climbed (column-guarded by telemetry count) ──
  const p95 = latency?.values?.p95;
  const latencyCount = latency?.count ?? 0;
  if (p95 != null && latencyCount >= TH.minLatencySample && p95 >= TH.latencyP95Ms) {
    insights.push({
      kind: "high_latency",
      severity: p95 >= TH.latencyHighMs ? "high" : "medium",
      i18nKey: "p95 latency is {secs}s in this window",
      params: { secs: (p95 / 1000).toFixed(1) },
      evidence: { tab: "analytics" },
    });
  }

  // Severity order (high first); stable sort keeps registry order within a tier.
  const SEV_ORDER = { high: 0, medium: 1, low: 2 };
  insights.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
  return insights.slice(0, MAX_INSIGHTS);
}
