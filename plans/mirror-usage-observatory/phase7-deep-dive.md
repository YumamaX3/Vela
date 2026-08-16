# Phase 7 — Deep Dive: The Compass Deck (Usage Observatory Redesign)

> **SUPERSEDED where conflicts exist** by SEALED-PLAN.md + phase10-refinement.md (Gate 14 seal, 2026-08-16). Specifically: the `gateway_error`/`rejectionReason` map entry and the `meta.rtkSavedTokens` contract below were revised at Gate 14 — the sealed plan's funding is authoritative.

Selection v2 (Gate 6 passed 2026-08-16): **The Compass Deck crowned by the Observatory's spatial soul.**
Hull = Compass (question-shaped IA). Grafts = Observatory (topology Row B, chart inventory, server-paginated ledger, SQL aggregation layer), Manifest (honesty strip, keyboard ergonomics), Lookout/Helm (banked W4).

Adjudications sealed: topology greets Overview Row B (functional); provider breakdown centralized by metric (Overview owns provider×spend, Analytics owns provider×status + provider×latency).

---

## W1 THE TELESCOPE — telemetry, no UI

### Migration 008 (`src/lib/db/migrations/008-usage-telemetry.js`)
`{ version: 8, name: "usage telemetry + composite indexes", up(db) }`, appended to migrations/index.js, SCHEMA_VERSION 7→8, mirrored in schema.js columns/indexes for fresh installs (auto-sync heals).

New columns on usageHistory (all idempotent — check pragma/information_schema before ALTER):
- `latencyMs INTEGER` — wall time from dispatch to upstream completion (NULL pre-instrumentation)
- `ttftMs INTEGER` — time to first upstream SSE byte (NULL when non-streaming)
- `httpStatus INTEGER` — upstream HTTP status (NULL when request never reached upstream)
- `statusClass TEXT DEFAULT ''` — normalized: `ok` | `client_error` | `upstream_error` | `timeout` | `rate_limited` | `gateway_error` | `''` (unknown). Derived at write-time from httpStatus+error shape; backfill: existing status values mapped via STATUS_NORMALIZATION_MAP (`ok`/`success`→ok, `error`→upstream_error default, rejectionReason-bearing→gateway_error).

New composite indexes (both engines, IF NOT EXISTS):
- `idx_uh_ts_provider ON usageHistory(timestamp, provider)`
- `idx_uh_ts_keyId ON usageHistory(timestamp, keyId)`
- `idx_uh_ts_status ON usageHistory(timestamp, statusClass)`
- `idx_uh_latency ON usageHistory(latencyMs)` — for percentile skip-scan on recent windows

usageDaily rollup extension (no schema change — JSON shape grows): each day's `data` gains `statusByProvider: {provider: {ok, errors}}` and `latencyBuckets: {provider: {b0..bN}}` (fixed log-scale buckets: <100ms, 100-250, 250-500, 500-1s, 1-2.5s, 2.5-5s, >5s). Written by the existing daily-rollup writer at request time (fail-open: missing fields default empty).

Parity covenant: every new column/index declared in BOTH repos/sqlite and repos/mysql; parity test rows added to the existing harness; backup engine unchanged (schema-agnostic dump).

### Hot-path instrumentation (`open-sse/handlers/chatCore.js`)
- Capture `t0 = performance.now()` at dispatch; on first upstream SSE chunk → `ttftMs = performance.now() - t0`; on completion/error → `latencyMs`, `httpStatus` from upstream response.
- Write through `saveRequestUsage` (existing path) — new fields ride the same row write; fail-open: if measurement absent, columns stay NULL.
- RTK savings: `open-sse/rtk/` pre-translate hooks already compute tokens saved per `tool_result` — write `meta.rtkSavedTokens` (fail-open per RTK covenant, never throw).
- Status normalization: STATUS_NORMALIZATION_MAP lives in `src/lib/usageStatus.js` (new, shared by writer + backfill + UI); maps raw status strings + httpStatus to statusClass.

