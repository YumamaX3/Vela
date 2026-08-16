# Phase 9 — Independent Scoring: The Arbiters' Verdict

Five independent `the-arbiter` judges scored the Compass Deck in parallel (Workflow wf_adb5420a-11e, 2026-08-16).
**Composite: 4.2 / 5** — no dimension below 3; refinement (not rescue) is the posture.

| Dimension | Score | Verdict in one breath |
|-|-|-|
| Architecture | **4.5** | Extends proven patterns (bind.js facade, dual-path getUsageStats, migration registry); 6 seams unaddressed |
| Testability | **4.0** | Data layer is among the most testable work planned; client layer has NO verification path |
| Performance | **4.0** | Correct diagnosis (O(rows)-per-SSE-event path killed); 8 mechanism gaps incl. index contradiction |
| Security | **4.0** | Guard coverage correct by construction (/api/usage prefix + ALWAYS_PROTECTED export); identifier-injection + CSV-formula + export-DoS unlegislated |
| Feasibility | **4.5** | Nearly every load-bearing element already exists (TTFT already measured in chatCore/streamingHandler); W2 coupling is the residual risk |

## Tidebreaker challenge on the three 4.0s — VERDICT: SCORES-INFLATED

| Dimension | Arbiter | Tidebreaker | Finding |
|-|-|-|-|
| Testability | 4.0 | **3.5** | FATAL — half the design (W2 client layer) has no verification path; the repair declares the debt instead of paying it (an OR that commits to neither); t()×MutationObserver-walker collision untested |
| Performance | 4.0 | **4.0 conditional** | SERIOUS ×2 — perProvider on quickStats is pushed per `pending` event (per-event DB scan; coalescing/memo repairs don't cover it); benchmark "gate" has no CI to enforce it — call it a dev-time ritual or build the gate |
| Security | 4.0 | **4.0 deserved** | NOISE — probes verified: single-tenant (no new cross-key leak), React text-node escaping (no XSS), export asymmetry consistent with existing law, drawer redaction precedent real |

**Corrected composite: 4.1 / 5** — refinement remains the posture (nothing below 3).

Three new refinement items from the challenge:
1. **t(key, params) × walker collision**: the runtime walks DOM text nodes with exact-string lookup — an interpolated node (`collecting since 2026-08-16`) never matches the registered literal in the 33 non-en locales. Phase 10 must specify: `data-i18n-skip` on interpolated nodes (translate-then-interpolate in JS) + one node-environment test for the interaction.
2. **perProvider frame memo**: extend the ≤30s server memo/coalescing explicitly to `getProviderHealthFrame` (it scans usageHistory, not rollups — neither existing repair text covers it).
3. **Spoken truth about the benchmark**: no CI runs vitest and no root test script exists — the p95 gate is a local dev-time ritual with honest downgrade ("target, unproven") unless a CI job is added. Phase 10 names which.
Plus: Gate 11 (ALWAYS_PROTECTED for ledger reads under requireLogin=false) must be ANSWERED in the sealed plan, not carried forever. Constraint pinned: the XSS argument holds only while no `innerHTML` enters this page.

## Critical findings to repair in Phase 10

### Cross-dimension contradictions (FATAL-adjacent — must fix)
1. **Percentile index contradiction** (Arch-3, Perf-1): phase6 claims skip-scan on (timestamp, latencyMs); migration 008 declares single-column idx_uh_latency — useless for windowed percentile. FIX: composite idx_uh_ts_latency + honest mechanism (window range-scan + sort, single materialization for all three quantiles).
2. **Granularity/rollup contradiction** (Perf-2): auto-granularity 7d→6h cannot be served by daily rollups — the 'rollup at 7d+' claim is false for the most common chart. FIX: 7d→1d rollup-faithful default; sub-daily granularities scan history with row-budget; label source in meta.
3. **i18n interpolation gap** (Feas-2): runtime is pure exact-string lookup — 'collecting since {date}' assumes interpolation that doesn't exist. FIX: tiny t(key, params) helper, counted against the 40-literal budget.

### Architecture seams (Arch repairs)
- bind.js USAGE_WAVE_NAMES whitelist + facade exports + parity census pin for the 7 new aggregation functions
- shared enrichment layer (usageNames.js) — one copy of connectionMap/providerNodeNameMap/apiKeyMap
- phantom 'quotaRepo' → budget engine extends keyGate's spend stage (getUsageDailySince) + quotaRepo forged IN W3
- getPercentiles pre-008 contract: skip missing-bucket days, meta {approximate, coverage}
- facet round-trip rule: dropped facets stay dormant in URL

### Performance hardening (Perf repairs)
- server-side coalescing of full-stats recompute (≥10-30s cadence), not just client throttles
- benchmark gate widened: getFilteredSeries, getLedgerRows, getProviderHealthFrame; driver-qualified (sql.js labeled); bursty distribution; N≥11 runs after 2 warmups
- ledger → keyset pagination (WHERE id < ? ORDER BY id DESC), cached/estimated total
- migration 008 backfill batched (10k chunks) with lock budget
- ≤30s server memo for rollup-served metrics; 4-6d window seam specified

### Security legislation (Sec repairs)
- **Identifier covenant**: frozen const maps (SORTABLE_COLUMNS, DIMENSIONS, GRANULARITIES, METRICS), allow-list before any interpolation, 400 on unknown — both twins inherit
- CSV safety: quote all cells, prefix-pad =,+,-,@ cells, Content-Disposition: attachment, row cap with truncation note
- export/metrics throttling: 1 concurrent export, timeout, coarse rate limit
- request tags spec'd NOW for W4: TEXT ≤64 chars, charset allow-list, parameterized named endpoint, CSV-escape inclusion
- 'q' filter: parameterized LIKE, %/_ escaped, 100-char cap
- Drawer inherits request-details payload redaction (explicit one-liner)
- Gate-11 question carried: should ledger/breakdown reads join export in ALWAYS_PROTECTED under requireLogin=false?

### Testability obligations (Test repairs)
- benchmark methodology pinned (N≥11, warmup 2, seeded deterministic dataset; SQLite mandatory, MySQL SKIP-LOUD)
- UI verification posture DECLARED (jsdom + @testing-library in W2, or formal manual 4-breakpoint checklist + banked component tests) — debt recorded, not invisible
- every new test registered in verify-no-regression.mjs scope; intentional red → known-fails.txt
- golden-value seam test at 3d/7d percentile boundary
- rollup-writer canary test (telemetry day → non-empty statusByProvider/latencyBuckets)
- chatCore instrumentation: fake SSE + vi.spyOn(performance) assertions
- parity harness extended with READ-side aggregate parity rows
