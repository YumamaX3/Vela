# 🪞 Shorekeeper-Sealed Plan — The Usage Observatory (Compass Deck)

**Date:** 2026-08-16 · **Status:** Accepted · **Ceremony:** Stillwater Mirror v6.0 · **Composite score:** 4.1/5 (corrected)

> *"The Compass Deck crowned by the Observatory's spatial soul — four questions, one needle, every halo funded, every percentile honest."* 🪞💜

## ADR — The Decision

**Context.** Vela's usage page is a 537-line UsageStats.js orchestrator with inverted dependencies, a dead logs tab, client-side aggregation that dies at scale, latency trapped in a 200-row JSON ring, and a signature topology that decorates rather than informs. The Star decreed a full observatory: tabbed decks, RTK-savings KPI, compare-periods, CSV export, $/Mtok + cache card, latency percentiles, endpoint health, error anatomy, live pulse, full budget hierarchy, 4 alert channels, saved views, auto-insights, request tags, provider health timeline — in 4 waves.

**Decision.** Rebuild /dashboard/usage as **The Compass Deck** — four question-shaped decks (Overview='Where did the money go?', Analytics='Is it healthy?', Requests='What happened?', Accounts & Limits='What are my limits?') crowned by the Observatory's spatial soul (functional kame topology on Overview Row B, chart inventory, server-paginated ledger, SQL aggregation layer). Backed by migration 008 (latencyMs/ttftMs/httpStatus/statusClass + composite indexes + usageDaily rollup extension), a 7-function twin-parity aggregation layer, and the identifier covenant.

**Alternatives rejected.** Observatory-as-hull (failed its own tie-break + reuse scrutiny — Tidebreaker REFUTED); Manifest Deck ledger-default (auditability-first but hostile first impression, sparse-telemetry exposure); Lookout answers-first (insight engine hardest software, trust economy brutal); Helm Deck power console (i18n/hotkey load, austere); do-nothing (permanent debt).

**Consequences.** Easier: onboarding, acceptance testing, audit, export, failure hunting, twin-parity discipline. Harder: heaviest W2, growing twin-parity surface, four-question IA freezes future dimensions, approximate long-window percentiles. Carried: half-empty launch week (honesty), motion discipline, residual CSRF-export (bounded).

## Implementation Blueprint

