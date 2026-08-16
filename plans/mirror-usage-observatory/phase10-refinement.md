# Phase 10 — Refinement: The Compass Deck in Final Form

Every arbiter repair + every Tidebreaker challenge woven in. This supersedes phase7-deep-dive.md where they conflict.

## R1 — Testability posture DECLARED and PAID (closes the 3.5)
The OR is resolved — **formal visual-verification protocol with recorded evidence** (the mechanism this repo has proven before: HomePageClient 4-breakpoint verification):
- At each deck's ship, run the **4-breakpoint checklist** (320/768/1024/1440 + RTL pass + 375px focus) through the Lighthouse browser (Steel CDP): screenshots captured, keyboard nav exercised (↑↓/Enter///f via interact_press), URL-state round-trips clicked through, 'N new requests' pill observed, skeletons/empty states forced.
- Evidence lands in `plans/mirror-usage-observatory/verification/` (screenshots + checklist results) — the debt is paid in artifacts, not promises.
- **jsdom + @testing-library is BANKED** as an explicit W4+ investment (recorded debt, not invisible): component tests for useCompassFilters, tab switching, keyboard nav land when the infra exists.
- Every new W1 test file registers in `tests/__baseline__/verify-no-regression.mjs` scope; any intentional red catalogued in known-fails.txt (CLAUDE.md mandate).

## R2 — t(key, params) × walker collision RESOLVED
- runtime.js gains one exported accessor: `lookupLiteral(text)` (exact-map lookup, no DOM).
- `t(key, params)` = lookupLiteral(key) → substitute {date}/{n} AFTER lookup → render with `data-i18n-skip` so the MutationObserver walker never re-translates interpolated nodes.
- 'collecting since {date}' registered as one literal; the wrapper counts against the 40-literal budget honestly.
- One node-environment test: lookup hit, substitution, miss-fallback (returns key).