### Repository aggregation layer (`src/lib/db/repos/usageRepo.js` facades)
New functions, twin-parity (sqlite + mysql impls behind bind.js):
- `getFilteredSeries({filters, granularity, metric})` — GROUP BY time bucket over usageHistory (≤3d) or usageDaily rollup (7d+); returns [{t, value(s)}].
- `getBreakdown({filters, dimension})` — GROUP BY provider|model|keyId|endpoint with metric sums.
- `getPercentiles({filters})` — recent: exact skip-scan (`SELECT latencyMs ... ORDER BY latencyMs LIMIT 1 OFFSET floor(q·N)` after COUNT on indexed column, window ≤3d); long: histogram read from usageDaily latencyBuckets (approximate, bucket labeled).
- `getProviderHealthFrame(windowMs = 60000)` — per-provider rolling requests + error counts from usageHistory (statusClass != ok), single indexed range scan. **Funds the topology halos (Tidebreaker S1).**
- `getKpis({filters})` — one query: totals + previous-window totals (CASE WHEN double-range) → deltas.
- `getLedgerRows({filters, sort, page, pageSize})` — server-paginated (LIMIT/OFFSET on composite indexes) + total count.
- `getExportCursor(filters)` — streaming CSV row iterator, same WHERE-builder as metrics (export never disagrees with screen).

Existing `getUsageStats` survives as a thin adapter over these for zero regression (all current consumers unchanged).

### SSE contract (`/api/usage/stream`, additive)
- quickStats payload gains `perProvider` = getProviderHealthFrame() (per-provider 60s requests/errors).
- Consumers: topology halos, KPI live tile, Analytics live tiles.
- Render-churn contract (Tidebreaker S3): KPI/live tiles throttle quickStats ≥2s; charts subscribe to full stats at ≤60s or on-demand; all chart components React.memo keyed by data hash.

### Benchmark gate
Synthetic 100k rows → `getKpis` + `getPercentiles` + `getBreakdown` p95 < 300ms on SQLite AND MySQL twin. Miss → the perf claim is documented as "target, unproven" (honest), never faked.

---

## W2 THE COCKPIT — four question-shaped decks

### Page structure (`src/app/(dashboard)/dashboard/usage/`)
```
header row      — title + freshness stamp ('updated Ns ago' · tz) + live dot + CSV export
tab rail        — 4 bearings as SegmentedControl, ?tab=overview|analytics|requests|limits, arrow-key nav
Needle bar      — sticky global filter bar (below tab rail)
deck area       — lazy-loaded per tab with skeletons; feature-flagged per deck
honesty strip   — as-of · timezone · 'estimated' · dedupe-undercount ⓘ (Manifest graft)
```
Tab switch never clears filters — one URL state object rides across decks.