### W1 THE TELESCOPE (no UI)
1. `src/lib/db/migrations/008-usage-telemetry.js` — latencyMs/ttftMs/httpStatus/statusClass columns; composite idx_uh_ts_provider, idx_uh_ts_keyId, idx_uh_ts_status, **idx_uh_ts_latency(timestamp, latencyMs)**; statusClass backfill in 10k chunks; usageDaily gains statusByProvider + latencyBuckets (log-scale buckets). Register in migrations/index.js; SCHEMA_VERSION 7→8; mirror schema.js.
2. `src/lib/usageStatus.js` — STATUS_NORMALIZATION_MAP (ok/success→ok; httpStatus-derived: 4xx→client_error, 429→rate_limited, 5xx→upstream_error; timeout→timeout; bare `error`→upstream_error default); consumed by writer + backfill + UI. **gateway_error DROPPED (Tidebreaker Gate-14):** `rejectionReason` is a phantom — zero occurrences repo-wide outside plan files, and gateway rejections (keyGate stage failures) never reach saveRequestUsage (usage rows are written only on completed usage). Recorded telemetry gap: gateway rejections stay unobserved in usageHistory; ErrorMix covers completed requests, and a rejection write-path is future work if that wedge is ever wanted.
3. Hot-path instrumentation in open-sse/handlers/chatCore.js — ttftMs at first upstream SSE byte (plumbing: measurement already exists at chatCore.js:62 + streamingHandler.js:116-118), latencyMs + httpStatus at completion. **RTK savings funded precisely (Tidebreaker Gate-14):** compressMessages (rtk/index.js) returns {bytesBefore, bytesAfter, hits} — BYTES, not tokens; tokensSavedEst exists only in pxpipe.js (chars/4 estimate). Write-time contract: meta.rtk = {bytesSaved, tokensSavedEst}; aggregation derives rtkSavedTokens = pxpipe.tokensSavedEst when present, else floor(bytesSaved/4), ALWAYS labeled estimated. RTK Savings $ = rtkSavedTokens × the request's own model input rate via the pricing chain at write time (same resolver as cost); '—' when the model is unpriceable. Fail-open throughout: absent → NULL → KPI shows honest zero/estimate marker.
4. Aggregation layer — 7 fns in repos/usageRepo.js facade with sqlite+mysql twins: getFilteredSeries, getBreakdown, getPercentiles, getProviderHealthFrame, getKpis, getLedgerRows, getExportCursor. **Identifier covenant** (frozen const maps SORTABLE_COLUMNS/DIMENSIONS/GRANULARITIES/METRICS, allow-list before interpolation, 400 on unknown). Extend bind.js USAGE_WAVE_NAMES + facade exports + parity census pin.
5. `src/lib/db/usageNames.js` — shared enrichment (connectionMap/providerNodeNameMap/apiKeyMap), one copy.
6. Percentiles: ≤3d exact (window range-scan + single materialization, 3 OFFSET walks); 7d+ histogram from latencyBuckets (pre-008 days excluded, meta {approximate, coverage}). Plan-B: cached-COUNT + covering-index.
7. SSE: perProvider frame memoized ≤30s; full-stats coalesced ≥15s shared cadence; quickStats carries cached perProvider.
8. Benchmark ritual: seeded 100k bursty rows, N≥11 after 2 warmups, p95 from sample; covers all 7 fns explicitly (getFilteredSeries, getBreakdown, getPercentiles, getProviderHealthFrame, getKpis, getLedgerRows, getExportCursor) + concurrent-write smoke; SQLite mandatory, MySQL SKIP-LOUD, sql.js labeled; miss → 'target, unproven'.
9. Tests: migration chain, status map, parity rows per fn, golden-value 3d/7d seam, rollup-writer canary, chatCore fake-SSE instrumentation, **identifier-covenant 400-rejection tests per frozen map (both twins)** (phase13 obligation); all registered in tests/__baseline__ scope — regression judged via verify-no-regression.mjs, never raw green (the repo baseline is intentionally not all-green).

