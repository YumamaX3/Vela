# Phase 6 — Approach Curation: REVISED Selection v2 (Usage Observatory)

> Reforged after Tidebreaker verdict: **REFUTED** (2 FATAL, 5 SERIOUS, 3 NOISE).
> Every FATAL and SERIOUS finding absorbed. The arithmetic was clean; the hull was wrong.

## Frame (Gate 4 accepted, 4 waves) — unchanged
W1 THE TELESCOPE: migration 008 (latencyMs, ttftMs, httpStatus, status normalization, composite indexes, SCHEMA_VERSION 7→8) + hot-path instrumentation (real TTFT at first upstream SSE byte, upstream status, RTK savings into meta) + full MySQL-twin/backup parity + SQL-side aggregation rewrite (target: stats p95 < 300ms @ 100k rows, benchmark-gated).
W2 THE COCKPIT: tabbed decks + global URL-state filter bar + KPI row with deltas + 3-level type scale + stacked breakdown charts with click-to-filter + skeletons/empty/RTL/375px + CSV export + $/Mtok + cache card (estimated labels) + RTK savings KPI + quota merge + /dashboard/quota redirect + metrics REST API behind dashboardGuard + i18n parity.
W3 GOVERNANCE: budget engine (gateway+key+model, multi-window, soft alerts 50/80/100, hard caps) + alert channels (dashboard, Discord, n8n) + weekly digest + **compare-periods (phased here from W2)** + quotaRepo history sampler.
W4 EXPERIMENTAL: saved views, rule-based auto-insights, request tags, provider health timeline.

## Adjudications — the two IA conflicts, ruled in writing (resolves F1)
1. **TOPOLOGY FIRST-LOAD: Overview.** The kame topology greets as Overview Row B — but FUNCTIONAL, never decorative: halos encode per-provider error rate (channel funded in W1, see S1), particles encode throughput, click sets the global filter. Analytics keeps the TEMPORAL health instruments (latency percentiles, error anatomy, health-timeline strips W4) — spatial glance on Overview, temporal diagnosis on Analytics. No duplication: the two decks answer different questions about health.
2. **PROVIDER BREAKDOWN: centralized by metric, not duplicated.** Overview OWNS provider×spend (stacked area + top-providers bars). Analytics OWNS provider×status and provider×latency. Same facets endpoint, different metrics — the provider dimension is never rendered twice for the same metric.

## Corrected scoring (F2 absorbed — Observatory reuse 5 → 4.5)

| Dimension (weight) | Helm | Lookout | Observatory | Manifest | **Compass** |
|-|-|-|-|-|-|
| 1 Criteria coverage (20%) | 5 | 5 | 5 | 5 | 5 |
| 2 Telemetry honesty (15%) | 4.5 | 5 | 5 | 4.5 | 5 |
| 3 Reuse ratio (15%) | 4 | 3.5 | **4.5** ↓ | 4.5 | 5 |
| 4 Operator clarity (15%) | 4 | 4.5 | 4 | 4 | **5** |
| 5 Filter-system fit (10%) | 5 | 5 | 5 | 5 | 4.5 |
| 6 Performance posture (10%) | 4 | 3 | 5 | 4 | 4 |
| 7 Oracle fidelity (8%) | 3.5 | 4 | 5 | 3 | 4 |
| 8 i18n/375px/scope (7%) | 3 | 3.5 | 4 | 3 | 4.5 |
| **Weighted total** | 4.27 | 4.32 | **4.705** ↓ | 4.30 | **4.74** 🏆 |

