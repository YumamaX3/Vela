# 🪞 The Pricing Covenant — Sealed Plan

**ADR** · Status: SEALED — awaiting Forge handoff · Score: 4.0/5 (five independent arbiters) · Sealed: 2026-08-15

> *"Every model weighed, every free model inherited, every rate provenanced."* 🪞💜

## Context

Vela routes 126 active providers / 725 unique model ids (1,003 slots). Pricing lives in
`open-sse/providers/pricing.js` — `MODEL_PRICING` (101 canonical entries) → `PROVIDER_PRICING`
(111 overrides, only `gh` + `tokenrouter`) → `PATTERN_PRICING` (51 globs), all rates $/1M tokens,
five-field shape `{input, output, cached, reasoning, cache_creation}`. Usage cost is computed at
WRITE time (`usageRepo.calculateCost`) and frozen in the DB.

The census (2026-08-15, live registry import) found:
- **73.6% of slots resolve**; 172 LLM-class names unpriced — clustered in namespaced router ids
  (`nesarouter/*`, `cline-pass/*`, `accounts/fireworks/models/*`, `mimo/*`), Cloudflare `@cf/*`,
  router pseudo-models (`auto`, `best`, `default`, `nano`, `universal-*`), stragglers (`o3`,
  `llama-3.3-70b-versatile`, `gemma-4-31b-it`, Nova family).
- **36 free-tier models; 30 resolve to NOTHING** (the whole nesarouter family, kilo-gateway, mimo).
- The `PROVIDER_PRICING.gh` override is **dead**: usage rows store the registry id (`github`),
  never the alias (`gh`).
- `getDefaultPricing()` returns only `PROVIDER_PRICING` — the PricingModal and settings page are
  blind to canonically-priced models.
- `PricingModal` (a `"use client"` component) imports `pricing.js` into the client bundle and uses
  it as fallback — stale-render + bundle-bloat hazard.

The Star decreed: deep-research all official pricing, add/update it, and **free models inherit
their paid sibling's exact rates everywhere** (resolution, display, usage cost alike). Plus a
**Sync button** on `/dashboard/settings/pricing`.

## Decision

**Approach A — "The Monolith"**, refined through four adversarial passes. Everything pricing stays
in `open-sse/providers/pricing.js` as the single source of truth; the async KV layers live in
`pricingRepo.js`. Free inheritance via a **hand-verified `FREE_ALIAS_MAP`** (primary) with a
**guarded suffix-strip fallback** (exact-sibling matches only, never globs). Sync refresh writes a
**separate `pricing_sync` KV scope** — never the user's `pricing` scope.

### Alternatives considered

| Approach | Verdict | Why rejected |
|-|-|-|
| B "Constellation" (15 per-vendor modules + composer + generator) | runner-up, ideas banked | 15 silent-vanish import traps (the translator/index.js failure mode, documented in this repo); two refresh mechanisms = two truths; parity-test discipline + dated provenance comments banked into A |
| C "Ledger" (committed JSON catalog seeded via migration) | rejected | moves pricing authority into src/lib DB (open-sse standalone boundary violated), sql.js fallback seed stall, breaks 3+ direct-import test suites, two temporal truths (seed vs last-sync) |

## The Seven Strata (resolution sovereignty, top wins)

```
pricingRepo.getPricingForModel(provider, model)          [async master]
 1. user override   scope 'pricing'      PK point-lookup, id→alias dual-key     ← user sovereign
 2. synced rates    scope 'pricing_sync' PK point-lookup, TTL-cached, dual-key
 3. pricing.js static chain (sync, pure):
    3.0 UNPRICEABLE manifest check      (router pseudo-models → null + reason)
    3.a PROVIDER_PRICING[id][model]     (Object.hasOwn)
    3.b PROVIDER_PRICING[PROVIDER_ID_TO_ALIAS[id]][model]   ← fixes dead 'gh' lane
    3.c MODEL_PRICING[model] exact      (explicit entry beats inheritance)
    3.d FREE_ALIAS_MAP[model] → sibling resolved via 3.a/3.b/3.c EXACT ONLY (never globs)
        └─ guarded fallback: strip ':free'/'-free' suffix → EXACT sibling only
           (FREE_DENYLIST blocks infix/router traps: goldeneye-free-auto, kilo-auto/free)
    3.e MODEL_PRICING[stripVendor(model)]
    3.f PATTERN_PRICING (pre-compiled regexes at module load)
```

Invariants pinned by tests: explicit entry always wins over inheritance
(FREE_ALIAS_MAP keys ∩ MODEL_PRICING keys = ∅); `matchPattern` export + glob semantics preserved
(consumed by capabilities.js + thinkingLevels.js); five-field shape never gains a field.

## Implementation Blueprint

Commit sequence (each independently revertable, Conventional Commits, two-name trailer):