### Needle filter bar (`useCompassFilters` hook)
Single source of truth = URL params: `?tab&period&prov&model&key&status&q&gran`. Writes via router.replace({scroll:false}) — bookmarkable, no history spam. Auto-granularity derived from period (today/24h→1h, 7d→6h, 30d/60d→1d), overridable via `gran`.
FACETS config map — shared facets (period, provider, model, key) render same order/position on EVERY deck (constancy); per-deck adaptive facets appended:
- Overview appends cost-dimension group-by
- Analytics appends statusClass + latency threshold
- Requests appends status, min-latency, has-error, q search
- Limits drops the period facet entirely (honestly — limits don't respect time)

### Deck 1 — Overview 💰 "Where did the money go?"
1. KPI row (6 cards, delta-vs-previous-period, tabular-nums, 3-level type scale 24/11/12px): Requests · Est. Cost (~ prefix, $/Mtok subtext) · Input Tokens · Output Tokens · Cached Tokens · RTK Savings (~$ estimated)
2. **Row B — ProviderTopology** (Observatory graft): kame particles encode throughput, error halos encode perProvider error rate (S1 channel), click-to-filter. Flanked by Live Feed rail (last-8 requests via SSE, pause-on-hover).
3. Row C — TrafficStackedArea (requests/cost by provider, top-6 + Other) with click-to-filter; CostArea carries compare-ghost slot (W3).
4. Row D — TopProviders bars · TopModels bars · StatusMix donut (slice → Requests pre-filtered).
5. Row E — Top Spenders table (UsageTable.js reused, localStorage expansion kept).

### Deck 2 — Analytics 🩺 "Is it healthy?"
ProviderTopology moves to a compact live pulse header (3 live tiles: error rate, p95 latency, active now — from perProvider channel). Panels (ChartPanel chrome, 2-up desktop/1-up mobile):
- LatencyLines (p50/p95/p99 + TTFT toggle) — needs 008; 'collecting since <date>' until accrued
- ErrorMix stacked bars by statusClass — needs 008
- CacheShare + estimated savings area
- CostPerMtok bars by model
- UsageByKey stacked area
- RtkSavings area
- HealthTimeline strips (CSS grid, W4)

### Deck 3 — Requests 📜 "What happened?"
RequestDetailsTab → **server-paginated ledger** (Observatory graft): SQL LIMIT/OFFSET, global-filter chips + local extras, sortable columns (time, provider, model, key, tokens in/out/cache, latency, TTFT, status, cost, RTK saved), Drawer row detail, **keyboard nav ↑↓/Enter///f with focus discipline** (Manifest graft), 'N new requests' pill (no reflow), CSV honoring filters.

### Deck 4 — Accounts & Limits ⚖️ "What are my limits?"
Absorbs /dashboard/quota (301 redirect stub; sidebar line 40 nav updated):
- QuotaTable (reused verbatim, emoji statuses + countdowns)
- per-key usage table from /api/keys/usage with bars
- Budget summary burn bars (W3 hierarchy: gateway→key→model, multi-window, 50/80/100 soft thresholds)
- Period facet DROPPED (honesty — limits don't respect time)

### UsageStats.js decomposition (537-line orchestrator dies)
Extract SSE subscription → `useUsageStream()` hook; rehome children (OverviewCards → KpiRow, UsageChart, UsageTable, RequestDetailsTab, ProviderTopology) into deck tree. The inverted-dependency debt is paid here.

### Metrics REST API (behind dashboardGuard)
GET /api/usage/metrics/kpis|timeseries|breakdown|percentiles|ledger|export — all over the W1 aggregation layer, JWT-protected (ALWAYS_PROTECTED for export; PROTECTED_API_PATHS for reads). Every response carries meta {estimated, dedupeUndercount, tz, asOf}.

### i18n budget (hard cap — Tidebreaker S4)
≤40 new literals (~1,360 entries across 34 locales). ChartPanel shares ONE label set; tooltips compose from number primitives + metric labels; ONE shared empty-state; ONE templated 'collecting since {date}'; 4 anchor question-strings seed all locales.

---

## W3 GOVERNANCE
- Budget engine: scopes gateway|key|model, windows day|week|month, thresholds 50/80/100 soft + hard cap (distinct 429 code). Hot-path check before dispatch; quotaRepo history sampler.
- Alert channels: dashboard banner (reserved slot in header) + Discord webhook + n8n webhook; weekly digest cron.
- Compare-periods lands here (CASE WHEN double-range deltas; ghost overlay on CostArea; Δ columns).

## W4 EXPERIMENTAL
- Saved views (usage_views table, posture-bound; named URL-state snapshots; ⌘K palette as fast URL writer)
- Auto-insights: Lookout signal registry (threshold + attribution + i18n template id + evidence deep-link; column-guards; quiet-state)
- Request tags (column + filter in Requests)
- Provider health timeline strips
- Hotkeys 1-4 deck switch (input-focus guard)

---

## Failure modes & degradation
- Pre-telemetry (launch week): latency/TTFT/RTK panels show 'collecting since <date>' — never faked.
- SSE disconnect: backoff reconnect → 60s polling fallback after 2 failures.
- prefers-reduced-motion: particles/pulses still; counts still update.
- MySQL twin unavailable (mirror): SQLite serves; divergence sweep reconciles; honesty strip shows posture.
- Empty budget/history: quiet-state cards, not zeros.
