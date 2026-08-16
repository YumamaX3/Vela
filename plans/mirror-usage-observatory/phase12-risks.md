# Phase 12 — Risk Storm: The Compass Deck

Every wave stormed. Risks ranked likelihood × impact (L/I, 1-5). All carry mitigations; none are accepted silently.

## W1 THE TELESCOPE — telemetry wave

| # | Risk | L | I | Mitigation |
|-|-|-|-|-|
| W1-1 | **Twin-parity drift** — 7 aggregation fns × 2 dialects; SQLite/MySQL divergence in time-bucketing, integer division, OFFSET semantics surfaces late | 4 | 4 | sqlite-first porting + dialect-diff checklist + one READ-side parity row per function as it lands (R10); census pin in harness fails loud |
| W1-2 | **MySQL percentile miss** — large OFFSET is MySQL's known weak spot at 100k rows | 3 | 3 | Plan-B pre-built (cached-COUNT + covering-index swap, R3); honest downgrade path documented |
| W1-3 | **Backfill lock storm** — statusClass UPDATE over large history takes multi-second exclusive write (SQLite) / non-instant index builds (MySQL) | 3 | 4 | 10k-row batched chunks with progress (R9); runs behind migrate.js's pre-migration backup; duration recorded for both engines |
| W1-4 | **Instrumentation fails hot path** — ttftMs/latencyMs/httpStatus capture throws inside chatCore request loop | 2 | 5 | Fail-open covenant (measurement wrapped, never throws; NULL on absence); RTK savings follow existing fail-open precedent; mocked SSE tests assert fail-open NULL case |
| W1-5 | **Benchmark ritual skipped** — no CI enforces it; p95 claim rots | 3 | 2 | Spoken truth: dev-time ritual with machine-readable 'target, unproven' downgrade (R6); CI job recorded as explicit debt |

## W2 THE COCKPIT — heaviest wave

| # | Risk | L | I | Mitigation |
|-|-|-|-|-|
| W2-1 | **Decomposition couples with rebuild** — UsageStats.js teardown and 4-deck build entangle; regression slips through | 4 | 4 | W2 split into sub-stages: (a) decompose with ZERO behavior change as own reviewable commit + green baseline, THEN (b) build decks (R10) |
| W2-2 | **i18n drowns the wave** — 34 locales × new strings exceed budget | 3 | 4 | Hard 40-literal cap; ChartPanel shared label set; t() wrapper counted honestly (R2); per-deck gating |
| W2-3 | **t() × walker collision regresses** — interpolated nodes re-translated or missed in 33 non-en locales | 3 | 3 | data-i18n-skip + lookupLiteral accessor + one node-environment test (R2); 4-breakpoint visual pass includes a non-en locale |
| W2-4 | **Keyboard nav a11y liability** — focus traps, screen-reader flow broken | 3 | 3 | Focus discipline mandated; built carefully or not at all; 4-breakpoint protocol exercises ↑↓/Enter///f via interact_press |
| W2-5 | **SSE render churn survives** — 12 panels re-render per tick despite memo | 3 | 3 | Server-side coalescing ≥15s shared cadence (R5) + perProvider memo ≤30s + client throttles + React.memo keyed by data hash; verified in visual protocol |
| W2-6 | **Bundle weight** — xyflow + 12 Recharts panels slow first paint | 3 | 3 | Dynamic import per deck; feature flags per tab; topology chunk lazy |

## W3 GOVERNANCE

| # | Risk | L | I | Mitigation |
|-|-|-|-|-|
| W3-1 | **Budget check slows dispatch** — hot-path budget check adds latency to every request | 3 | 4 | Check reads getUsageDailySince (frozen contract, already in keyGate spend stage); memoized; only hard-cap blocks dispatch |
| W3-2 | **Alert fatigue** — Discord/n8n webhooks fire too often → ignored | 3 | 3 | Thresholds 50/80/100 with hysteresis; digest batches non-critical; per-channel dedupe window |
| W3-3 | **Compare-periods double-range cost** — CASE WHEN scans two windows | 2 | 2 | ≤30s server memo (R9); rollup-served for 7d+ |

## W4 EXPERIMENTAL

| # | Risk | L | I | Mitigation |
|-|-|-|-|-|
| W4-1 | **Insight false alarms** — signal registry thresholds misfire → wallpaper | 3 | 3 | Column-guards ship signals dormant; quiet-state builds trust; evidence deep-links make every claim falsifiable; thresholds tunable in settings |
| W4-2 | **Request tags injection** — user-controlled string reaches storage + UI + export | 2 | 4 | Spec'd now (R8): ≤64 chars, charset allow-list, parameterized endpoint, HTML-escape-on-render, CSV-escape inclusion |
| W4-3 | **Scope creep beyond 4 waves** — banked ideas (palette, hotkeys, saved views) balloon | 3 | 2 | Banked list is the boundary; each needs its own gate; anti-slop discipline at every PR |

## Cross-wave risks

| # | Risk | L | I | Mitigation |
|-|-|-|-|-|
| X-1 | **Launch-week honesty dulls debut** — latency/TTFT/RTK panels show 'collecting since' | 5 | 1 | Accepted — deception costs more; honesty states are the design working as intended |
| X-2 | **Migration 008 breaks backup/restore** — new columns in-flight during sealed backup | 2 | 4 | Backup engine is schema-agnostic dump; migration runs behind pre-migration backup; restore drill covers new schema |
| X-3 | **Mirror posture divergence on new columns** — outbox replay misses statusClass backfill | 2 | 3 | Backfill is a migration (replayed by mirror bootstrap); divergence sweep covers usageHistory; parity tests include mirror mode |
| X-4 | **Feature-flag complexity** — per-tab flags create combinatorial states | 2 | 2 | Flags default-on after each tab's visual protocol passes; flags removed at ceremony seal |

**Highest risks**: W2-1 (decomposition coupling) and W1-1 (twin-parity drift) — both mitigated by sequencing discipline (sub-stages, sqlite-first porting). No risk is unmitigated; no wave is blocked.