| # | Commit | Contents |
|-|-|-|
| C1 | `fix(pricing): real defaults route` | Create `GET /api/pricing/defaults` (full static picture incl. materialized canonical); delete dead `GET_DEFAULTS` export. New routes import from `@/lib/db/index.js`, not the localDb shim |
| C2 | `feat(pricing): 2026-08-15 rate census` | MODEL_PRICING 101→~200 (harvest: plans/research/models-dev-harvest-2026-08-15.json); PROVIDER_PRICING lane tables keyed by REGISTRY ID (cloudflare-ai, nesarouter, clinepass, fireworks); delete `MODEL_PRICING['auto']` (moves to UNPRICEABLE); dated provenance comments; re-baseline gemini-3.7 parity test (Google price cut) in same commit |
| C3 | `feat(pricing): inheritance machinery` | FREE_ALIAS_MAP (36 verified) + FREE_DENYLIST + UNPRICEABLE manifest + PRICING_SOURCES + SYNC_VENDOR_MAP exports; seven-stratum static resolver; header rewrite |
| C4 | `feat(pricing): sovereignty merge` | pricingRepo: pricing_sync scope, dual-key PK point-lookups, immediate invalidation, replaceSyncedPricing/clearSyncedPricing; shim re-exports (db/index.js + localDb.js); exportDb/importDb gain pricing_sync; GET /api/pricing overlays sync layer |
| C5 | `feat(pricing): sync endpoint` | POST /api/pricing/sync — key-only vendors, hardcoded URLs, redirect:"error", AbortSignal.timeout(15s), 20MB cap, schema clamps ([0,10000] $/M, key length ≤200, charset allowlist, reject prototype keys), setMany single transaction, diff summary, __meta__; dashboardGuard ALWAYS_PROTECTED; AGENTS.md record |
| C6 | `feat(dashboard): sync shore` | Settings page: Sync button + last-synced card + two distinct resets (reset overrides / clear synced) + reset-all clears BOTH scopes; PricingModal: purge pricing.js client import (defaults via API), dirty-row PATCH, provenance badges, estimate flag, UNPRICEABLE renders "—" never $0.00 |
| C7 | `test(pricing): covenant pins` | 36 inheritance pins + denylist negatives + sovereignty fixtures (id-vs-alias conflict both directions) + bake-verification test (harvest→pricing.js equality) + matchPattern compat pin + PATTERN precedence pins + mechanical census baseline (__baseline__/pricing-census.json, counts derived never hardcoded) |

Sync endpoint contract: `POST /api/pricing/sync {vendors?: string[]}` → server-side fetch of
models.dev/api.json (primary, $/1M numeric) + openrouter.ai/api/v1/models (cross-check, per-token
×1e6); per-vendor failure tolerance; commits only `pricing_sync`; returns
`{ok, syncedAt, entryCount, diff:{added,updated,removed}, failed:[{vendor,reason}]}`.
`DELETE /api/pricing/sync` = clear synced. LLM token rates ONLY — `costPerQuery` search costs
never touched.

## Consequences

**Easier**: comprehensive coverage for LLM models; free models priced consistently; one-click
refresh; user overrides structurally sovereign; every rate provenanced; dead `gh` lane revived;
hot-path resolver cheaper (PK point-lookups replace uncached getAll).
**Harder**: pricing.js grows (~700→~1,500 lines — dated sections + census test mitigate);
historical usage costs keep mixed rates (frozen at write, no backfill); spend caps judge mixed
rates until traffic flows.
**Debts recorded**: gitbook "3-tier pricing strategy" content drifts (never edited in place —
generator debt); `cloud/` worker may carry a second cost engine (unprovable from this repo);
media-model pricing deferred by the Star's word.

## Verification Record (four adversarial passes)

1. **Frame (Tidebreaker)** — REVISE→fixed: FREE_ALIAS_MAP over suffix-heuristic (F1); separate
   sync namespace (F2); UNPRICEABLE manifest + modality line + lane-aware "official" (F3).
2. **Selection (Tidebreaker)** — REVISE→fixed: pinned-test re-baseline plan; dual-key user KV;
   client-bundle purge; SSRF hardening on sync.
3. **Scoring (5 arbiters)** — 4.0/5 composite: UNPRICEABLE at stratum 3.0 + auto deletion;
   explicit-beats-inheritance rule; sync overlay on GET /api/pricing; redirect:error + clamps;
   TTL-cached sync reads; harvest honesty (142→~200 entries).
4. **Weave (Tidebreaker)** — 16 threads tied: matchPattern compat pin, shim re-exports,
   exportDb/importDb exact lines, reset-all dual-scope, costPerQuery scope guard, UNPRICEABLE
   display semantics, AGENTS.md + header doc-rot, no-backfill documented, local-branch covenant
   (no PR).

Tests touching pricing data (re-baseline watchlist): gemini-3.7-antigravity (re-baseline — real
price change), gemini-36-integration (survives — rates match harvest), provider-pricing-minimax-m3
(survives), cached-token-usage (immune), db-sqlite-vs-lowdb (resolver-refactor sensitive).

## Forge Execution — C7 and the Proving Tide (2026-08-15)

C7 landed with corrections the sealed plan must own:

- **27 covenant pins** (not 36 — every assertion was traced through the resolver
  before it was allowed to exist): shape lint, inheritance + cost math, denylist
  negatives, UNPRICEABLE, matchPattern compat, pattern precedence, dual-key alias
  resolution, provenance, harvest bake-verification, sovereignty fixtures. All green
  first run.
- **matchPattern truth**: the plan's draft examples assumed substring semantics; the
  actual glob is ANCHORED (`^...$`) and the pins enforce the real semantics —
  `codex-*` matches prefix, `*-codex` matches suffix, never infix.
- **FREE_ALIAS_MAP census repair** (found by pin 2's sibling-resolution sweep):
  `auto:free → auto` (bazaarlink registers no `auto`) and
  `kwaipilot/kat-coder-pro-v2.5:free → kwaipilot/kat-coder-pro` (sibling exists only
  in the cline registry) both resolved null — removed with dated reasoning in-source.
- **Census baseline**: `tests/__baseline__/pricing-census.json` + snapshot/verifier
  scripts (counts derived, never-shrink gate): 215 canonical · 8 lanes · 128 lane
  models · 57 patterns · 13 free-map · 22 denylist · 8 unpriceable · 25 sources.
- **Regression judgment**: full suite 2,114 passed / 92 failed; the 92 reds share zero
  file overlap with the covenant diff (11 files), none import pricing, and
  dashboard-guard/apikey-enforcement suites run green — the known-red checkout
  baseline stands, +27 green added.

*The Star casts the stone. The Keeper tends the current.* 🌊💜
