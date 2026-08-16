# Phase 8 — Trade-off Analysis: The Compass Deck

Every decision's cost, recorded honestly. Alternatives rejected with reasons — including the status quo.

---

## T1 — IA shape: question-shaped decks (Compass) vs data-shaped grid (Observatory) vs ledger-default (Manifest)
**Chose:** four question-shaped decks.
**Rejected:** data-shaped grid (power-user flexibility, but facets-without-purpose and no onboarding story); ledger-default (auditability-first, but hostile first impression and sparse-telemetry exposure — empty latency cells a table cannot hide).
**Becomes easier:** onboarding (the tab strip IS the sentence), acceptance testing (4 questions = 4 yes/no reviews), i18n (4 anchor strings).
**Becomes harder:** free-form cross-dimension pivoting (cost-and-latency side-by-side needs tab switch); provider breakdown appears in two decks under different metrics (mitigated by centralize-by-metric adjudication).
**Risk carried:** the IA freezes around today's questions — a future dimension (carbon, per-team billing) must adopt into an existing question.

## T2 — Topology placement: Overview Row B (functional) vs Analytics-only (Compass original)
**Chose:** topology greets Overview as a functional map (halos=error rate, particles=throughput, click=filter); Analytics keeps temporal instruments only.
**Rejected:** Analytics-only (breaks the signature-visual habit, graph no longer greets); decorative Overview (the debt we are retiring).
**Becomes easier:** pre-attentive failure hunting on first load; the beloved kame survives and becomes load-bearing.
**Becomes harder:** halo data must be funded (S1 channel built in W1); first-load weight (xyflow must dynamic-import).
**Risk carried:** motion distraction — mitigated by prefers-reduced-motion + pause.

## T3 — Aggregation: SQL-side rewrite vs client-side grouping (status quo)
**Chose:** SQL-side GROUP BY + usageDaily rollup extension + percentile skip-scan/histogram.
**Rejected status quo:** client-side grouping of raw rows — O(rows) per filter change, dies at 100k, blocks the perf budget.
**Becomes easier:** p95<300ms budget achievable; CSV export shares the WHERE-builder; metrics API and screen never disagree.
**Becomes harder:** twin-parity surface grows (every aggregate needs sqlite+mysql impls + parity rows); rollup granularity seams at period boundaries (mitigated: bucket size always labeled).
**Risk carried:** percentile approximation on long windows is approximate — labeled as such, never faked.

## T4 — Percentiles: exact skip-scan (≤3d) + histogram buckets (7d+) vs window-function vs t-digest
**Chose:** two-tier (exact recent, histogram long).
**Rejected:** window functions (MySQL/SQLite parity pain, slow at 100k); t-digest (new dependency, overkill for a gateway dashboard).
**Becomes easier:** zero new deps; index-backed recent percentiles; histogram rides the rollup writer.
**Risk carried:** long-window percentiles are bucket-approximate (labeled); benchmark gate must prove the 300ms claim or downgrade it.

## T5 — Compare-periods: W3 vs W2
**Chose:** phased to W3 (Tidebreaker S5 — W2 was maximum scope).
**Rejected:** shipping in W2 (delta machinery + ghost overlays + i18n would drown the cockpit wave).
**Becomes easier:** W2 ships a complete, honest cockpit; compare lands with budget burn where deltas matter most.
**Risk carried:** a decree'd feature (the Star chose it) ships one wave later — surfaced here for the Star's judgment.

## T6 — i18n: hard 40-literal cap vs uncapped chart labels
**Chose:** ≤40 new literals, composed from shared primitives (ChartPanel label set, number+metric tooltips, one empty-state, one 'collecting since {date}', 4 anchors).
**Rejected:** per-panel bespoke copy (~50-100 strings → 1,700-3,400 entries — a genuine wave-sinking load).
**Becomes easier:** W2 survives 34 locales; future panels inherit the label set.
**Risk carried:** copy is more templated, less lyrical — restraint over flourish.

## T7 — Ledger: server-paginated vs client-held (status quo ring buffer)
**Chose:** server-paginated SQL ledger with keyboard nav + no-reflow pill.
**Rejected:** 200-row requestDetails ring buffer as the ledger (it's a cache, not a record — auditors deserve the full history).
**Becomes easier:** full audit trail; filters and export share one WHERE-builder; 'show me the rows' scales.
**Becomes harder:** every filter change is a round-trip (mitigated by indexes + memoization); keyboard nav is an a11y liability if built carelessly (focus discipline mandated).
**Risk carried:** pagination + live arrival interaction (pill pattern solves it).

## T8 — Do-nothing path (status quo)
**Rejected:** the current page is a 537-line orchestrator with inverted dependencies, a dead logs tab, 5 duplicate formatters, client-side grouping that dies at scale, latency trapped in a 200-row JSON ring, and a signature topology that decorates rather than informs. The Star decreed a full observatory. Doing nothing keeps every debt and forfeits every capability (budgets, alerts, insights). The cost of building is high; the cost of not building is permanent.

---

## Consequences — the honest ledger
**Easier:** onboarding, acceptance testing, audit, export, i18n anchoring, failure hunting, twin-parity discipline.
**Harder:** W2 is still the heaviest wave; aggregate twin-parity surface grows; keyboard a11y demands care; compare-periods waits.
**Carried:** IA freezes on four questions; long-window percentiles approximate; launch week is half-empty (honest); motion discipline must hold.

## Surfaced to the Star at Gate 8
- T5: compare-periods moving W2→W3 (a decree'd feature, one wave later)
- T2: topology as functional centerpiece of Overview (vs Analytics-only)
- T1: four-question IA freezing future dimensions into existing questions
