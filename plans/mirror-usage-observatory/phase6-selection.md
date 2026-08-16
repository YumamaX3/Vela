# Phase 6 — Approach Curation: Scoring & Selection (Usage Observatory)

## Frame (Gate 4 accepted, 4 waves)
W1 THE TELESCOPE: migration 008 (latencyMs, ttftMs, httpStatus, status normalization ok/success/error, composite indexes, SCHEMA_VERSION 7→8) + hot-path instrumentation (real TTFT at first upstream SSE byte, upstream status, RTK savings into meta) + full MySQL-twin/backup parity + SQL-side aggregation rewrite (stats p95 < 300ms @ 100k rows).
W2 THE COCKPIT: tabbed decks (Overview/Analytics/Requests/Accounts & Limits) + global URL-state filter bar + KPI row with deltas + 3-level type scale + stacked breakdown charts with click-to-filter + skeletons/empty/RTL/375px + CSV export + compare-periods + $/Mtok + cache card (estimated labels) + RTK savings KPI + quota merge + /dashboard/quota redirect + metrics REST API behind dashboardGuard + i18n parity across 34 locales.
W3 GOVERNANCE: budget engine (gateway+key+model scopes, multi-window, hot-path checks, soft alerts 50/80/100, hard caps with distinct 429 codes) + alert channels (dashboard, Discord webhook, n8n webhook) + weekly digest + quotaRepo history sampler.
W4 EXPERIMENTAL: saved views, rule-based auto-insights, request tags, provider health timeline.

## Hard disqualifier check — ALL FIVE PASS
- MySQL-twin parity: all five declare it for new repos/columns. PASS.
- Latency percentiles: none relies on the 200-row requestDetails window; all require migration 008 columns (+Observatory adds usageDaily rollup extension). PASS.
- 429 counts: all add httpStatus column before claiming status-class counts. PASS.
- Anti-slop: no purple/Inter/glass/triptych-stacking defaults. PASS.

## Scores (1–5, weights per rubric)

| Dimension (weight) | Helm Deck | Lookout | Observatory | Manifest | Compass |
|-|-|-|-|-|-|
| 1 Criteria coverage (20%) | 5 | 5 | 5 | 5 | 5 |
| 2 Telemetry honesty (15%) | 4.5 | 5 | 5 | 4.5 | 5 |
| 3 Reuse ratio (15%) | 4 | 3.5 | 5 | 4.5 | 5 |
| 4 Operator clarity (15%) | 4 | 4.5 | 4 | 4 | 5 |
| 5 Filter-system fit (10%) | 5 | 5 | 5 | 5 | 4.5 |
| 6 Performance posture (10%) | 4 | 3 | 5 | 4 | 4 |
| 7 Oracle fidelity (8%) | 3.5 | 4 | 5 | 3 | 4 |
| 8 i18n/375px/scope (7%) | 3 | 3.5 | 4 | 3 | 4.5 |
| **Weighted total** | **4.27** | **4.32** | **4.78** | **4.30** | **4.74** |

## Ranking
1. **The Observatory — 4.78** ← WINNER
2. The Compass Deck — 4.74 (statistical tie at scoring granularity)
3. The Lookout — 4.32
4. The Manifest Deck — 4.30
5. The Helm Deck — 4.27

Tie-break note: Observatory vs Compass is within noise. Tie-breakers: reuse ratio (5 vs 5, tied) then operator clarity (Compass 5 > Observatory 4) — which argues for Compass. Resolution: the two are complementary, not competing — Compass owns the IA DISCIPLINE (question-shaped decks, acceptance tests, adaptive facets, i18n anchor strings, UsageStats.js decomposition), Observatory owns the SPATIAL SOUL (functional kame topology with error halos as Overview centerpiece, visuals-as-doors, rollup-backed perf, 'collecting since' honesty states). The selection is a MERGE with Observatory as hull.

## SELECTION: "The Observatory, steered by the Compass"
- Hull: Observatory — page chrome, sticky Helm filter bar, four URL-driven decks, KPI row with deltas, topology Row B with halos + click-to-filter + live feed rail, chart inventory (all Recharts, zero new deps), Requests ledger server-paginated, Rigging absorbs quota, SQL aggregation + usageDaily rollup extension, feature flag per tab.
- Compass grafts: each deck carries its question as subtitle and acceptance test (Overview='Where did the money go?', Analytics='Is it healthy?', Requests='What happened?', Accounts='What are my limits?'); adaptive facets — shared facets (period/provider/model/key) fixed position on every deck, deck-specific facets appended; 4 anchor question-strings seed all 34 locales; UsageStats.js orchestrator decommissioned explicitly (SSE subscription extracted to hook, children rehomed) — pays down the inverted-dependency debt; 'N new requests' pill (ledger never reflows under the eye).
- Manifest grafts: permanent honesty strip in chrome (as-of · timezone · 'estimated' · dedupe-undercount ⓘ); ledger keyboard nav (↑↓/Enter///f) built carefully with focus-management discipline; charts answer 'where', ledger answers 'what'.
- Lookout grafts (banked for W4): signal-registry architecture — pure rules (threshold + attribution + i18n template id + evidence deep-link), column-guards so signals ship dormant before telemetry accrues, explicit quiet-state ('nothing unusual') — becomes the W4 auto-insights implementation; compare-periods in ONE query via CASE WHEN double-range.
- Helm grafts (banked for W4 stretch): ⌘K palette as a fast writer to the same URL params (never a parallel state machine); hotkeys 1-4 deck switch with input-focus guard.

## Banked for Phase 10 (runner-up ideas)
1. Compass: question-as-acceptance-test (4 checkable yes/no reviews)
2. Compass: UsageStats.js decomposition plan
3. Compass: adaptive facets with fixed-position shared facets
4. Compass: i18n economics via 4 anchor strings
5. Manifest: honesty status strip as permanent chrome
6. Manifest: ledger keyboard ergonomics + no-reflow pill
7. Lookout: signal registry + column-guards + quiet state (W4 insights architecture)
8. Lookout: single-query compare-periods
9. Helm: ⌘K palette (W4 stretch), hotkey set
10. Observatory: 'collecting since <date>' honesty states for pre-telemetry panels

## Known risks carried
- Bundle weight: xyflow + 12 Recharts panels → dynamic import per deck, feature-flagged.
- Motion distraction: prefers-reduced-motion + pause controls on all SSE-driven animation.
- Rollup seams at period boundaries: bucket size always labeled.
- Half-empty launch week: honesty states dull the debut — accepted, deception costs more.
- i18n growth: chart labels/tooltips × 34 locales — gated per deck, anchor strings first.