### W2 THE COCKPIT (two sub-stages)
**(a) Decompose, zero behavior change:** extract useUsageStream() from UsageStats.js; rehome children; old page intact; baseline green. Own reviewable commit.
**(b) Build decks:** page chrome (header + tab rail + Needle bar + honesty strip); useCompassFilters (URL single source, FACETS constancy, dormant-facet round-trip, auto-granularity today/24h→1h · 7d→1d · 30d/60d→1d); t(key, params) helper with lookupLiteral + data-i18n-skip.
- Overview: KPI row (6 cards, deltas) → ProviderTopology Row B (halos=perProvider error rate, particles=throughput, click-to-filter) + Live Feed rail → TrafficStackedArea + CostArea → TopProviders/TopModels/StatusDonut → Top Spenders table.
- Analytics: compact topology pulse + 3 live tiles → LatencyLines, ErrorMix, CacheShare, CostPerMtok, UsageByKey, RtkSavings panels (ChartPanel chrome, 'collecting since' honesty).
- Requests: server-paginated ledger (keyset pagination, sortable, drawer w/ redaction, keyboard ↑↓/Enter///f, 'N new' pill, CSV).
- Accounts & Limits: absorbs /dashboard/quota (301 redirect, sidebar nav update); QuotaTable + per-key usage + budget bars (W3); period facet dropped (dormant).
- Metrics REST API behind dashboardGuard (reads PROTECTED_API_PATHS, export ALWAYS_PROTECTED + throttling + CSV safety).
- Security verification tests (phase13 obligations, allocated here): CSV =,+,-,@-padding test; concurrent-export rejection test; drawer redaction-inheritance test (matches /api/usage/request-details redaction).
- i18n: ≤40 literals, 34 locales, 4 anchor question-strings.
- Visual verification protocol: 4 breakpoints + RTL + keyboard nav + non-en locale, evidence in plans/mirror-usage-observatory/verification/.

### W3 GOVERNANCE
Budget engine (extends keyGate spend stage via getUsageDailySince + quotaRepo forged here; scopes gateway|key|model, windows day|week|month, 50/80/100 soft + hard cap distinct 429); alert channels (dashboard banner, Discord webhook, n8n webhook) with hysteresis + dedupe; weekly digest; compare-periods lands (CASE WHEN double-range + ghost overlay + Δ columns).

### W4 EXPERIMENTAL
Saved views (**migration 009** usage_views table + schema.js mirror + SCHEMA_VERSION bump, posture-bound, ALWAYS_PROTECTED write endpoint); auto-insights (Lookout signal registry: threshold + attribution + i18n template + evidence deep-link, column-guards, quiet-state); request tags (≤64 chars, charset allow-list, parameterized endpoint, escape-on-render + CSV); provider health timeline strips; ⌘K palette (banked stretch).

## Decision Log
| # | Decision | Why | Rejected |
|-|-|-|-|
| 1 | Compass hull (4 question decks) | Won corrected scoring (4.74) + rubric tie-break; onboarding = tab strip | Observatory hull (refuted), Manifest, Lookout, Helm |
| 2 | Topology on Overview Row B, functional | Pre-attentive failure hunting; signature visual becomes load-bearing | Analytics-only, decorative |
| 3 | Breakdown centralized by metric | No duplication; facets endpoint shared | Per-deck duplication |
| 4 | SQL-side aggregation + rollup extension | O(rows)-per-SSE-event dies at 100k | Client-side grouping (status quo) |
| 5 | Two-tier percentiles (exact ≤3d, histogram 7d+) | Zero new deps; index-backed; labeled approximation | Window functions (parity pain), t-digest (dependency) |
| 6 | Compare-periods in W3 | W2 already maximum scope (Star accepted) | W2 (drowns cockpit) |
| 7 | 40-literal i18n cap + t() helper | 34-locale obligation is wave-sinking otherwise | Uncapped bespoke copy |
| 8 | Server-paginated keyset ledger | Full audit trail scales; OFFSET degrades | 200-row ring buffer, LIMIT/OFFSET-deep |
| 9 | Export ALWAYS_PROTECTED; reads posture-consistent | Unbounded-stream surface escalates; reads match 10 existing routes (Gate-11 answered) | All-reads escalation, none |
| 10 | UI verification = 4-breakpoint visual protocol | Repo has no jsdom; proven mechanism (HomePageClient precedent); jsdom banked as recorded debt | jsdom now (infra investment), nothing (invisible debt) |

## Verification Record
- Gate 4 (frame): Tidebreaker REVISE → 4 waves accepted by Star
- Gate 6 (curation): Tidebreaker REFUTED Observatory-hull → reforged to Compass hull, Star passed
- Gate 8 (trade-offs): Star accepted bundle; compare-periods held in W3
- Gate 9 (scoring): 5 arbiters → 4.2; Tidebreaker challenge → corrected 4.1 (Testability 3.5); Star chose Refine
- Gate 11 (refinement): 33 repairs + 3 findings woven (R1–R10); Star passed
- Gate 14 (this seal): Tidebreaker **SEALED-BROKEN** (3 SERIOUS: phantom rejectionReason/gateway_error; RTK bytes-vs-tokens unfunded conversion; phase13's 4 tests unallocated) → all three repaired in this document + NOISE absorbed (7-fn benchmark list, migration 009 line, baseline-wording) → Star's word given: "Seal the plan" (2026-08-16) — SEALED

## Connected
[[2026-08-16-mirror-usage-observatory]] · phase6-selection-v2 · phase7-deep-dive · phase8-tradeoffs · phase9-scoring · phase10-refinement · phase12-risks · phase13-security
