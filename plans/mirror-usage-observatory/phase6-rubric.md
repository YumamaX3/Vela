# Phase 6 — Approach Curation Rubric (Usage Observatory)

Weighs each of the five divergent approaches against the Gate 4 frame.
Score each dimension 1–5; weight reflects the Star's Full-Observatory decree.
Top approach wins; runner-up's strongest ideas bank for Phase 10 refinement.

## Dimensions & weights

| # | Dimension | Wt | 5 means |
|-|-|-|-|
| 1 | **Criteria coverage** — how many of the 15 success criteria the IA naturally supports without contortion | 20% | ≥13 cleanly |
| 2 | **Telemetry honesty** — does it respect W1 reality (200-row latency window, contaminated TTFT, no-429-counts, estimated-cost labels)? | 15% | Surfaces honesty as design, not footnote |
| 3 | **Reuse ratio** — components/APIs reused vs rebuilt (OverviewCards, UsageTable, ProviderTopology, QuotaTable, all /api/usage/*) | 15% | ≥70% reused |
| 4 | **Operator clarity** — answers "where did the money go / is it healthy / what happened / what are my limits" in seconds | 15% | One-glance answers |
| 5 | **Filter-system fit** — one global URL-state filter bar driving all decks + chart→ledger click-to-filter | 10% | Natural, not bolted |
| 6 | **Performance posture** — survives SQL-side aggregation + 100k rows + SSE without jank; lazy decks | 10% | Designed for the perf budget |
| 7 | **Oracle fidelity** — builds joy, doesn't perform trend (no slop: purple/Inter/triptych/glass) | 8% | Warm, restrained, Vela-brand |
| 8 | **i18n/RTL/375px + scope containment** — fits 34-locale parity, RTL, mobile; cuts cleanly along waves | 7% | Ships in waves, no creep |

## Tie-breakers
- If tied on weighted sum → prefer higher **reuse ratio** (less risk, faster ship).
- If still tied → prefer higher **operator clarity** (the Star's daily driver).

## Bank-for-refinement rule
Any dimension where the LOSER scores ≥4 and the WINNER scores ≤3: that loser idea is banked for Phase 10 (merge into winner).

## Hard disqualifiers (any one = approach cannot win outright)
- Ignores the MySQL-twin / Storage-Covenant parity requirement for new repos.
- Requires latency percentiles beyond the 200-row window without a rollup table.
- Claims 429 counts without adding an httpStatus column.
- Violates the anti-slop checklist.