## R3 — Percentile mechanism CORRECTED (cross-phase contradiction killed)
- Migration 008 declares **composite `idx_uh_ts_latency ON usageHistory(timestamp, latencyMs)`** (single-column idx_uh_latency dropped).
- Mechanism stated honestly: recent windows (≤3d) = window range-scan + single materialization, three OFFSET walks for p50/p95/p99 (O(window log window) regardless of quantile count).
- **Plan-B pre-built**: cached-COUNT + covering-index variant named as the swap if the MySQL twin misses the benchmark (large OFFSET is MySQL's known weak spot).
- Long windows (7d+): usageDaily latencyBuckets histogram; **pre-008 contract**: days lacking buckets are excluded, meta carries `{approximate: true, coverage: 'N of M days'}` — honesty strip and percentile label draw from the same truth.

## R4 — Granularity/rollup contradiction CORRECTED
- Auto-granularity: today/24h→1h, 7d→**1d**, 30d/60d→1d (rollup-faithful). Sub-daily granularities (manual override) always scan usageHistory with a row-budget check.
- **4–6d seam specified**: windows >3d and <7d scan history (labeled). `getFilteredSeries` meta carries `{source: 'history'|'rollup'}` for the honesty strip.

## R5 — perProvider frame FUNDED and MEMOIZED (Tidebreaker SERIOUS)
- `getProviderHealthFrame` result cached server-side, TTL ≤30s.
- `sendPending` consumes the CACHED frame — never a per-event DB scan.
- Full-stats recompute coalesced server-side to a ≥15s shared cadence (one recompute shared across all SSE connections), with client-side throttles (≥2s quickStats, ≤60s charts) as the second layer.

## R6 — Benchmark honesty (a ritual, not a phantom gate)
No CI runs vitest and no root test script exists — spoken truth: the p95<300ms@100k check is a **W1 dev-time benchmark ritual**, not a CI gate (CI job recorded as explicit debt):
- Seeded deterministic 100k rows (bursty distribution), N≥11 timed runs after 2 warmups, p95 from sample.
- Covers getKpis, getPercentiles, getBreakdown, **getFilteredSeries (7d/1d + 30d/1d), getLedgerRows (deep page + count), getProviderHealthFrame** — plus a concurrent-write smoke (sustained saveRequestUsage traffic during reads, proving the extended rollup writer under load).
- SQLite leg mandatory; MySQL leg SKIP-LOUD behind VELA_TEST_MYSQL_URL; driver-qualified (better-sqlite3/bun:sqlite PASS, sql.js measured-and-labeled).
- Miss → claim downgrades to 'target, unproven' in docs, machine-readable note in the test output.

## R7 — Architecture seams CLOSED
- **bind.js**: USAGE_WAVE_NAMES extended with the 7 new aggregation names; facade export lines added to repos/usageRepo.js; function census pinned in the parity harness (twin drift fails loud).
- **usageNames.js** (new shared enrichment layer): connectionMap/providerNodeNameMap/apiKeyMap resolution — ONE copy, consumed by both twins' getBreakdown/getLedgerRows and the surviving getUsageStats adapter. Engines stay pure SQL.
- **quotaRepo**: forged IN W3 (does not exist today — naming corrected). Budget engine extends keyGate's spend stage (already summed through the frozen getUsageDailySince contract).
- **Facet round-trip rule**: dropped facets stay DORMANT in the URL — period survives a Limits visit and restores on return. One sentence in useCompassFilters; saved-view snapshots stay total.

## R8 — Security legislation SEALED
- **Identifier covenant** (W1, both twins inherit): frozen const maps SORTABLE_COLUMNS / DIMENSIONS / GRANULARITIES / METRICS; allow-list lookup before ANY interpolation; unknown → 400. Never interpolate, only map-to-literal.
- **CSV safety**: quote all cells; prefix-pad cells starting =,+,-,@ (or tab/CR) with a leading tab; `Content-Disposition: attachment` fixed filename; row cap honoring the filter window with an honest truncation note in the final row.
- **Throttling**: max 1 concurrent export per session; request timeout; coarse rate limit on /api/usage/metrics/* (the guard authenticates; it never throttles — now something does).
- **Request tags (W4, spec'd NOW)**: TEXT ≤64 chars, charset allow-list, parameterized named write endpoint, HTML-escape-on-render, included in the CSV escaping rule.
- **'q' filter**: parameterized LIKE over fixed columns, %/_ escaped, 100-char cap.
- **Drawer**: inherits request/response payload redaction of /api/usage/request-details (one-liner, precedent verified in code).
- **Constraint pinned**: the XSS-safety argument holds only while no `innerHTML` enters this page — recorded as a review rule for every deck PR.
- **Gate-11 ANSWERED (no longer carried)**: ledger/breakdown reads stay PROTECTED_API_PATHS (not ALWAYS_PROTECTED) — consistent with the ten existing usage routes and the ship's law (settingsDefaults pins requireLogin=true); only export escalates, because export is unbounded-stream + format-conversion surface. The asymmetry protects where it matters and stays posture-consistent everywhere else.

## R9 — Ledger + backfill hardening
- **Keyset pagination**: `WHERE id < ? ORDER BY id DESC LIMIT n` with cached/estimated total; OFFSET retained only for the first few pages (jump-to-page).
- **Migration 008 backfill**: statusClass UPDATE batched in 10k-row chunks with progress, behind the migration backup migrate.js already takes; MySQL twin records ALGORITHM=INSTANT column adds vs non-instant index builds.
- **≤30s server memo** for rollup-served metrics keyed by normalized filter object (insurance for W3 compare-periods double-range + deck revisits).

## R10 — Feasibility sequencing
- **W2 split into two sub-stages**: (a) decompose UsageStats.js → useUsageStream() + rehomed children with ZERO behavior change (its own reviewable commit, old page intact, regression baseline green), THEN (b) build the four decks on top. Never decompose and rebuild simultaneously.
- **sqlite-first porting**: each aggregation function lands sqlite first, then ports to mysql with a dialect-diff checklist (integer division, time-bucket expressions, OFFSET semantics), one READ-side parity row per function as it lands (parity harness extended: getKpis/getBreakdown/getFilteredSeries/getLedgerRows blind on both seeded worlds, canon-compared).
- **Golden-value seam test**: rows spanning the 3d boundary — exact values below, labeled-bucket values above, including a case where the answers visibly differ (labeling proven load-bearing).
- **Rollup-writer canary**: seed a telemetry day → assert statusByProvider/latencyBuckets non-empty (distinguishes live writer from fail-open emptiness).
- **chatCore instrumentation tests**: fake SSE source + vi.spyOn(performance) asserting ttftMs ≈ first-chunk delta, httpStatus on error path, fail-open NULL case (TTFT measurement already exists at chatCore.js:62 + streamingHandler.js:116-118 — W1 is plumbing, not new machinery).

## Refinement tally
| Source | Items | Status |
|-|-|-|
| Arbiter Architecture repairs | 6 | all woven (R3, R7) |
| Arbiter Performance repairs | 8 | all woven (R4, R5, R6, R9) |
| Arbiter Security repairs | 7 | all woven (R8) |
| Arbiter Testability repairs | 7 | all woven (R1, R2, R6, R10) |
| Arbiter Feasibility repairs | 5 | all woven (R2, R3, R6, R10) |
| Tidebreaker FATAL (Testability 3.5) | 1 | paid — posture chosen, evidence protocol, walker collision fixed (R1, R2) |
| Tidebreaker SERIOUS ×2 (Performance) | 2 | woven (R5, R6) |
| Gate-11 carried question | 1 | ANSWERED in R8 |

**No repair left unaddressed. No OR left unresolved. The design stands in its strongest form.**