## Revised ranking
1. **The Compass Deck — 4.74** ← WINNER (by corrected score AND by the rubric's own tie-break: operator clarity 5 > 4)
2. The Observatory — 4.705 (spatial soul grafted onto the hull)
3. The Lookout — 4.32 · 4. The Manifest Deck — 4.30 · 5. The Helm Deck — 4.27

## SELECTION: "The Compass Deck, crowned by the Observatory's spatial soul"
**HULL — Compass** (per the rubric's own machinery): four question-shaped decks as acceptance tests (Overview='Where did the money go?', Analytics='Is it healthy?', Requests='What happened?', Accounts='What are my limits?'); sticky Needle filter bar with fixed-position shared facets (period/provider/model/key) + adaptive per-deck facets; 4 anchor question-strings seed all 34 locales; UsageStats.js orchestrator decommissioned explicitly (SSE subscription → hook, children rehomed) — the inverted-dependency debt dies in W2; 'N new requests' pill (the ledger never reflows under the eye); honest dust patterns carried forward.
**GRAFTS — Observatory**: topology greets Overview Row B (adjudication 1, halos funded by S1 channel); full chart inventory (Recharts only, zero new deps); Requests deck upgraded to SERVER-PAGINATED ledger (SQL LIMIT/OFFSET on composite indexes) with drawer + CSV honoring filters; SQL-side aggregation layer + usageDaily rollup extension (status + latency-histogram buckets); 'collecting since <date>' honesty states; per-tab feature flags; palette = brand terracotta + existing provider colors, hardcoded indigo retired.
**GRAFTS — Manifest**: permanent honesty strip in chrome (as-of · timezone · 'estimated' · dedupe-undercount ⓘ); ledger keyboard nav (↑↓/Enter///f) with focus-management discipline — built carefully or not at all.
**GRAFTS — Lookout (banked for W4)**: signal registry (pure rules: threshold + attribution + i18n template id + evidence deep-link) with column-guards + explicit quiet-state — the W4 auto-insights architecture; single-query compare-periods via CASE WHEN double-range.
**GRAFTS — Helm (banked for W4 stretch)**: ⌘K palette as fast writer to URL params; hotkeys with input-focus guard.

## Mitigations sealed into the frame (SERIOUS findings absorbed)
- **S1 halos funded (W1)**: `providerHealthFrame(windowMs)` aggregation — per-provider rolling 60s requests+errors from usageHistory post-normalization — emitted as an additive SSE quickStats field `perProvider`. Halos consume this; no halo without data.
- **S2 percentile algorithm named (W1)**: recent windows (≤3d): indexed skip-scan on (timestamp, latencyMs) — exact p50/p95/p99 via ORDER BY latencyMs OFFSET floor(q·N) after COUNT. Long windows (7d+): usageDaily rollup extension stores fixed log-scale latency histograms per provider — approximate, bucket-size labeled. Benchmark gate: kpis endpoint p95 < 300ms @ 100k synthetic rows on SQLite AND MySQL twin; misses → claim downgrades to 'target', no ship-block.
- **S3 render churn (W2)**: SSE consumption split — KPI/live tiles on quickStats (throttled ≥2s), charts on full stats at ≤60s or on-demand only; all chart components React.memo keyed by data hash. SQL rewrite MUST eliminate BOTH full-history passes (rollup read + lastUsed overlay SELECT — lastUsed from rollup dateKey + MAX(timestamp) only over displayed top-N).
- **S4 i18n budget (hard cap)**: W2 ≤ 40 new literals (~1,360 entries). Chart panels share one label set via ChartPanel chrome; tooltips compose from number primitives + metric labels; ONE shared empty-state string; ONE templated 'collecting since {date}'.
- **S5 W2 scope phased**: compare-periods → W3 (delta machinery lands with budget burn). CSV stays (shares WHERE-builder with metrics API). UsageStats decomposition stays (the cockpit spine). Everything else holds.

## Banked for Phase 10 (runner-up ideas, unchanged)
Compass acceptance-test discipline · UsageStats decomposition plan · adaptive facets · 4-anchor i18n | Manifest honesty strip + keyboard ergonomics + no-reflow pill | Lookout signal registry + quiet state + single-query compare | Helm ⌘K palette + hotkeys | Observatory 'collecting since' states.

## Known risks carried
Bundle weight (dynamic import per deck) · motion distraction (prefers-reduced-motion + pause) · rollup seams (bucket size labeled) · half-empty launch week (honesty states dull the debut — accepted) · status keeps both 'ok' and 'success' success-tokens (N3, cosmetic).
