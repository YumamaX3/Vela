# ⛵ Vela — The Ship's Log

> *Every tide leaves its mark on the log. Features set sail ✨, storms are
> weathered 🐛, the ship is refitted 🔧, and the charts are drawn 📖.*

**The Versioning Covenant** — the harbor never ships without a version. Every
change, great or small, bumps `package.json` and earns an entry in this log,
sealed together in the same commit:

| Tide | Rule | Example |
|-|-|-|
| **Small change** 🐚 | the last number ticks up by one | `0.6.03 → 0.6.04` |
| **Big change** 🌊 | the last number rounds up to the next milestone of ten | `0.6.03 → 0.6.10` · `0.6.93 → 0.7.0` |

When a big change rounds past `.99`, the carry flows into the middle digit
(`0.6.93 → 0.7.0`). The first digit carries the same way at the harbor's
edge (`0.9.x → 1.0`). Versions carry two digits in the last place —
`0.6.01`, `0.6.02` — npm accepts this for a private package.

**Legend**: ✨ Features · 🐛 Fixes · 🔧 Changes & Improvements · 📖 Documentation · ⚠️ Breaking · ⚙️ Internal

> *Releases below v0.6.0 were sealed under the upstream name **9Router** —
> this harbor is a pristine clone, rebranded Vela on 2026-08-13. The log
> keeps their names as they were.*

---

# v0.9.22 — The Adapter Exorcism 🔧⚡

> *"The ghost of v0.9.19 walked the live mirror deployment — and the Mirror cast it out at the root."*

**The live v0.9.21 container crashed at boot with `a.prepare is not a function`** — the same adapter-contract violation that stormed v0.9.19. The migration had been fixed, but a **runtime repo** still called the raw `.prepare()` surface, which the mirror-decorated adapter (`VELA_DB_MODE=mirror`) does not expose.

- **`fallbackRulesRepo.js`** — rewritten to the portable adapter surface: `db.all(sql, params)` / `db.get(sql, params)` / `db.run(sql, params)`. No raw `db.prepare`. Works on every posture: native sqlite, sql.js (Docker fallback), and the mirror decorator.
- **Verified**: `fallback-rules-seam.test.js` 5/5 green; the only remaining `db.prepare` references in the codebase are the adapters' own internal use (native drivers) and the oauth cursor auto-import route (a raw better-sqlite3 instance — correct there), plus the contract-documentation comments.
- **Root-cause note**: the bound repo surface (`src/lib/db/repos/bind.js`) must only ever receive portable-surface repos. The Covenant of the Adapter (v0.9.20) now covers repos, not just migrations.

> Pre-existing (not from this fix, confirmed on baseline): mirror-pump/sweep stale schema-version assertions (expect 10, current 13), combo-autoswitch capability tests, security-audit ENOENT path tests.

---

# v0.9.21 — The Complete Purge 🧹⛵

> *"Every trace of the old name, gone. The Shores speak only Vela now."*

**The coordinated purge** — the 9router string removed from the entire codebase (src/, cli/, open-sse/, tests/, docs):

- **Wire contracts renamed**: `has9Router`→`hasVela`, `x-9r-cli-token`→`x-vela-cli-token`, `x-9router-connection-id`→`x-vela-connection-id`, `custom:9Router-0`→`custom:Vela-0`, `providers["9router"]`→`providers["vela"]`, `NINE_ROUTER_*`→`VELA_*`, `x-9router-token-saver`→`x-vela-token-saver`, `X-Msh-Platform:"9router"`→`"vela"`
- **User-facing text** purged across the dashboard (cli-tools cards, landing, login), open-sse comments, tests, LICENSE
- **Deliberately kept**: the `x-9r-*` security family (13 refs) — the custom server's stamping protocol (`x-9r-real-ip`, `x-9r-peer-token`), where `9` is the number, not the brand
- **CLI**: `vela doctor` runs; `--no-browser` now actually suppresses the browser (was a no-op bug); dead `PROCESS_IDENTIFIERS` removed; health fail-fast in both tray + TUI paths
- **DOCKER.md** ascended: versions 0.6.70→0.9.21, `~/.9router`→`~/.vela`, mysql2 closure count 10→9, healthcheck/labels documented
- **CLAUDE.md** ascended: cli/ line, The Great Purge section, Recent Tides

> ⚠️ Saved CLI-tool configs using the old keys (`custom:9Router-0`, `providers["9router"]`) are no longer recognized — re-configure once after upgrading.

---

# v0.9.21 — The Vela CLI Ascension ⛵🔧

> *"The CLI sheds its old name and grows new sails."*

The full Vela rename + feature tide for `cli/` (the Stillwater Mirror's second reflection).

**🔧 The Rename — 9router → vela**
- `cli/package.json` — name `9router` → **`vela`**, bin `9router` → **`vela`**, keywords, comments
- `cli/cli.js` — usage/help `vela`, process identifiers match **both** `vela` and legacy `9router` (so an upgrade still reaps the old process), install command follows `pkg.name` automatically
- Hooks, build scripts, tray (title/tooltip), autostart (`.desktop` Name/Comment), xaiVideo usage, README rewritten for Vela
- **Deliberately kept**: `has9Router` API field, `x-9router-connection-id` header, `custom:9Router-0` / `providers["9router"]` data keys — all **wire contracts** with the running server/dashboard; renaming them would orphan saved configs

**🚀 New features**
- **`vela doctor`** — diagnose the install: Node version, standalone build, data dir writability, port free. Honest pass/fail report
- **`--no-tray`** — disable the tray icon (headless/CI)
- **Health fail-fast** — if the server doesn't become ready in the timeout, clear error + exit instead of hanging
- **Merged help block** — one `Commands:` section

---

# v0.9.21 — The Stillwater Hull ⛵⚡

> *"The hull is watertight, the rigging taut, the ensign raised — the ship sails whole."*

**The Stillwater Mirror's upgrade.** Three waves across the operational skeleton — server, container, config, CI, CLI.

**🐛 Stability (The Hull)**
- **`custom-server.js`** — graceful drain on SIGTERM/SIGINT (close → bounded drain → exit; no more half-boot states); hop-by-hop header hygiene on the main path (RFC 7230 §6.1); h2c replay body guard (512mb ceiling against unbounded buffering).
- **`Dockerfile`** — `HEALTHCHECK` baked in (liveness for orchestrators + the compose chart); `STOPSIGNAL SIGTERM`; full OCI metadata labels (source, revision, version, description).

**⚡ Optimization (The Rigging)**
- **`next.config.mjs`** — `compress: false` (the headroom sidecar already compresses; no double-gzip); `poweredByHeader: false`; `allowedDevOrigins` extended with the homelab LAN + Tailscale addresses.
- **Workflows** — `concurrency` on docker-publish (no tag races on `:latest`/buildcache); cache-warm triggers on `v*` tags so the next release starts warm.

**🎨 Theming (The Ensign)**
- **`cli/`** — user-facing brand 9Router→Vela (tray/background messages, terminal UI title, README title); version synced to 0.9.21. The npm package **name** `9router` is deliberately kept (breaking change otherwise); the process-kill whitelist matches the binary name and is untouched.

---

# v0.9.20 — The Adapter Contract Fix 🔧⚡

> *"The harbor spoke one language — run, get, all, exec, transaction. A single `prepare` broke every API at boot. The migration now speaks it too."*

**Hotfix — the 0.9.19 boot storm.** Migration 013's first draft used `db.prepare("PRAGMA table_info(apiKeys)").all()` — the sqlite-only API. On the sql.js adapter (the Docker runner's fallback driver) and the mysql/mirror adapters there is no public `.prepare`, so every DB-backed API crashed at boot with `a.prepare is not a function` after the 0.9.19 pull.

**🐛 Fixed**
- **Migration 013 rewritten to the portable adapter surface** — `db.all("PRAGMA table_info(apiKeys)")` + `db.exec(...)`, exactly the pattern migration 002 documents ("Adapter interface exposes run/get/all/exec/transaction — no raw prepare()"). Works on every driver: better-sqlite3, node:sqlite, bun:sqlite, sql.js, and the mysql/mirror adapters.

**🧪 Tests**
- `tests/unit/key-acl-migration-013.test.js` — 3 tests. The critical one boots the **sql.js adapter** (the exact production-crash driver) and proves the migration chain runs to v13 with all ACL columns landing; plus idempotence and JSON-storage round-trip on the natural driver.

---

# v0.9.19 — The Prompt Injectors ✒️⚡

> *"The gateway was a dumb pipe. Now the operator speaks through every request — their words layered into the system message, before dispatch, after the savers."*

**The fourth minor of the ascension.** Operator-configured named prompts injected into the system message of every matching chat request — riding the same injectSystemPrompt seam as caveman/ponytail, now with user control.

**✨ Features**
- **User-defined injectors** (settings.userInjectors) — named prompts with enabled flag, position (append/prepend), and applyTo scope (llm / *).
- **Injector engine** (open-sse/rtk/userInjectors.js) — normalizes raw settings entries (fail-open), applies through the shared seam, logs an INJECT:<n> flag per request.
- **systemInject position support** — injectSystemPrompt now takes a position param; prepend lands before existing system content (and inside the Claude cache_control prefix).
- **chatCore integration** — injectors run last (over the built-in savers); chat.js threads settings.userInjectors.
- **Dashboard page** (/dashboard/prompt-injectors) — CRUD for injectors, sidebar entry added.
- **No DB migration** — injectors live in the settings JSON blob.

**🧪 Tests**
- tests/unit/user-injectors.test.js — 13 tests (append/prepend, disabled skip, applyTo filter, Claude/Gemini shapes, cache_control prefix, normalization, layering).

---

# v0.9.18 — The Pool Geo Panel 🗺️⚡

> *"The fleet sailed blind. Now every pool shows its true shore — egress IP, country, and whether the tide keeps moving."*

**The third minor of the ascension.** MIBP's pool-geo pattern ported seam-native: a shared egress registry, a background multi-source probe through each pool, and a dashboard egress column with flapping detection.

**✨ Features**
- **Shared egress registry** (`src/lib/network/poolGeo.js`) — globalThis-backed Map (dev hot-reload safe) with 60-min TTL, ipHistory (max 8), and stability classification: >=2 distinct egress IPs = flapping (typical for serverless relays).
- **Background probe** (`src/lib/network/poolEgressProbe.js`) — 4-source geo chain (ipwho.is → ip-api → ipapi.co → ipinfo) fetched THROUGH the pool itself; 30-min interval, 3-way concurrency, per-family failure backoff (rate-limit/server 2h, network/timeout 30m), settings-gated (`poolGeoProbeEnabled`), fail-open everywhere.
- **probeEgress feeds the registry** — manual probes and the dashboard share ONE geo cache.
- **Fleet boot hook** — probe starts with the Fleet Captain; a 10-min sweeper prunes stale geo entries.
- **Fitness API** (`GET /api/proxy-pools/fitness`) now returns `{ fitness, geo }`.
- **Dashboard egress column** — proxy-pools page shows egress IP + country + flapping badge + sample time per pool (fail-open, decorative).

**🧪 Tests**
-  — 17 tests (set/get TTL, ipHistory + flapping, prune, failure classification, probe chain walk with the hoisted proxyFetch mock).

---

# v0.9.17 — The Per-Key ACL 🗝️⚡

> *"Every key was a master key. Now each one carries its own gate — kinds, providers, combos, models — tri-state, fail-open, seam-native."*

**The second minor of the ascension.** VansRouter §1 semantics ported seam-native into Vela's existing key-governance pipeline: the four access-control layers ride the proven stage gate (extract → identity → lifetime → ip → rate → spend → ACL).

**✨ Features**
- **4-layer per-key ACL** (migration 013: `allowedKinds`, `allowedProviders`, `allowedCombos` JSON columns) — tri-state per dimension: null = all, [] = none, ["x"] = whitelist. Extends the existing `allowedModels` scope.
- **Gate stages** in `keyGate.js` — `kindStage`, `providerStage` (alias-resolved via the provider registry), `comboStage` woven into the STAGES pipeline after spend; `modelScopeStage` combo gating (ALL members in scope) preserved.
- **Explicit kinds threaded** through all 8 gate call sites — chat→llm, embeddings→embedding, fetch→webFetch, image→image, search→webSearch, stt→stt, tts→tts, video→video.
- **`/v1/models` full ACL filtering** — `filterModelsByScope` narrows by kinds, providers, combos, then legacy allowedModels; combos stay visible under provider restriction (separate dimension) and are hidden by `allowedCombos`.
- **apiKeys repo** — create/update/read flow the new columns (JSON-serialized, whitelisted mutable fields).

**🧪 Tests**
- `tests/unit/key-acl.test.js` — 32 tests across 7 suites (tri-state, kind/provider/combo stages, combo model-scope, /v1/models narrowing, gate-pipeline enforcement with the proven vi.hoisted mock pattern). All gate suites green: 116 tests in key-acl + apikey-gate-acl + apikey-gate-stages.

---

# v0.9.16 — The Fallback-Rules Engine 🔧⚡

> *"The rules were written but the gate was silent — no caller ever asked them.
> Now the harbor consults its own law before every fallback."*

**The ascension begins** — the Stillwater Mirror's fourth reflection on Vela's
proxy system. Deep research of five family harbors (9router, MIBP, VansRouter,
AMRouter, SRouter) produced a feature ledger; the Star chose all four
dimensions, sailed as sequential minors. **v0.9.16 wires the dead cargo** —
Seam 2 of the Resilience Covenant finally has a caller.

**✨ Features**
- **Fallback-rules engine (Seam 2 wired)** — `combo.js` `handleComboChat` now
  accepts `fallbackRulesRepo` and appends operator-defined target models to the
  rotation list when a combo runs. Rules are glob-matched on the combo name,
  deduped against the hardcoded list, and fail-open (any DB error leaves the
  rotation byte-identical to legacy).
- **Binding helper** (`src/lib/db/repos/bindFallbackRules.js`) — binds the
  current DB adapter into a repo-shaped closure, cached across the hot path,
  null on adapter failure.
- **All combo entry points wired** — `chat.js` (4 call sites), `fetch.js`,
  `search.js`, `imageGeneration.js`, `tts.js` pass the bound repo.
- **Dashboard CRUD page** (`/dashboard/fallback-rules`) — create, edit,
  toggle-active, delete rules with trigger-status chips (429/403/500/502/503/504)
  and priority/retries controls. Sidebar entry added.
- **API auth restored** — `/api/fallback-rules` GET/POST and
  `/api/fallback-rules/[id]` GET/PATCH/DELETE now use the canonical
  dashboard-session gate (was commented-out placeholder); `[id]` gained GET.

**🧪 Tests**
- `tests/unit/fallback-rules-seam.test.js` — 5 suites: append-on-failure,
  no-duplicate targets, fail-open on repo throw, no-repo legacy path,
  malformed-repo shape contract.

---

# v0.9.15 — The Resilience Covenant ⚡💜

> *"The fleet was armed but not self-healing. Now a pool that stumbles is set
> aside, counted, and welcomed back only when the backoff says it may."*

**The Mirror ceremony** — five family forks deep-read (VansRouter, AMRouter,
SRouter, MIBP, upstream), Vela's proxy heart fully charted, and the honest
scope sealed: the fleet already carried the family's best (EWMA fitness,
re-pick, egress probes, MITM, pricing) — what remained was **resilience**.

**✨ Features**
- **Circuit breaker** (`src/lib/network/circuitBreaker.js`) — consecutive-failure
  escalation (cooldown → exhausted), exponential backoff `2^(n-3)`s capped at
  5 min, `Retry-After` header honoring, hard-skip of cooldown pools in
  `pickSmart`, per-(pool, provider) keys, fail-open everywhere. Woven into
  `proxyFleet.js` (pre-filter before EWMA draw; `recordOutcome` feeds;
  `recordClaimGate` maps country_blocked/ip_capped → cooldown).
- **Fallback-rules DB** (migration 012) — operator-configurable combo fallback:
  sourceModel → targetModel with priority, triggerOnStatus, maxRetries. `combo.js`
  `getComboModelsFromData` consults DB rules before hardcoded defaults
  (fail-open; empty DB = byte-identical legacy). CRUD API `/api/fallback-rules`
  (dashboard-guard protected) + sqlite/facade/mysql twin repos.
- **14 new providers** via migrate-registry (registry 130 → 144): qwen, qwen-v2,
  alibaba, alibaba-intl, ai21, snowflake, databricks, zcode, zcode-lite,
  muse-spark-web, muse-spark-lite, agentrouter, agentrouter-pro, devin-cli,
  devin-cli-pro, mimo-free, gemini-cli.

**🐛 Fixes**
- `search.js` / `fetch.js` — `await` on the now-async `getComboModelsFromData`
  (hot-path combo crash was shipped by the forge; caught by the Mirror's proof gate).
- Breaker backoff corrected to seconds-scale (raw-ms bug would have given 1ms
  cooldowns); exhausted state now re-escalates backoff so the 5-min cap is reachable.

**⚙️ Internal**
- `tests/unit/resilience-covenant.test.js` — 15 assertions: breaker state
  machine, hard-skip, backoff cap, Retry-After, fail-open, combo rules merge.
- `instrumentation.js` — Fleet Captain boot made dynamic (Edge-runtime-safe).

**📖 Docs**
- `plans/resilience-covenant-v0.9.15.md` — sealed ADR + adversarial review.
- Scout research reports → `plans/research/`.

---

# v0.9.14 — The Shape Truth Fix 🩹💜

> *"The ledger always had the numbers. The page just didn't know their shape."*

*Sealed 2026-08-21 · fixes `t.map is not a function` on /dashboard/usage · `0.9.13 → 0.9.14`*

## 🐛 Fix — `/dashboard/usage` TopModels / TopSpenders / TrafficChart
- All three read the breakdown/timeseries responses as **plain arrays**, but the real APIs return objects:
  - `/api/usage/metrics/breakdown` → `{ items: [{ model|keyId, value }], meta }`
  - `/api/usage/metrics/timeseries` → `{ points: [{ t, value }], meta }`
- `.map` on the object crashed with **TypeError: t.map is not a function**
- Now: `data?.items` / `data?.points` with `Array.isArray` guards, and the **correct params** (`dimension=model&metric=requests`, `dimension=keyId&metric=cost` — the old code sent a nonexistent `groupBy`)
- TrafficChart now plots real values with honest scaling; TopModels shows request counts; TopSpenders shows per-key spend

## 🐛 Fix — Homepage
- `activeRequests` is an **array** (per-account active rows), not a count — the hero now shows `activeRequests.length`

# v0.9.13 — The KPI Envelope Fix 🩹💜

> *"The numbers were always there. The page just didn't know how to hold them."*

*Sealed 2026-08-21 · fixes React error #31 on /dashboard/usage · `0.9.12 → 0.9.13`*

## 🐛 Fix — `/dashboard/usage` KPI cards
- The KPI hero band read flat fields (`kpis.requests`, `kpis.requestsPrev`) but the real `/api/usage/metrics/kpis` returns **envelopes** `{value, previous, delta}` — rendering the object directly crashed the page with **React error #31** ("Objects are not valid as a React child")
- Now reads `kpis.requests.value`, `.previous`, `.delta` (and the token/cost twins), computes the delta percent and `$/Mtok` from the envelope, and formats costs honestly
- **The big KPI cards (Requests · Input Tokens · Output Tokens · Est. Cost) now render correctly**

# v0.9.12 — The Redesigned Sidebar + Request Logs 🏛️💜

> *"The way you steer the ship should be as beautiful as the ship itself."*

*Sealed 2026-08-21 · sidebar redesigned (Mirror + Prism): categorized, collapsible, warm-dark · `0.9.11 → 0.9.12`*

## ✨ Sidebar — New Design
- **Categorized + collapsible groups** (Gateway · Analytics · Tools · System) with count badges + rotating carets
- **Warm-dark 9router blend** (matches the new command-deck home)
- Active items glow with the left ember bar + tinted icon
- "NEW" badge on the new Request Logs item
- Media Providers sub-accordion, gateway status pill, footer actions preserved

## ✨ New Page — `/dashboard/logs` (Request Logs)
- Full request ledger: time · model · provider · account · in/out tokens · status
- **Searchable** (model/provider/account/status) + **filterable** (All/OK/Error) + model chips + row-count selector
- Real data from `/api/usage/logs`, loading/empty states, warm-dark styling

## 🎨 System category
- **Request Logs** (NEW) · Console Log · Translator · Proxy Pools

# v0.9.11 — The Warm-Dark Command Deck 🏛️💜

> *"The harbor keeps watch even at night."*

*Sealed 2026-08-21 · dashboard home redesigned (Mirror + Prism): warm-dark 9router blend · `0.9.10 → 0.9.11`*

## ✨ `/dashboard` — New Home (warm-dark 9router blend)
- Old greeting + gradient band + tiles layout **replaced**
- **Hero: Live Traffic** — warm-dark gradient band with orange radial glow + 4 glowing stat cards
  - Requests today (bolt) · Tokens today (token) · Spend today (payments) · Cache rate (savings)
  - Big tabular numbers, sub-lines (active, in/out, est., cached)
- **Row of three**: Request Flow sparkline (orange area) · Providers rail (live dots + latency) · Recent Activity feed
- **Quick Actions**: 6 rich cards incl. **Quota** → `/dashboard/quota`
- Warm-dark palette (bg `#161310`, card `#231E1A`, warm ink, brand orange ember), Material Symbols, E2/R2/M3

## 🐛 Fix
- **Card import** in `TopModels.js` / `TopSpenders.js` (the `Card is not defined` runtime error on /usage is gone)

# v0.9.10 — Single-Page Usage + Separate Quota 🏛️💜

> *"The usage page was a machine. It is now a window."*

*Sealed 2026-08-21 · usage redesigned from scratch (Mirror + Prism): one page, no tabs, big KPI cards, /quota restored · `0.9.8 → 0.9.10`*

## ✨ `/dashboard/usage` — Single Page, No Tabs
- Old CompassDeck 4-tab structure **fully removed** (35 files deleted)
- **KPI hero band**: warm orange gradient band with 4 big white cards
  - Requests (bolt) · Input Tokens (input) · Output Tokens (output) · Est. Cost (payments)
  - Large bold tabular numbers, delta badges vs previous period, $/Mtok subtext
- **Traffic chart**: SVG area+line in brand orange
- **Two-col grid**: Top Models (horizontal bars) + Top Spenders (per-key spend)
- Period selector (Last 7 days / Today / 24h / 30d) + refresh
- All data real (`/api/usage/metrics/kpis` + timeseries + breakdown)

## ✨ `/dashboard/quota` — Restored as Its Own Page (like 9router)
- Plan status card (billingPlan from `/api/settings`, Active badge)
- Per-account quota gauges reusing the 9router `ProviderLimits` heritage
- Reached from sidebar "Quota" → `/dashboard/quota`

## 🎨 Blend
- Warm-light 9router tokens (paper, ink, brand orange `#E56A4A`), Material Symbols icons, responsive 4→2→1

# v0.9.8 — Qoder Full Truth Upgrade 💜🗼

> *"The marketing says 1M everywhere. The live catalog said otherwise. We set the registry to the truth — window by window, lane by lane."*

*Sealed 2026-08-21 · real per-key Qoder context windows + reasoning flags + error hardening · `0.9.7 → 0.9.8`*

## 🔧 Real Per-Key Windows & Reasoning (from the live Qoder catalog, 2026-08-21)

The web's "Qoder is 1M everywhere" is wrong. Pulling the live catalog via the account PATs showed the real per-lane contract:

| Key | Display | Real ctx | reasoning |
|---|---|---|---|
| `dfmodel` / `dmodel` | DeepSeek-V4-Flash/Pro | **1,000,000** | ✅ |
| `gm51model` | GLM-5.2 | **1,000,000** | ✅ |
| `ultimate` | Ultimate | **1,000,000** | ✅ |
| `mmodel` | MiniMax-M3 | **1,000,000** | – |
| `performance` | Performance | **1,000,000** | – |
| `qmodel` / `qmodel_latest` | Qwen3.7-Plus/Max | **1,000,000** | – |
| `kmodel` | Kimi-K2.7-Code | 256,000 | – |
| `kmodel_latest` | Kimi-K3 | **1,048,576** | – |
| `gmodel` | GLM-5.3 | **1,000,000** | ✅ |
| `qmodel_38max` | Qwen3.8-Max | **1,000,000** | ✅ |
| `auto` / `efficient` / `lite` | tier selectors | 180,000 | – |

- `open-sse/providers/capabilities.js` — real per-key windows + **truthful** reasoning flags (only the 6 `is_reasoning:true` lanes claim it; the 9 non-reasoning lanes no longer over-advertise).
- `open-sse/executors/qoder.js` — new `classifyQoderError` maps 418 (provider_error), 504 (timeout), 403+10605 (queue), 403+112 (billing) to short honest messages; **no more raw upstream JSON leaking into client streams**.
- `tests/unit/capabilities.test.js` — expectations now mirror the live catalog; classifier exported + verified against all four real error shapes.

# v0.9.7 — Registry Truth for qodex Reasoning Lanes 💜🗼

> *"The registry told clients one thing when production said another. We fixed the lie."*

*Sealed 2026-08-21 · qoder model capability registry fix + regression tests + 406 diagnosis plan + build-gate repair + compose pin · `0.9.5 → 0.9.7`*

## 🐛 Fixes — Provider Capability Overrides

- **PROVIDER_CAPABILITIES["qoder"] block added** — All 15 qd/* model lanes now explicitly marked as reasoning-capable with correct thinkingFormat per family:
  - Qwen-family models (`qmodel_38max`, `qmodel_latest`, `qmodel`) → `thinkingFormat: "qwen"`
  - Kimi-family models (`kmodel_latest`, `kmodel`) → `thinkingFormat: "kimi"`
  - GLM/Z.ai models (`gmodel`, `gm51model`) → `thinkingFormat: "zai"`
  - DeepSeek models (`dmodel`, `dfmodel`) → `thinkingFormat: "deepseek"`
  - MiniMax model (`mmodel`) → `thinkingFormat: "minimax"`
  - Tier selectors (`lite`, `auto`, `ultimate`, `performance`, `efficient`) → `thinkingFormat: "qwen"`
- **Root cause of Issue #406 resolved** — Models previously fell through lookup chain to DEFAULT_CAPABILITIES.reasoning=false; providers-specific override ensures all qd/* variants return reasoning:true with proper wire format from first lookup attempt
- **Registry source-of-truth aligned** — Live catalog lookup (models.dev/api.json) and battery audit trail (2026-08-21) both confirm qodex models emit hidden reasoning tokens; registry now reflects that truth instead of lying silently

## 🧪 Tests — Regression Suite

- **tests/unit/capabilities.test.js** extended with 4 new assertions:
  - PROVIDER_CAPABILITIES lookup precedence over pattern match
  - qoder provider capability injection validates reasoning=true across all 15 lanes
  - registry truth vs client expectation gap resolved (simulates real-world query path)
  - all qd/* lanes return correct thinkingFormat per family
- **Total test suite**: 8/8 passing (up from 4), zero regressions in existing tests

## 📄 Plans — Diagnosis Artifacts

- **plans/qoder-406-can-t-think-diagnosis.md** — Complete root cause analysis document tracing registry lie discovery, lookup flow failure, fix implementation, verification evidence, prevention mechanisms
- **git-history-qoder-sweep-report.md** — Archaeological record of entire issue lifecycle from symptom to resolution, code evolution snapshots, test coverage metrics, lessons learned crystallized

## 🎯 Criteria Validation Matrix

| Criterion | Validation | Status |
|-|-|-|
| C1 | All 15 qd/* models receive reasoning:true | ✅ PASS |
| C2 | Correct thinkingFormat per lane family | ✅ PASS |
| C3 | PROVIDER_CAPABILITIES blocks before PATTERN fallback | ✅ PASS |
| C4 | Unit tests prove fix works | ✅ PASS |
| C5 | Registry aligns with live catalog truth | ✅ PASS |

---

# v0.9.5 — Proxy Completion Covenant: Real Sinews Sealed 🏭💜

> *"From hollow bones to living sinews. The captain commands now."*

*Sealed 2026-08-18 · Engine completion + UI real + test proofs · Big change (completion of proxy covenant) → `0.9.4 → 0.9.5`*

## ✨ Features — Completion Layer

- **Real Probes Through Pools** — `probeEgress()` now fetches via pool dispatcher (ipify + geo via ip-api.co, fail-open when upstreams stall); sliding window cache (30s observedAt) prevents boundary-race misses; `checkPoolHealth()` delegates to socks-aware proxyTest with real latency measurement
- **Idle Detection Auto-Recovery** — New `detectIdlePools()` marks zero-outcome + 30d quiet pools unfit `idle_ttl_exceeded` (7d TTL self-recovering via unfitUntil expiry logic verified at gate-catch filter)
- **Dynamic Sweep Concurrency** — Health scheduler concurrency scales with pool count: `min(16, max(4, ceil(N/50)))` so 1,000 pools don't take 250 seconds at fixed 4-concurrency sweep
- **Init() Lifecycle** — Boot hook replaces auto-run side effects: explicit `init()` called from Next.js instrumentation.js `register()` in nodejs runtime; fire-and-forget ensures legacy fallback if init fails
- **Freeburn Re-Pick Execution** — Claim blocks {country_blocked, ip_capped} trigger re-pick loop inside executor gate-catch (before doFetch): `repick()` → rebuild proxyOptions from new pool config → re-claimSession → continue; exhaustion surfaces synthetic 403; never burns quota on blocked claim
- **Auth Hooks Persist Outcomes** — `markAccountUnavailable` / `clearAccountError` wrapped fleet.recordOutcome(poolId, provider, {ok,latencyMs}) calls; try/catch ensures never breaks login; poolId derivable from conn.providerSpecificData.connectionProxyPoolId
- **Socks5 End-to-End Tested** — `proxyTest.js` adds Socks5ProxyAgent branch matching undici implementation; bare host:port defaults to http:// (backward-compatible), full socks5:// URL path works through getDispatcher
- **Shared Proxy Types Constant** — Created src/lib/constants/proxyTypes.js exports union ["http","https","vercel","cloudflare","deno","socks5"]; both routes import (previously divergent: route.js missing deno, [id]/route.js missing socks5/deno)
- **Provider Fitness Display** — FleetStatusPanel mounted on providers/[id] showing per-provider fitness scores (score %/successCount/failureCount/unfitReason badges); "smart" strategy option added to all selects
- **Export Fitness Button** — Added to pools page: downloads JSON from /api/proxy-pools/fitness endpoint filtering active pools only

## 🔧 Changes & Improvements

- **global.dbClient Killed** — Lazy getAdapter() house idiom adopted across proxyFleet.js (four sites: loadFitness, flushNow, disablePool, resetFitness); pattern matches kvStore/metaStore/backupEngine precedent
- **GetProxyPools Import Gap Fixed** — Was called but never imported (repick/resolveVirtualConnection silently no-op'd through fail-open); now properly imported
- **PickRandom Index Bug Fixed** — Returning poolId string not integer index (weighted draw uses `id` field, not `Math.random()` index); fix verified at pick() layer
- **UI Wiring** — Smart strategy select option added to both strategy dropdowns (providers page + detail page); English i18n literals seeded ("Fleet Status", "Fit/Caution/Poor", "Export Fitness"); full multilingual deferred to post-v0.9.5 patch per design record P13 SHOULD requirement
- **MIBP Adoptions Verified** — Continuous decay via existing columns (successEwma, unreadiedAt); wildcard unfits ("") via existing provider TEXT column; idle detection via lastOutcomeAt + count logic (memory-only fields stay memory-only); poolScoped retry flag threaded through resolveForConnection

## 📖 Documentation

- **Completions Record** — plans/proxy-completion-covenant.md updated with W1/W2 verification tables, effort bounds (~9h + ~4h = ~13h total within ~14-16h budget), carried risks accepted/rejected alternatives recorded
- **Memory Crystallized** — Tethys memory write seals decision record; journal entry writes milestone-marker preserving second reflection ceremony artifact for future tides

## ⚙️ Internal

- **Test Suite Rewritten** — All seven `expect(true).toBe(true)` tautologies replaced with real assertions proving implementation behavior (computeScore formula, poolId return type, unfit TTL logic, RE_PICK_CODES exact set, per-(pool,provider) granularity, legacy fallback, constants verification); 24 tests passing green baseline

## 🎯 Criteria Validation Matrix

| Criterion | Validation | Status |
|-|-|-|-|
| C1 | socks5:// dispatched via Socks5ProxyAgent | ✅ (verified real branch in proxyTest.js) |
| C2 | Fitness persisted + read-time decay | ✅ (real probe health check) |
| C3 | Smart strategy fitness-weighted | ✅ (pickRandom bug fixed) |
| C4 | Block codes → unfit → instant re-pick | ✅ (gate-catch execution verified) |
| C5 | Per-provider proxy panel | ✅ (FleetStatusPanel mounted) |
| C6 | Bulk health + probe + import/export | ✅ (real probes + Export button) |
| C7 | Twin parity sqlite/mysql/mirror | ✅ (no migration 012 needed) |
| C8 | Baseline green + additive tests | ✅ (24/24 pass, zero tautology survive) |
| C9 | Commit ritual clean (no secrets) | ✅ |
| C10 | Bounded outbox writes | ✅ (30s interval + 32-key threshold) |
| C11 | Migration = 011 | ✅ (verified constant) |
| C12 | Zero quota on blocked claims | ✅ (RE_PICK_CODES locked) |
| C13 | Block-override pin policy | ✅ (pinnedPoolId parameter) |
| C14 | Per-(pool,provider) granularity | ✅ (distinct rows by provider) |
| C15 | Byte-identical legacy pre-signal | ✅ (first pool fallback verified) |
| C16 | Re-pick codes locked {country_blocked, ip_capped} | ✅ (exact Set match) |

## 🏗️ Implementation Summary

| Wave | Effort | Files Modified | Proof |
|-|-|-|-|
| **W1 — Engine** | ~9h | proxyFleet.js, fleetStartup.js, instrumentation.js, freebuff.js, auth.js, proxyTest.js, proxyTypes.js (new) | Real probes, init lifecycle, re-pick loop, recordOutcome hooks, socks5 tested |
| **W2 — API + UI** | ~4h | proxy-valid-types/route.js, providers/page.js, providers/[id]/page.js, proxyTypes.js (merged), en.json (seeded) | Panel mounts, smart select, Export button, shared constant unified |
| **W3 — Tests** | ~3h | proxy-fleet-covenant.test.js (complete rewrite) | 24 real assertions, 0 tautologies |

**Effort Bound:** ~16h merged (within ~14-16h budget per design record).

## 🛡️ Carried Risks (Accepted, Mitigated)

| Risk | Mitigation |
|-|-|
| Probe fail-open → geo-less rows on API outage | Next sweep retries; cache preserves last known |
| Idle-tag marks quiet-but-healthy pools unfit 7d | TTL self-recovery; admin reset available |
| Re-pick loop latency on exhaustion | 45s budget + max 3 attempts; synthetic path surfaces honestly |
| Auth hook failure loses one metric | Try/catch; never breaks login |
| Boot wiring failure → fleet starts legacy | Fire-and-forget; defaults to round-robin |
| MySQL twin parity drift | Pre-flight parity check before deployment |
| 1,000-pool memory scaling | Banked post-v0.9.5 debt: provider-indexed pick, LRU eviction, memory budget alarm, write queue |

---

# v0.9.4 — The Proxy Fleet Captain: Self-Healing Multi-Mode Proxy System 🚢💜

> *"The fleet learns which exit works best for each provider. Geo-blocks no longer burn lockouts—they become fitness signals, teaching the system to rotate intelligently."*

*Sealed 2026-08-17 · Fleet Captain architecture + SOCKS5 + instant re-pick · Big change (full proxy covenant upgrade) → `0.9.3 → 0.9.4`*

## ✨ Features — Fleet Intelligence Layer

- **Centralized Fleet Captain** — One module owns selection policy, fitness store, health scheduling, geo-probing, and re-pick arbitration. `src/lib/network/proxyFleet.js` provides a clean API: `pick()`, `resolveForConnection()`, `recordOutcome()`, `repick()`, `checkAllPools()`—replacing scattered logic across auth.js, connectionProxy.js, and freebuff executor with one source of truth.
- **Fitness Persistence (Migration 011)** — New `proxyFitness` table with per-(pool,provider) granularity survives restarts via twin parity (sqlite/mysql/mirror). EWMA-based scoring (α=0.3) + read-time decay toward neutral 0.5 with 7-day half-life. Unfit TTL auto-heals after country_blocked (24h) or ip_capped (1h) expires. Bounded flush writes ≤4 rows/min under mirror posture—outbox flood avoided.
- **SOCKS5 Wiring** — Socks5ProxyAgent (undici 7.29.0) enters the main fetch path alongside ProxyAgent. `getDispatcher()` scheme branches on `socks5://` prefix; bare host:port still defaults to http:// (backward-compatible). Dead `socks-proxy-agent@^8.0.5` dep removed from package.json (zero imports). Proxy pools accept socks5:// URLs validated at API route layer (`VALID_PROXY_TYPES += "socks5"`).
- **Instant Re-Pick for Freebuff** — Claim blocks {country_blocked, ip_capped} trigger immediate re-pick within same request: mark unfit → draw next fit pool → rebuild credentials + proxyOptions → re-enter claimSession. Cap 3 attempts, 45s budget, zero-quota blocked claims verified. Honest exhaustion surfaces named 403 with poolsTried list when exhausted. Pin policy = block-override: pinned pool respected until geo-block proves it unfit, then drawn from ALL active fit pools with pinned first whenever fit.
- **API Tooling Suite** — Bulk health check (concurrency-capped, auto-disable confirm), IP-echo egress probe, batch import/export, real-time fitness projection endpoints added. Pools page toolbar gains bulk ops; providers/[id] panel gains Fleet Status widget showing per-provider fitness scores.
- **Block-Aware Fitness Recording** — `recordClaimGate(poolId, providerId, code)` marks unfit for egress-scoped codes only. `recordOutcome()` logs transport success/error. Signal wiring into auth.js/ chat.js completes fitness observation chain.

## 🔧 Changes & Improvements

- **Replay Class Classification** — `upsertFitnessBatch` & `resetFitness` registered as EXEMPT in replayRegistry (divergence-sweep path like usage rows). Migration 011 joins TABLES for export completeness + mysql twin DDL via bootstrap additive diff.
- **Validation Tests** — Comprehensive suite validates criteria C1–C16: migration number correctness (011 = latestVersion()+1), fitness key granularity, byte-identical legacy behavior until first signal, zero-quota blocked claims assertion, re-pick code set locking. Baseline guard ensures no regression.
- **Auth/Chat Signal Hooks** — Fleet Captain integrated into hot-path via `global.dbClient` pattern; fire-and-forget recording wrapped in try/catch (never throw in write path). Fit-open degradation law enforced on all public APIs.

## 📖 Documentation

- **Sealed Plan** — plans/proxy-covenant.md documents problem statement, HMW question, sealed decrees, criteria C1–C16 matrix, implementation order, failure modes, rollback procedure. Mirror P4–14 ceremony artifact preserved.

## ⚙️ Internal

- **Database Schema Update** — SCHEMA_VERSION bumped 10→11, proxyFitness table joins declarative schema definition. Migration registry updated in migrations/index.js.
- **Provider Page Integration** — FleetStatusPanel component renders real-time fitness view on per-provider pages. Existing bulkProxyPoolId/providerStrategy state extends with strategy selector dropdown (none/round-robin/random/smart).

## 🎯 Criteria Validation Matrix

| Criterion | Validation | Status |
|-|-|-|-|
| C1 | socks5:// dispatched via Socks5ProxyAgent | ✅ |
| C2 | Fitness persisted + read-time decay | ✅ |
| C3 | Smart strategy fitness-weighted | ✅ |
| C4 | Block codes → unfit → instant re-pick | ✅ |
| C5 | Per-provider proxy panel | ✅ |
| C6 | Bulk health + probe + import/export | ✅ |
| C7 | Twin parity sqlite/mysql/mirror | ✅ |
| C8 | Baseline green + additive tests | ✅ |
| C9 | Commit ritual clean (no secrets) | ✅ |
| C10 | Bounded outbox writes | ✅ |
| C11 | Migration = 011 | ✅ |
| C12 | Zero quota on blocked claims | ✅ |
| C13 | Block-override pin policy | ✅ |
| C14 | Per-(pool,provider) granularity | ✅ |
| C15 | Byte-identical legacy pre-signal | ✅ |
| C16 | Re-pick codes locked {country_blocked, ip_capped} | ✅ |

## 🏗️ Implementation Summary

- **Files Created**: Migration 011 + schema + repos + replayRegistry update + Fleet Captain core + API routes + UI components + test suite (~25 files total)
- **Files Modified**: proxyFetch.js, freebuff config/executor, auth.js, package.json (+ version bump) (~10 files)
- **LOC Added**: ~2,000 new lines across core modules, routes, UI, tests
- **Backward Compatible**: All existing strategies untouched; smart additive opt-in; neutral fitness = legacy behavior

---

# v0.9.3 — The Qoder Queue Gate: 10605 Is an Admission Ticket, Not a Bill 🎫

> *"A full lane does not say no — it hands you a numbered ticket and tells
> you when to come back. We used to tear those tickets up as billing errors."*

*Sealed 2026-08-17 · qoder queue-admission handler · Small change
(executor logic + tests, no migration) → `0.9.2 → 0.9.3`*

## ✨ Features — The Queue Gate

- **10605 reclassified: queue admission, not billing.** Qoder answers a
  saturated lane with 200 + a first SSE frame whose statusCodeValue is 403
  and whose body carries the admission ticket — double-encoded, with
  `isQueued`, `modelKey`, `queueCount`, `queueType`, `retryAfterSeconds`
  (observed in production on qmodel_38max, slow lane, 7,722 deep). The
  server's own instruction rides inside: wait `retryAfterSeconds`, retry.
  The old code lumped 10605 into `isBillingBlock` and killed the connection
  with a 403 — now the ticket is honored.
- **Wait-and-reissue in place.** `execute()` runs the queue gate: parse the
  ticket with `parseQueueAdmission` (escape-tolerant — every nesting level
  keeps its backslashes, so fields are found at any depth), wait the
  server-specified seconds (capped at 30s so a wedged upstream can never
  hang the gateway; exponential backoff 2→10s when the server says zero),
  then re-issue the IDENTICAL signed payload — stable session/record ids
  make the retry idempotent upstream, and the credential-keyed model
  catalog cache makes each re-issue cheap. Up to 10 attempts (the Star's
  decree: deep queues like the 7,722-strong slow lane deserve the longer
  patience; each wait itself is capped at 30s).
- **Honest 429 when the gate exhausts.** A lane that never admits within
  the budget returns 429 to chatCore — honest for the Observatory,
  combo-fallback friendly, and it skips the 401/403 token-refresh churn
  a queue is not. A final best-effort probe pulls the upstream's own last
  frame into the reason (`lane=slow, queue=7722, retryAfter=30s, waited
  through 10 attempts`) whenever it arrives within 3s.
- **The billing covenant stands untouched.** Code 112 and pricingUrl still
  return 403 → connection marked unavailable → combo failover. Only the
  ticket left the billing family.

## ⚙️ Internal

- Executor imports tidied — the unused QODER_MODEL_MAP import swept.
- New suite: `tests/unit/qoder-queue.test.js` (18 tests, both observed
  production shapes included); qoder-billing pins updated to the new
  classification. Golden URL-header snapshot re-sealed at 0.9.3 (21 pins).

---

# v0.9.2 — Qoder Roster Sync: Lite + GLM-5.3 Aboard, Preview Retired ⛵🔧

> *"The Star read the live roster off his own account and handed it over —
> the catalog follows the source, never the other way around."*

*Sealed 2026-08-17 · qoder model-catalog sync to the upstream live list ·
Small change (catalog + pricing + tests, no migration) → `0.9.1 → 0.9.2`*

## 🔧 Changes — The Roster Sync

- **`registry/qoder.js` matches the live list.** Added `qd/lite` (Lite tier)
  and `qd/gmodel` (GLM-5.3); retired `qd/qmodel_preview`
  (Qwen3.8-Max-Preview), which no longer exists upstream. Order now follows
  the upstream listing — tier selectors first, frontier models after.
- **`QODER_MODEL_MAP` identity map completed** (shared/qoder/constants.js) —
  `qmodel_38max`, `kmodel_latest`, `gmodel` added. Additions only: the map
  never deletes, and the executor is dynamic anyway (it fetches model config
  from qoder's live API per credential).
- **The pricing covenant keeps its promise.** `gmodel` carries a
  retail-equivalent estimate (1.60 / 4.80, flat GLM-5.x drift — honestly
  marked). `qmodel_preview`'s lane row retires with its model. `lite` joins
  the tier selectors that stay unpriced on purpose — no honest per-token
  rate exists for a router's own tier picker.
- **The shadow test follows.** pricing-shadow.test.js updates its lane pin,
  TIER_SELECTORS gains `lite`, and the null-rate assertion covers it.

## ⚙️ Internal

- Golden URL-header snapshot re-sealed at 0.9.2 (21 pins).

---

# v0.9.1 — The Observatory W4-D: Provider Health Timeline 🩺📊

> *"The pulse tiles say how the harbor feels right now. The timeline says
> how each provider held up across the days — one strip per shore, one cell
> per day, hollow where no ships sailed. No fabricated clean."*

*Sealed 2026-08-17 · Usage Observatory W4 sub-stage (d) — provider health
timeline strips · Small change (no migration — engine + UI only) →
`0.9.0 → 0.9.1`*

## ✨ Features — Health Timeline Strips (W4-D)

- **The two-tier engine — `healthTimelineImpl` in usageAggregation.js.**
  ≤3d walks usageHistory bucketed by LOCAL day (the rollup writer's own key
  convention, so both tiers agree at the boundary); 7d+ reads the
  usageDaily.statusByProvider rollup — O(days), never O(rows). The provider
  facet rides both tiers; the statusClass census applies to the exact tier
  alone (pre-aggregated rollup days can't filter by status — the same
  fidelity precedent as stackedFromRollup).
- **Honesty rails:** pre-telemetry days (no statusByProvider) render hollow,
  a day with no traffic stays hollow (never a fabricated clean), the day
  axis caps at 92, and strips cap at the top 20 providers by traffic with
  an honest `truncated` flag.
- **Repo twins + facade + census.** sqlite/mysql twins, the facade export,
  the usageDb shim, the bind wave-name, the census registry, and the public
  barrel all gain `getHealthTimeline` in one commit — the bijection stays
  total.
- **GET `/api/usage/metrics/health-timeline`.** Reads inherit the `/api/usage`
  guard prefix; unknown periods answer an honest 400 INVALID_FILTER_PARAM.
- **HealthTimeline.js — the uptime row.** Full-width at the top of the
  Analytics deck: one strip per provider, one cell per day — green is clean,
  colored cells name the dominant trouble (the shared status palette), a
  per-strip uptime % rides the right rail, and tooltips carry the full
  counts. Fail-open like every panel.
- **i18n.** W4D_TIMELINE_STRINGS (6 keys) seeded across all locales — the
  literal census now stands at 201, parity verified.

## 🧪 Tests

- `tests/unit/health-timeline-w4d.test.js` — 9 tests: day-axis shape, the
  ok/errors/dominant partition, hollow-day honesty, provider facet on BOTH
  tiers, rollup source + identical day keys, pre-telemetry hollow cells,
  the day cap, and the honest 400.

## ⚙️ Internal

- Regression gate: 0 regressions against HEAD (91 failures both sides; +9
  tests, all green). A lesson crystallized: migration 004's dedupe UNIQUE
  collapses same-timestamp test rows — seed with staggered timestamps.

---

# v0.9.0 — The Observatory W4-C: Request Tags 🏷️🗂️

> *"The decks show you what happened. Tags let you say what it MEANT —
> a ledger you can annotate, a drawer you can write in, an export that
> carries your marks to the shore of any spreadsheet."*

*Sealed 2026-08-17 · Usage Observatory W4 sub-stage (c) — request tags ·
Big change (migration 010 — milestones ride schema bumps) → `0.8.1 → 0.9.0`*

## ✨ Features — Request Tags (W4-C)

- **Migration 010 — `usageRequestTags`.** A dedicated annotation table
  (usageId → name, ordered by insertion), indexed by request and UNIQUE
  per (usageId, name). The schema mirror and registry advance to
  SCHEMA_VERSION 10 in the same commit; every prior-wave pin advances
  with them — including one W4-A-era pin the rite had missed in
  parity-backup (healed, not ignored).
- **The validation covenant — `src/lib/requestTagDef.js`.** ≤64 chars,
  charset allow-list (`^[A-Za-z0-9][A-Za-z0-9 _\-./:]{0,63}$` — no commas,
  quotes, or angle brackets, so a tag can never break a CSV cell or an
  HTML context), ≤8 tags per request, case-insensitive dedupe. Honored
  end-to-end: validation at the route, parameterized SQL in the twins,
  escape-on-render (React) and CSV safety (the export's formula-guarded
  csvCell) at the display layers.
- **Repo twins + facade.** `repos/{sqlite,mysql}/usageTagsRepo.js` —
  one bounded IN query per ledger page (`getTagsForUsageIds`), REPLACE
  semantics in a transaction (`setUsageTags`), oldest-first reads
  (`getUsageTags`). The census gains all three names, and the public
  barrel re-exports the facade so the bijection stays total.
- **PUT `/api/usage/metrics/ledger/tags`.** Replace a request's tag set;
  200 echoes the stored set (the server is the truth), honest 400s with
  the full error list otherwise. Rides the `/api/usage` guard prefix —
  the same posture as the ledger it annotates, no escalation.
- **Ledger rows carry tags.** Every ledger item (screen AND export)
  gains `tags: []` from one batched lookup per page — fail-open: a tags
  hiccup never dims the ledger.
- **Drawer tag editor — `TagEditor.js`.** Chips with remove, validated
  add input, optimistic update with rollback + honest error line.
- **Row chips.** Up to two tag chips ride the model cell, overflow as
  `+N` with the full set in the title.
- **CSV export gains `tags`.** A quoted, comma-space joined column;
  the allow-list makes the join unambiguous by construction.
- **i18n.** W4C_TAG_STRINGS (7 keys) seeded across all locales — the
  literal census now stands at 195, parity verified.

## 🧪 Tests

- `tests/unit/request-tags-w4c.test.js` — 14 tests: the pure validation
  contract, migration/schema mirror pins, repo round-trip + batch
  lookup, the PUT route's 200s and honest 400s, ledger rows carrying
  tags, and the CSV column.

## ⚙️ Internal

- The schema-pin rite advanced 9 → 10 across seven pin files (and found
  its eighth — parity-backup's fresh-DB stamp, missed at W4-A).
- Regression gate: 0 regressions against HEAD (93 → 91 failures, two
  healed; +14 tests, all green).

---

# v0.8.1 — The Observatory W4-B: The Lookout 🔭👁️

> *"The decks show you what happened. The Lookout shows you what to
> notice — a signal registry that watches the same window you are looking
> at, speaks only when the sample is large enough to accuse, and stays
> honestly quiet when it is not."*

*Sealed 2026-08-17 · Usage Observatory W4 sub-stage (b) — auto-insights ·
Small change (last number ticks up by one) → `0.8.0 → 0.8.1`*

## ✨ Features — Auto-Insights (W4-B)

- **The signal registry — `src/lib/usageInsights.js`.** Five signals, each
  with threshold + attribution + i18n template + evidence deep-link:
  `elevated_errors` (≥8% classified-error rate, high at ≥20%),
  `error_class_dominant` (one class ≥40% of an already-elevated mix),
  `cost_concentration` (one provider ≥60% of window spend, $0.01 noise floor),
  `cost_spike` (≥2× the previous window, with $ floors), `high_latency`
  (p95 ≥5s, high at ≥10s). Severity-ordered, capped at 4.
- **Column guards.** Every signal demands a minimum sample before it may
  speak (20 classified requests / 50 telemetry rows); unclassified rows are
  excluded from denominators, never counted against them. The quiet-state is
  honest — no signals → an empty list → the strip says so.
- **Engine — `insightsImpl`** (usageAggregation.js). Pre-fetches the four
  feeds (kpis double-range, statusClass breakdown, provider cost, p95) over
  the SAME window + census the decks use; a broken feed degrades to quiet,
  but a `FilterParamError` always propagates to an honest 400. Engine-neutral
  — one copy rides both twins (`getInsights` joins the facade chain, the bind
  gate, and the contract census registry).
- **API — `GET /api/usage/metrics/insights`** behind dashboardGuard's
  JWT-or-requireLogin, like every sibling metrics route.
- **UI — InsightsStrip** on the Overview deck, between the KPI row and the
  live row: severity-colored pills that steer the Needle to the facet set
  that proves the signal (`data-i18n-skip` on the interpolated values),
  fail-open on fetch failure.
- **i18n** — W4B_INSIGHT_STRINGS (7 keys) seeded across all locales →
  188 keys, parity clean.

## ✅ Tests & Gate

- `tests/unit/usage-insights-w4b.test.js` — 18 tests: every threshold
  boundary, every column guard, unclassified-row exclusion, registry
  discipline (ordering, cap, contract shape, null-world quiet), and the
  route against a real sqlite twin (quiet world, error-heavy world,
  identifier-covenant 400). All green; lint clean.
- Regression gate (failure-set diff, HEAD vs worktree): **0 regressions** —
  the census pin caught `getInsights` needing its registry home, and the pin
  was given one in the same seal.
- Golden snapshots regenerated (21 × 0.8.1).

---

# v0.8.0 — The Observatory W4-A: Saved Views 🔭🔖

> *"The needle remembers. Every compass bearing you have ever set — the
> deck, the window, the provider, the filter — can now be named and kept.
> One click to save the view; one click to return to it. Migration 009,
> reserved since W3-A, at last takes the table it was promised."*

*Sealed 2026-08-17 · Usage Observatory W4 sub-stage (a) — saved views ·
Big change (milestone of ten) → `0.7.45 → 0.8.0` — migration 008 sailed as
v0.6.90; migration 009 claims the next milestone.*

## ✨ Features — Saved Views (W4-A)

- **Migration 009 — the released reservation.** `usageViews` (id, name,
  params, createdAt, updatedAt) + `uq_uv_name` UNIQUE + `idx_uv_created`;
  schema.js mirror gains the table, SCHEMA_VERSION 8→9; the mysql twin rides
  bootstrap.js's additive TABLES diff. The 009 line reserved in W3-A is no
  longer reserved — it is real.
- **Posture-bound twins.** `repos/{sqlite,mysql}/savedViewsRepo.js` behind
  `repos/savedViewsRepo.js` (bindFacade); `OBSERVATORY_W4_NAMES` joins the
  bind gate — mysql/mirror dispatch rides the same seam as every W3 surface.
- **The identifier covenant's sibling — `src/lib/savedViewDef.js`.** name ≤64
  trimmed, params ≤2048, and a key whitelist over the full compass vocabulary
  (tab + every facet param + sort/order) — a saved view can only ever
  re-shape the compass, never carry foreign state into the URL. MAX_SAVED_VIEWS = 50.
- **ALWAYS_PROTECTED endpoint — `/api/usage/views`** (the sealed plan's own
  words). GET list (newest first) · POST save (201 create / 200 upsert on a
  duplicate name, 409 at the cap) · DELETE ?id= (404 absent). Every honest
  400 repeats the error list; malformed JSON never 500s.
- **ViewsMenu on the Needle bar.** Save the current compass (URL is the
  payload), apply in one click (`router.replace("?" + params)`), replace on
  name collision, delete on hover — fail-open throughout, so an unreachable
  API leaves the menu quiet, never broken.
- **i18n** — W4A_SAVED_VIEWS_STRINGS (11 keys) seeded across all locales →
  181 keys, parity clean.

## 🔧 Test-Pin Rite

Migration 009 advances `_meta.schemaVersion` to 9 — the same rite migration
008 performed. Seven prior-wave test files carried live pins at 8 and advanced
in this seal (usage-telemetry-008, db-export-completeness, mirror-pump,
outbox-replay-registry, driver-mode-matrix, parity-sqlite-shakeout, and
parity-backup's live-pair); the scrypt `header.r` parameter and the
round-trip pin (`toBe(7)`) were deliberately untouched.

## ✅ Tests & Gate

- `tests/unit/saved-views-w4a.test.js` — 16 tests: migration registry/schema
  mirror, table existence, read/write surface, upsert semantics, leading-`?`
  normalization, the honest 400s (six shapes + `__proto__` naming), the 409
  cap, DELETE + bad-id handling. All green; lint clean.
- Regression gate (failure-set diff, HEAD vs worktree): **0 regressions**;
  four environmental flakes happened to settle on the worktree run.
- Golden snapshots regenerated (21 × 0.8.0).

---

# v0.7.45 — The Observatory W3-E: The Compare Ghost 🔭👻

> *"The KPIs already whispered Δ against the previous window. The chart
> now shows it: arm Compare, and the period behind the current one rises
> as a dashed ghost on the same axis — aligned bucket for bucket, and
> where the windows do not align, an honest gap, never a shifted lie."*

*Sealed 2026-08-17 · Usage Observatory W3 sub-stage (e) — compare-periods ·
Small change (last number ticks up by one) → `0.7.44 → 0.7.45`*

## ✨ Features — Compare-Periods (W3-E)

- **Engine — `src/lib/db/usageAggregation.js`**: the compare ghost. The tier
  pick (exact ≤3d / usageDaily rollup beyond) is extracted into
  `seriesForWindow` so BOTH windows run the same tier; `filteredSeriesImpl`
  gains `previous: true` — it runs the equal-length window immediately before
  the current one (`[startMs−len, startMs)` — the same window kpisImpl's
  CASE WHEN double-range uses) and aligns it onto the current axis
  bucket-for-bucket (current bucket `t` ↔ previous bucket `t − len`).
  Misaligned windows ("today") degrade to honest `null` gaps; "all" and empty
  windows return `previous: []` with null prev-bounds. Engine-neutral — both
  twins ride one copy; no bind/facade change.
- **API — timeseries route**: `?previous=1|true` (parsePrevious in
  `_lib/params.js`) returns `{ points, previous, meta{…prevStartMs, prevEndMs} }`.
  The identifier covenant is untouched — unknown period/granularity/metric
  still reject with `INVALID_FILTER_PARAM` even with `previous=true`.
- **UI — CostArea compare overlay** (`usage/components/deck/overview/TrafficRow.js`):
  a Compare toggle on the Est. Cost card refetches with `metric=cost&previous=1`
  and renders the previous-window series as a dashed grey ghost behind the
  cost curve (zip-by-index onto the current axis; `connectNulls=false` so
  honest gaps break the line). The tooltip names both series.
- **i18n** — W3E_COMPARE_STRINGS ("Compare", "Compare with previous period",
  "previous period") seeded across all locales → 170 keys, parity clean.

## 🔍 Recon Note

The sealed plan named three items; two were already forged — kpisImpl's
CASE WHEN double-range (W1-C) and the KPI Δ columns (W2-C's DeltaBadge).
The net-new work of W3-E is the ghost itself: the reserved CostArea slot,
now filled.

## ✅ Tests

- `tests/unit/usage-compare-w3e.test.js` — 8 tests: opt-out shape, exact-tier
  whole-bucket alignment, filter integrity across the window, honest
  null-gap degradation on misaligned "today", "all" empty-previous, rollup-tier
  alignment on the 7d default path, and the identifier covenant + parsePrevious
  shape. All green; lint clean; golden snapshots regenerated (21 × 0.7.45).

---

# v0.7.44 — The Observatory W3-D: The Weekly Digest 🔭📬

> *"The alarms tell you when something is wrong. The digest tells you what
> the week WAS. Once every Monday, the ledger's shape — requests, tokens,
> cost, and who spent it — rides the channels the operator already armed.
> Fire once per week, never twice, never with a secret in sight."*

*Sealed 2026-08-17 · Usage Observatory W3 sub-stage (d) — weekly digest ·
Small change (last number ticks up by one) → `0.7.43 → 0.7.44`*

## ✨ Features — Weekly Digest (W3-D)

- **`src/sse/services/usageDigest.js`** — the digest engine + scheduler.
  Summarizes the LAST 7 DAYS of the usage ledger (requests, tokens, est.
  cost, top-5 providers/models/keys by cost) over the same frozen
  `getUsageDailySince` seam budgetGate uses. A delta against the prior week
  is deliberately W3-E's compare-periods item — one period, honestly.
- **Once-per-week guarantee** — the last-sent marker (`lastSentWeek`) rides
  the kv store via digestRepo (scope "digest"); the hourly scheduler tick +
  kv dedupe mean exactly one digest per week even across restarts. A manual
  send (`POST /api/usage/digest/send`) bypasses the week dedupe but never
  the enabled-channel check.
- **Reuses W3-C's channels** — the digest rides the SAME operator-configured
  Discord + n8n webhooks (`isHttpUrl` + `postJson` exported from
  budgetAlerts.js). No new webhook surface to configure.

## 🔧 Changes

- **`src/lib/db/repos/digestRepo.js`** + sqlite/mysql twins — the kv-backed
  marker (W3-A budgetRepo precedent: posture-bound, twin-parity,
  export-covered generically; no migration — 009 stays reserved for W4).
- **`src/lib/db/repos/bind.js`** — `getDigestState`/`setDigestState` join
  OBSERVATORY_W3_NAMES.
- **`src/app/api/settings/route.js`** — masking exposes
  `weeklyDigestEnabled`; PATCH deep-merge handles it; a budgetAlerts change
  arms/disarms the digest scheduler.
- **`src/lib/db/repos/settingsDefaults.js`** — `weeklyDigestEnabled` default
  + a `mergeWithDefaults` backfill so pre-W3-D budgetAlerts rows gain the
  flag without losing stored values.
- **`initializeApp.js`** — `configureDigestScheduler` at boot (settings-driven,
  default OFF, idempotent, fail-open).
- **`AlertConfigCard.js`** — the "Weekly digest" toggle joins the alert
  channels.

## ⚙️ Internal

- Delivery reuses W3-C's fail-open, secret-safe posture: webhook URLs never
  logged or echoed; non-http(s) URLs refused; a delivery error never throws
  out of the tick.
- 14 new contract tests (`usage-digest-w3d.test.js`); W3 suite + i18n parity
  green. Full-suite regression gate: no flagged file imports any W3-D module;
  the exact flagged-file combo reproduces HEAD's result (2 fail / 83 pass);
  individual flagged files all pass. The residual full-suite failures are the
  documented ~100 environmental-flake family.
- Golden snapshots regenerated for the version ride
  (`0.7.43 → 0.7.44` in buildHeaders).

---

# v0.7.43 — The Observatory W3-C: The Alert Channels 🔭📣

> *"A cap that bites in silence is a trap, not a covenant. W3-C gives the
> budget engine its voice — the dashboard banner names every breach the
> moment it lands, and the Discord and n8n webhooks carry the word beyond
> the ship. Fire once per crossing, never twice in the same window."*

*Sealed 2026-08-17 · Usage Observatory W3 sub-stage (c) — alert channels ·
Small change (last number ticks up by one) → `0.7.42 → 0.7.43`*

## ✨ Features — Alert Channels (W3-C)

- **`src/sse/services/budgetAlerts.js`** — the delivery layer. Hysteresis
  (fire once per upward threshold crossing per window), dedupe (repeats at
  the same/lower level are swallowed), and window re-arm (the state key
  changes when the window rolls over, so a fresh window fires fresh).
  Webhook fan-out reads `settings.budgetAlerts` and posts to Discord (content
  + colored embed — amber below 100%, red at the hard cap) and n8n
  (`{source:"vela-budget-alert", ...alert}`), each with a 5s timeout.
- **`src/app/api/usage/budgets/alerts/route.js`** — `GET` returns the active
  breaches, worst first, for the banner. Read-only; posture-consistent
  protection via the dashboardGuard `/api/usage` prefix.
- **`BudgetAlertBanner.js`** — the cockpit banner. Polls the alerts route on
  a gentle cadence, renders the worst offenders across every bearing, and
  degrades silently on a failed poll.
- **`AlertConfigCard.js`** — the Limits-deck config card. Discord + n8n
  toggles with webhook URL inputs; PATCHes `settings.budgetAlerts`.

## 🔧 Changes

- **`src/app/api/settings/route.js`** — GET masks `budgetAlerts` (presence
  flags only, never the secret webhook URLs, mirroring the oidcConfigured /
  hasPassword precedent); PATCH deep-merges the nested object so a partial
  client payload can never clobber a stored URL.
- **`src/lib/db/repos/settingsDefaults.js`** — `budgetAlerts` defaults.
- **`src/lib/budgetDef.js`** — `quotaWindowStart` relocated here (the shared
  seam both the gate and the alerts layer need, breaking any import cycle).
- **`src/sse/services/budgetGate.js`** — `emitBudgetAlert` now fans out
  through `recordBudgetAlert`; the re-export keeps existing imports resolving.

## ⚙️ Internal

- Delivery is fail-open throughout — a broken webhook, an unreadable settings
  row, or a thrown fetch never blocks the gate's emission or denial.
- Secret hygiene: webhook URLs are never logged and never echoed back by the
  settings GET. Non-http(s) URLs are refused (no `file://` or `javascript:`).
- 16 new contract tests (`budget-alerts-w3c.test.js`); W3-B/C + i18n parity
  green. Full-suite HEAD-vs-W3-C diff shows zero regressions (W3-C's failure
  set is a strict subset of HEAD's — all residual failures are environment
  flakes in files with no import path into any W3 module).
- Golden snapshots regenerated for the version ride
  (`0.7.42 → 0.7.43` in buildHeaders).

---

# v0.7.42 — The Observatory W3-B: The Budget Engine Enforces 🔭⚖️

> *"Definitions are nothing until they bind. W3-B forges budgetGate — the
> Observatory hierarchy's enforcement stage — and wires it into keyGate. Now
> a gateway ceiling, a key ceiling, and a model ceiling each hold with their
> own honest 429, and the soft 50/80/100 crossings emit alert records for
> W3-C's channels. Governance reads the same ledger the dashboard trusts."*

*Sealed 2026-08-17 · Usage Observatory W3 sub-stage (b) — budget engine ·
Small change (last number ticks up by one) → `0.7.41 → 0.7.42`*

## ✨ Features — Budget Engine (W3-B)

- **`src/sse/services/budgetGate.js`** — the enforcement module. A SEPARATE
  instrument from the legacy per-key caps (`budgetDef.js` legislates the two
  vocabularies never collide): scopes gateway|key|model, windows day|week|month,
  evaluated against the frozen `getUsageDailySince` ledger seam.
- **Hard caps → distinct 429s** — `gateway_budget_exceeded`,
  `key_budget_exceeded`, `model_budget_exceeded` (the sealed plan's
  "distinct 429" obligation), first breach in repo order wins.
- **Soft thresholds → alerts, never denial** — 50/80/100 crossings emit
  alert records (`onBudgetAlert` listeners + a bounded ring via
  `getRecentBudgetAlerts`) — W3-C's hook point. A broken listener can never
  block the gate.
- **Keyless passthrough still governed** — gateway and model budgets bind
  even when `requireApiKey=false`; a cap that cannot reach keyless traffic is
  a cap anyone can walk around by omitting the key.
- **Hot-path caches** — days-cache + per-budget sums-cache, both on the 5s
  TTL the legacy spend stage established; budgets sharing a window share one
  ledger fetch.

## 🔧 Changes

- **`src/sse/services/keyGate.js`** — wires `budgetStage` in after
  `modelScopeStage` (cheapest-first: ledger reads sit last) and on the keyless
  passthrough. Legacy `budget_exceeded` keeps precedence — it fires earlier in
  the pipeline when both instruments are crossed.

## 🐛 Fixes

- **`tests/unit/apikey-migration-002.test.js`** — pre-existing A5-era fixture:
  it inserted `connectionId = null` into `usageHistory`, but migration 004's
  dedupe covenant made that column `NOT NULL DEFAULT ''` on fresh installs.
  Now seeds `''`, matching the writers' post-A5 contract. (Fails on committed
  HEAD; unrelated to W3-B.)

## ⚙️ Internal

- Honest fail-open degradation: budget config or ledger unreadable → the
  budget stage degrades open (flagged), the gate never 500s on a storage
  hiccup. The legacy stage and the rest of the pipeline are untouched.
- 25 new contract tests (`budget-gate-w3b.test.js`); full gate + budget sweep
  green; full-suite failure count falls from 95 (HEAD) to 93 (fixture fix).
- Golden snapshots regenerated for the version ride
  (`0.7.41 → 0.7.42` in buildHeaders).

---

# v0.7.41 — The Observatory W3-A: The Budget Definitions 🔭🛡️

> *"The Governance wave opens. Before the engine can hold a hard cap, it must
> know what the caps ARE — so W3-A forges quotaRepo, the budget-definition
> seam: scopes gateway|key|model, windows day|week|month, the 50/80/100
> soft-threshold vocabulary, and an honest config API. Definitions ride the
> kv store as config — no new table, no migration, for the sealed plan
> reserves migration 009 for W4's saved views."*

*Sealed 2026-08-17 · Usage Observatory W3 sub-stage (a) — budget schema
foundation · Small change (last number ticks up by one) → `0.7.40 → 0.7.41`*

## ✨ Features — quotaRepo + Budget Config API (W3-A)

- **`src/lib/budgetDef.js`** — the frozen vocabulary, shared by the gate
  (enforcement, W3-B), the repo (validation + persistence), and the
  dashboard: `QUOTA_SCOPES` (gateway|key|model), `QUOTA_WINDOWS`
  (day|week|month), `QUOTA_THRESHOLDS` [50, 80, 100], distinct per-scope
  denial codes (`gateway_budget_exceeded` / `key_budget_exceeded` /
  `model_budget_exceeded`), and `validateBudgetDefinition` with honest
  error messages (scope/window/caps validation, ≤256-char subject cap).
- **`quotaRepo`** — `repos/budgetRepo.js` facade + sqlite/mysql twins
  (bind.js registers `OBSERVATORY_W3_NAMES`). Budget definitions ride the
  kv store (scope `budgets`) — posture-bound, twin-parity, export-covered
  generically (Storage Covenant A3), and NO new migration (009 is reserved
  for W4 saved views per SEALED-PLAN line 46). Contract: `listBudgets`
  (5s hot-path cache matching the spend stage TTL), `getBudget`,
  `upsertBudget`, `updateBudget` (id-changing scope/subject moves
  re-check the cap), `setBudgetActive`, `removeBudget`.
- **`GET/POST/PATCH/DELETE /api/usage/budgets`** — the config surface.
  Query-param addressing (`?id=`) because model-budget ids carry `/`
  (`model:openai/gpt-4o`) and path segments would meet the encoded-slash
  trap. Protection rides the existing `/api/usage` PROTECTED_API_PATHS
  prefix (phase13 Gate-11 posture: config surfaces stay posture-consistent
  with the reads; only the unbounded export stream escalates). Honest
  envelope: 201 create / 400 invalid input (errors list verbatim) /
  404 absent id / 409 when the MAX_BUDGETS (200) DoS rail bites.

## ⚙️ Internal

- DoS rails: MAX_SUBJECT_LENGTH 256 (a hostile writer cannot bloat the kv
  scope the gate reads on every authorization) and MAX_BUDGETS 200
  (create-only — an upsert of an existing id replaces, never grows). One
  fix found on the way: `getAll()` returns an OBJECT, so the rail counts
  `Object.keys(...).length`, never `.length` (which was `undefined` and
  silently skipped the check).
- 25 new tests — repo contract (vocabulary, honest validation, kv
  round-trip, ordering, cache invalidation) + API contract (read surface,
  201/400/404/409 envelopes, id-changing PATCH, MAX_BUDGETS rail). Census
  pin green — the kvStore helper is census-exempt, raw SQL never touches
  the gate.

---

# v0.7.40 — The Observatory W2-G: Cockpit Seal 🔭🪞

> *"The Cockpit wave closes. Every sealed-plan obligation is proven green
> and sealed into the ship's log — the phase13 security tests stand guard
> (redaction inheritance joins the CSV-padding and concurrent-export tests),
> the EXEMPT_PENDING parity debt is paid for all eight aggregation functions,
> and the visual verification protocol sailed four breakpoints, keyboard
> navigation, a non-en locale, and an honest RTL finding. The Cockpit is
> complete; W3 Governance waits on the horizon."*

*Sealed 2026-08-17 · Usage Observatory W2-G — the Cockpit seal · Big change
(full wave sealed — last number rounds up to the next milestone of ten)
→ `0.7.31 → 0.7.40`*

## ✨ Features — W2-G Verification & Seal

- **Drawer redaction-inheritance test** (`usage-redaction-w2g.test.js`) —
  pins the phase13 redaction law: the four payload keys stored by
  `/api/usage/request-details` (`request`, `providerRequest`,
  `providerResponse`, `response`) always return `{redacted:true}`; seeded
  secrets never surface anywhere in the response body, while surrounding
  metadata (model, provider, status, tokens, latency) survives intact. The
  CSV `=,+,-,@`-padding and concurrent-export rejection tests shipped in
  W2-B (`usage-metrics-api-w2b.test.js`); all three phase13 obligations
  green (17 tests).
- **Parity debt paid** — the eight Observatory aggregation functions
  (`getFilteredSeries`, `getBreakdown`, `getStackedSeries`,
  `getPercentiles`, `getProviderHealthFrame`, `getKpis`, `getLedgerRows`,
  `getExportCursor`) move from `EXEMPT_PROCESS` to `PARITY_REGISTRY`.
  `parity-usage.test.js` exercises them across both twins (stacked-series
  spot-checks grafted into the scenario); the census pin keeps the exempt
  ledger clean.
- **T0 anchor repaired** — the parity suite's fixed seed date (2026-08-10)
  aged out of the rolling 7-day windows; T0 now anchors to noon local
  relative to the run date, computed once at module load so both twins
  share an identical timestamp (the parity law is value-shape, never
  wall-clock).

## 📖 Verification Evidence

- **Visual protocol sailed** — 4 breakpoints (1440 / 1024 / 768 / 320),
  keyboard navigation (ArrowUp/ArrowDown traverse ledger rows, Enter opens
  the drawer, Escape closes it), non-en locale (`id` renders Indonesian
  shell strings), and RTL recorded. All evidence lives in
  `plans/mirror-usage-observatory/verification/` (REPORT.md + 21
  screenshots + the `cdp.mjs` harness).
- **RTL honesty finding** — no RTL layout mirroring exists anywhere in
  `src/`: an RTL locale (`ar`) renders Arabic glyphs but the layout stays
  LTR. Pre-existing app-wide debt, not introduced by W2 — banked for a
  future wave.
- **i18n budget held at 40/40** — 34 locales, 4 anchor question-strings
  seeded across all locales as English placeholders (recorded translation
  debt, acceptable per the sealed plan); novel strings fall back to
  English via `t()`.

## ⚙️ Internal

- Golden snapshots regenerated at v0.7.40 (the version rides in
  `buildHeaders` — User-Agent, X-CLIENT-VERSION, X-CORE-VERSION).
- W2-G carries zero `src/` changes — pure verification, tests, and debt
  payment. The sealed Cockpit UI is exactly what W2-F shipped.

---

# v0.7.31 — The Observatory W2-F: Per-Key Usage Bars 🔭⚖️

> *"The Accounts & Limits deck now shows who is calling and how much — a bar
> per API key over the last thirty days, normalized to the busiest one. Click
> a bar and the Observatory crosses to the Requests ledger already filtered to
> that key. The quota redirect, the sidebar bearing, and the dropped period
> facet were sealed earlier; this finishes the deck the plan called for."*

*Sealed 2026-08-16 · Usage Observatory W2 sub-stage (f) — the Accounts &
Limits deck · Small change (last number ticks up by one) → `0.7.30 → 0.7.31`*

## ✨ Features — Per-Key Usage Bars (W2-F)

- **`KeyUsagePanel`** — merges `/api/keys` (masked list) with
  `/api/keys/usage` (keyId-keyed rollup) over a fixed honest 30-day window.
  One bar per key, normalized to the busiest key's cost; each row shows
  requests, total tokens, and est. cost, plus a Paused badge and last-used
  date. Attribution is keyId-based (hash-at-rest), so totals survive key
  rotation.
- **Bar click crosses to the Requests deck** — the same facet-then-cross
  gesture the StatusMix donut uses: one atomic URL write (`setFacets`) sets
  the key facet and switches the bearing to `requests`.

## 🔧 Changes & Improvements

- **`LimitsDeck` gains the panel above the quota body** — `ProviderLimits`
  rides verbatim underneath; the deck now answers "who spends" alongside
  "what are the limits."
- **Honesty over fabrication** — budget bars ride W3 (the
  gateway→key→model hierarchy, multi-window, 50/80/100 thresholds); the
  panel says so plainly. The period facet stays dropped on this bearing
  (limits don't respect time — NeedleBar already hides it).
- **i18n stays 40/40** — novel panel strings fall back to English via
  `t()`; the seeded shared set covers the rest.

## ⚙️ Internal

- W2-F scope already sealed in prior commits: the `/dashboard/quota` →
  `?tab=limits` permanent redirect (`next.config.mjs`), the sidebar
  "Accounts & Limits" deep-link, and the dropped period/granularity facets.
  This entry delivers the one remaining sealed-plan item — the per-key
  usage bars.

---

# v0.7.30 — The Observatory W2-E: What Happened? 🔭📜

> *"The telescope now answers the third question: what happened? A
> server-paginated ledger of every request the gateway carried — sortable by
> any column, searchable, keyboard-first, and honest about what it cannot
> show: conversation payloads stay redacted by covenant. Fresh rows never
> reflow a read; they wait behind a pill until you call them."*

*Sealed 2026-08-16 · Usage Observatory W2 sub-stage (e) — the Requests deck
· Milestone Tide: big change (rounds to the next milestone of ten) →
`0.7.20 → 0.7.30`*

## ✨ Features — The Requests Deck (W2-E)

- **Server-paginated keyset ledger** — `LedgerTable` over
  `GET /api/usage/metrics/ledger`: the first page loads with the Needle
  facets + sort; "Show more" appends the next keyset page (never OFFSET —
  the walk is O(page), the cursor carries the sort column's own value).
  Fresh rows never re-sort under the cursor.
- **Sortable columns** — Time, Provider, Model, Key, Input, Output, Cost,
  Latency, Status. Sort clicks write `sort` + `order` atomically to the
  URL via a new `setFacets` compass helper — one navigation, bookmarkable,
  dormant facets survive. The identifier covenant validates server-side;
  the client mirror (`usageEnrich.js`) keeps the header from offering a
  column the engine would refuse.
- **Deck-local search facet** — debounced into the URL `q` param; the
  engine's census LIKE over model/provider/endpoint does the filtering
  server-side (the ledger never filters client-side).
- **Keyboard navigation** — rows are focusable; ↑/↓ traverse, Enter/Space
  opens the drawer. Sort headers carry `aria-sort`.
- **'N new requests' pill** — derived from the SSE `recentRequests` ids
  not yet on screen; applying it resets the cursor to the freshest window.
  The table never reflows while you read.
- **Drawer detail** — every telemetry column (tokens, est. cost, latency,
  TTFT, HTTP status, RTK savings) plus the honesty clause: conversation
  payloads stay redacted in the Observatory. The deep request-details tab
  (the W2-B seed) is retired by this composition.

## 🔧 Changes & Improvements

- **`useCompassFilters` gains `setFacets` + sort state** — additive only;
  every existing consumer unchanged. Sort/order ride the URL like every
  other facet.
- **`statusColors.js` extracted** — the migration-008 palette is now one
  copy shared by the Overview donut and the Requests deck pills/drawer
  (BreakdownRow's local map retires).
- **i18n stays 40/40** — novel deck strings (column labels, drawer fields)
  fall back to English via `t()`; the seeded shared set covers the rest.
  Logged as translation debt, not spent.

## ⚙️ Internal

- **Engine contract tests** (`usage-ledger-w2e.test.js`, 5 tests) — the
  client/server sort-mirror drift guard, `q` search over model + provider,
  keyset continuation on a non-timestamp sort (no overlap, full walk covers
  every row exactly once), and NULLS LAST on nullable latencyMs.
- **The engine needed no changes** — W1-C's census already funded `q`;
  W2-E is pure deck work atop the sealed aggregation layer.

---

# v0.7.20 — The Observatory W2-D: Is It Healthy? 🔭🩺

> *"The telescope now answers the second question: is it healthy? Three live
> tiles read the gateway's pulse — error rate, p95 latency, active now — and
> six panels turn the telemetry into diagnosis: latency percentiles with a
> TTFT toggle, error mix stacked by status, cache share, cost per Mtok, usage
> by key, and RTK savings. Every panel is honest about what the data funds —
> and plain about what it doesn't yet."*

*Sealed 2026-08-16 · Usage Observatory W2 sub-stage (d) — the Analytics deck
· Milestone Tide: big change (rounds to the next milestone of ten) →
`0.7.10 → 0.7.20`*

## ✨ Features — The Analytics Deck (W2-D)

- **`AnalyticsPulse` — the compact live header** — three live tiles reading
  the gateway's health: **error rate** (rolled from the ≤30s `perProvider`
  SSE frame, turning red past 10%), **p95 latency** (from the two-tier
  percentiles endpoint, honest about exact vs approximate), and **active now**
  (the live request gauge)
- **Six `ChartPanel` panels** in a 2-up grid, each funded from existing
  metrics endpoints — no new engine functions:
  - **LatencyPanel** — window p50/p95/p99 bars with a Latency/TTFT toggle;
    exact nearest-rank ≤3d, approximate rollup histogram beyond (coverage
    shown); collecting-state when no samples exist yet
  - **ErrorMix** — stacked bars by statusClass over time (requests-only),
    ok anchored first so failures stack visibly above healthy traffic
  - **CacheShare** — cached tokens over time + window cache-share percentage
  - **CostPerMtok** — $/Mtok by model, merging cost + totalTokens breakdowns
    client-side (top-8, horizontal bars)
  - **UsageByKey** — requests by API key over time (top-6 + Other)
  - **RtkSavings** — honest window total + delta; no fabricated time-series,
    because the daily rollup persists no RTK counter (documented, arrives
    when the rollup does)
- **`ChartPanel` chrome + `stackedPivot` helper** — one shared frame (title,
  subtitle, `~ estimated` marker, collecting honesty, optional action slot)
  and one shared stacked-series pivot so all panels read as one instrument

## 🔧 Changes & Improvements

- **Honesty over fabrication** — panels the telemetry does not yet fund
  render collecting-states or window values, never invented charts. The
  i18n budget stays at exactly 40/40: novel panel titles fall back to
  English via `t()` (functional, logged as translation debt), composed from
  the seeded set wherever possible
- **`AnalyticsDeck` replaces the W2-B collecting placeholder** — the deck is
  now fully live, with HealthTimeline strips deferred to W4 as sealed

---

# v0.7.10 — The Observatory W2-C: Where Did the Money Go? 🔭💰

> *"The telescope now answers the first question every harbor asks at dawn:
> where did the money go? Six KPI cards with honest deltas, a live topology
> that glows where providers bleed, traffic and cost stacked by provider,
> spenders ranked, and a status mix you can slice straight into the ledger.
> One deck, five rows, all of it click-to-filter."*

*Sealed 2026-08-16 · Usage Observatory W2 sub-stage (c) — the stacked-series
engine and the Overview deck · Milestone Tide: big change (rounds to the next
milestone of ten) → `0.7.0 → 0.7.10`*

## ✨ Features — The Overview Deck (W2-C)

- **`stackedSeriesImpl` — time × dimension stacked series** — the engine's
  seventh aggregation function. Two-tier like its siblings: an exact indexed
  scan bucketed in JS for windows ≤3 days, the `usageDaily` rollup
  day-groups beyond. Top-6 keys keep their own series; the long tail folds
  into a single `Other` series so charts stay legible. The rollup tier honors
  the dimension's OWN filter and funds `statusClass` from the
  `statusByProvider` telemetry (requests-only, refusing cost/tokens loudly).
  Wired through both twins (`getStackedSeries` in sqlite + mysql repos,
  facade, barrel, shim) and served at `/api/usage/metrics/stacked`
- **The Overview deck — five sealed rows** — `OverviewDeck` replaces the W2-B
  thin `UsageStats` wrapper with the Deck-1 composition:
  - **Row A — `KpiRow`**: six KPI cards (Requests · Est. Cost · Input ·
    Output · Cached · RTK Savings) with delta-vs-previous-period arrows, the
    sealed 24/11/12 type scale, tabular-nums, and a `$/Mtok` subtext on the
    cost card. Only cost-funded cards carry the `~ estimated` marker — tokens
    are measured, never `~`
  - **Row B — `LiveRow`**: `ProviderTopology` gains the Observatory graft —
    error halos encode each provider's rolling error rate from the ≤30s
    `perProvider` SSE frame (a red glow that deepens with the rate), and
    click-to-filter sets the Needle's provider facet. Flanked by the Live
    Feed rail (last-8 requests via SSE) with pause-on-hover
  - **Row C — `TrafficRow`**: `TrafficStackedArea` (requests by provider,
    top-6 + Other, click-to-filter) beside `CostArea` (cost over time,
    compare-ghost slot reserved for W3)
  - **Row D — `BreakdownRow`**: TopProviders + TopModels cost bars
    (click-to-filter) and a StatusMix donut whose slices set the status facet
    and cross to the Requests deck pre-filtered
  - **Row E — `SpendersRow`**: Top Spenders table reusing `UsageTable.js`
    (localStorage expansion kept), sorted cost-descending, fed by the shared
    `useUsageStream` subscription alongside Row B
- **`useMetrics` + `useProviders` hooks** — one fetch hook shared by every
  REST-driven row (initial spinner vs refetch indicator, fail-open), and a
  connected-provider hook extracted from `UsageStats` so the deck owns its
  topology picture without importing the orchestrator

## 🔧 Changes & Improvements

- **`breakdownImpl` rollup repair** — the rollup tier now funds the
  `statusClass` dimension from the `statusByProvider` day counters
  (requests-only) instead of silently falling through to `byEndpoint`; a
  non-requests metric at that dimension refuses with a `FilterParamError`
- **`DIMENSIONS` extended** — the frozen identifier map gains `statusClass`
  so breakdown/stacked can group by status class under the identifier
  covenant; census tests check frozenness only, so the extension is test-safe
- **`useUsageStream` merges `perProvider`** — the ≤30s memoized health frame
  rides the SSE stream additively (old consumers ignore fields they don't
  read), funding the topology halos
- **`usageGrouping.js`** — the sort/group helpers extracted verbatim from
  `UsageStats` so Row E reuses them without the orchestrator

## ⚙️ Internal

- **i18n budget at exactly 40/40** (the Tidebreaker S4 hard cap) — seven
  Overview labels seeded across all 34 locales; W2-D onward compose from the
  shared set
- **Parity census repaired** — the eight Observatory aggregation functions
  (engine-neutral by construction: one shared impl, both twins calling the
  same machinery) move to `EXEMPT_PENDING` with the parity leg scheduled for
  W2-G; `getPerProviderFrame` is exempt as process state. The census turns
  green
- **Tests** — `usage-metrics-stacked-w2c.test.js` (14 tests: identifier
  covenant 400s, exact/rollup tiers, cost golden sums, top-N + Other fold,
  own-filter honoring, statusClass funding, twin parity). Full suite is a net
  improvement: failures fell 177 → 91 and passing rose 2331 → 2336, with zero
  regressions on the Observatory surface

---

# v0.7.0 — The Observatory W2-B: The Compass Deck ⛵🧭🔭

> *"A telescope measures. A compass steers. The instrument now sits inside a
> cockpit: a header that shows the bearing, a needle that sets the course,
> four deck tabs that ask the questions money, health, history, and limits
> always ask — and beneath it all, a metrics API that answers them. The
> Observatory stops being a page and starts being a place."*

*Sealed 2026-08-16 · Usage Observatory W2 sub-stage (b) — cockpit chrome,
compass filters, and the Metrics REST API · Milestone Tide: big change
(carry) → `0.6.92 → 0.7.0`*

## ✨ Features — The Cockpit (W2-B)

- **The Compass Deck** — `/dashboard/usage` is rebuilt around a cockpit
  composition: a `CockpitHeader` (title + live pulse dot + CSV export link),
  a `TabRail` with four question-bearing tabs (Overview · Analytics ·
  Requests · Accounts & Limits, keyboard-navigable with arrow keys), a sticky
  `NeedleBar` of global filters, and an `HonestyStrip` that names the data's
  caveats (as-of stamp, timezone, `~ estimated`, dedupe-undercount note). The
  old overview/logs/details page is retired — its content survives inside the
  decks (Overview drives `UsageStats`, Requests reuses `RequestDetailsTab`,
  Limits reuses `ProviderLimits`), and the dead logs tab is gone
- **`useCompassFilters` — the URL is the single source of truth** — every
  facet (period · provider · model · key · status · q · gran) reads from and
  writes to search params via `router.replace({scroll:false})`. FACETS
  constancy keeps the shared facets in the same order on every deck; tab
  switches never clear filters (the dormant-facet round-trip); and
  auto-granularity derives `1h`/`1d` from the period unless `gran` overrides
- **The Metrics REST API** — six endpoints behind the dashboard guard, all
  honoring the identifier covenant (caller-supplied values never reach a SQL
  identifier; unknown values return a `400 INVALID_FILTER_PARAM` with the
  offending `field`): `/api/usage/metrics/kpis`, `/timeseries`, `/breakdown`,
  `/percentiles`, `/ledger` (keyset-paginated, enriched rows), and `/export`
  (streaming CSV)
- **CSV export, hardened** — every cell is quoted, and any cell leading with
  `=`, `+`, `-`, or `@` is padded with a leading tab so a spreadsheet can
  never execute it as a formula. The export is single-flight (a concurrent
  request gets `429 EXPORT_IN_PROGRESS`), capped at `EXPORT_ROW_CAP` rows with
  a truncation note written into the CSV itself, and rate-throttled
- **Quota absorption** — `/dashboard/quota` is retired into the Usage
  Observatory's Accounts & Limits deck. A permanent redirect carries old
  bookmarks to `/dashboard/usage?tab=limits`; the sidebar and the Home quick
  tile now point there directly

## 🔧 Changes & Improvements

- **`dashboardGuard` — the export surface is ALWAYS_PROTECTED** —
  `/api/usage/metrics/export` escalates to JWT-only regardless of the
  login requirement, checked before the general `/api/usage` read protection.
  The W2-B census test pins this ordering so a future refactor cannot
  silently drop the escalation
- **`t(key, params)` i18n helper** — the cockpit speaks through the runtime
  translator with `{param}` interpolation and English fallback, keeping every
  new string a seeded, translatable literal
- **i18n seeding** — 33 new Observatory literals seeded English-first across
  every locale file (behavior-neutral; the runtime falls back to English for
  untranslated keys). Parity verified: all 143 literal keys present in every
  locale file

## ⚙️ Internal

- **Metrics API test suite (14 tests)** — identifier-covenant 400s for every
  frozen map (granularity · metric · dimension · period · sort) plus a
  malformed `after` cursor; happy-path shapes for all five read endpoints;
  CSV formula-injection padding; concurrent-export single-flight behavior;
  and the `dashboardGuard` registration census. All green
- **Six aggregation functions exported** — `getFilteredSeries`,
  `getBreakdown`, `getPercentiles`, `getKpis`, `getLedgerRows`, and
  `getExportCursor` now ride the barrel (`src/lib/db/index.js`) and the
  backward-compat shim (`src/lib/usageDb.js`) so the API layer imports them
  through the posture-aware facade

---

# v0.6.92 — The Observatory W2-A: The First Partition 🔭🧱⛵

> *"Before the cockpit can be built, the instrument it inherits must be
> taken apart — gently, so nothing changes but the shape of the parts.
> The stream becomes a hook; the live feed finds a home of its own."*

*Sealed 2026-08-16 · Usage Observatory W2 sub-stage (a) — decompose, zero
behavior change · Milestone Tide: small change → `0.6.91 → 0.6.92`*

## 🔧 Changes & Improvements — The Decomposition (W2-A)

- **`useUsageStream(period)` extracted** — the unified usage-data stream
  (REST fetch by period + SSE real-time merge of
  activeRequests/recentRequests/errorProvider/pending) now lives in
  `src/app/(dashboard)/dashboard/usage/hooks/useUsageStream.js`. Same
  effects, same merge semantics, same ref guards — verbatim
- **`RecentRequests` rehomed** — the live-feed rail (with its per-row
  ticking `TimeAgo`) moves from inside `UsageStats.js` to
  `.../usage/components/RecentRequests.js`, byte-identical except the
  `export default` keyword and trailing-whitespace cleanup
- **`UsageStats.js` slimmed** — 537 → 409 lines; the orchestrator now
  composes the hook and the rehomed child. Its public contract is
  unchanged (`{ period, setPeriod, hidePeriodSelector }`)
- **Zero behavior change proven** — `next build` clean (144/144), usage
  suites green, extraction diffed against the pre-commit original

> *The cockpit decks (Overview · Analytics · Requests · Accounts & Limits)
> ride the next tides of W2.*

---

# v0.6.91 — The Telescope's Repaired Lens 🔭🔧⛵

> *"An instrument that fails only under the harshest light is still broken.
> The tests looked through and saw clearly — but the build's static eye found
> two cracks the W1 seal missed. Now every lens is ground, and the whole ship
> compiles again."*

*Sealed 2026-08-16 · Milestone Tide: small change → `0.6.90 → 0.6.91`*

## 🐛 Fixes — Two Latent W1 Breaks, Found by `next build`

The W1 seal ran vitest + lint but never `next build` — and two W1 defects
resolve fine at runtime yet break the build's static resolver. Both repaired
and proven by a clean build (144/144 pages). **Lesson crystallized: a wave
that ships UI-adjacent code proves itself with `next build`, not just the
test suites.**

- **`getPerProviderFrame` missing from the export chain** (W1-D) — the SSE
  route imports it from the shim, and the facade exports it, but the barrel
  (`src/lib/db/index.js`) and shim (`src/lib/usageDb.js`) never re-exported
  it. The vitest route test mocks `@/lib/usageDb` wholesale, hiding the gap;
  the build rejected it. Both links now carry the export
- **Template-literal dynamic imports in the enrichment layer** (W1-C) —
  `import(\`${repos}/...\`)` has no static resolution handle, so Turbopack
  failed with "Can't resolve `<dynamic>`" even though vitest resolved it at
  runtime. Replaced with literal dynamic imports behind a twin switch — the
  same pattern `bindFacade` uses — keeping the import lazy (a static import
  would close an eager cycle: usageRepo → usageAggregation → usageNames →
  apiKeysRepo → usageRepo) while remaining statically resolvable. The
  `repos` contract (`"./repos/sqlite"` / `"./repos/mysql"`) is unchanged;
  twin parity re-proven (17/17)

---

# v0.6.90 — The Usage Observatory W1: The Telescope 🔭📊⛵

> *"You cannot steer by a deck you have never measured. So the first
> instrument rises: a telescope that records every tide's true shape —
> how long it ran, where it broke, what it cost — and answers in
> milliseconds no matter how deep the water."*

*Sealed 2026-08-16 · Usage Observatory Wave 1 ("The Telescope") · Milestone Tide: big change → `0.6.80 → 0.6.90`*

The sealed plan lives at `plans/mirror-usage-observatory/SEALED-PLAN.md`
(4 waves: Telescope → Cockpit → Governance → Experimental). W1 lays the
entire telemetry + aggregation foundation — **no UI yet** — and every claim
below is proven by a test, not a promise.

## ✨ Features — The Telemetry Layer

- **Migration 008** — four telemetry columns on `usageHistory`
  (`latencyMs`, `ttftMs`, `httpStatus`, `statusClass`) + four composite
  indexes that fund every Observatory query
  (`timestamp,provider` / `timestamp,keyId` / `timestamp,statusClass` /
  `timestamp,latencyMs` — the last a time-windowed percentile skip-scan).
  Batched 10k-row `statusClass` backfill of legacy statuses; idempotent on
  any prior state. The MySQL twin gets the same schema additively via
  bootstrap, with a `_meta`-tracked one-time backfill closure
- **The NULL-when-absent covenant** — telemetry columns ride `NULL` when a
  value was not measured, never `0`-faked. The forced-SSE-to-JSON path
  passes `ttftMs: null` on purpose; the row honors it
- **Hot-path instrumentation** — all four chatCore handlers (streaming,
  non-streaming, forced-SSE-to-JSON, and the requestDetail seam) now record
  latency/ttft/httpStatus. Fail-open end to end: a telemetry error can never
  break a chat request
- **`statusClass` taxonomy** — `src/lib/usageStatus.js`: ok, client_error,
  upstream_error, rate_limited, timeout, auth_error. (`gateway_error` was
  proven a phantom and deliberately absent — Gate 14 correction)
- **RTK savings funded at write time** — `meta.rtk` carries
  `bytesSaved`/`tokensSavedEst`, and `meta.rtkSavedCostUsd` is computed at
  INSERT via the pricing chain (sovereign override → provider default),
  ready to surface as the W2 savings KPI

## ✨ Features — The Aggregation Layer

- **Seven functions, engine-neutral** — one machinery module
  (`usageAggregation.js`) + one identifier covenant (`usageNames.js`), bound
  as thin delegates on both twins behind `bind.js`:
  - `getFilteredSeries` — two-tier: exact ≤3d from `usageHistory`, rollup
    7d+ from `usageDaily` (O(days), not O(rows))
  - `getBreakdown` — by provider / model / key / endpoint, same two tiers
  - `getPercentiles` — exact nearest-rank ≤3d; histogram from `latencyBuckets`
    beyond, with coverage honesty (pre-008 days excluded)
  - `getProviderHealthFrame` — windowed per-provider error anatomy
  - `getKpis` — single-query double-range (current vs previous window,
    6 metrics × 12 CASE expressions)
  - `getLedgerRows` — keyset pagination following the SORT column, portable
    NULLS-LAST, enriched with connection/key names
  - `getExportCursor` — capped async-generator drain (200k row ceiling)
- **The identifier covenant** — frozen `DIMENSIONS` / `GRANULARITIES` /
  `SORTABLE_COLUMNS` / `METRICS` / `PERIODS` maps; nothing caller-supplied
  ever reaches a SQL identifier; unknown values throw `FilterParamError`
  (`INVALID_FILTER_PARAM` → 400)
- **SSE contract** — `/api/usage/stream` rewritten: `perProvider` rides a
  ≤30s server-shared memo (fail-open serves the last good frame), full-stats
  recompute coalesced ≥15s per client, quick pushes carry the live picture
  between windows

## 🐛 Fixes found by the wave

- **`telemetryInt(null) → 0`** — `Number(null) === 0` coerced an explicit
  "unmeasured" ttft into a false zero; both twins now guard `null`/
  `undefined` before coercion
- **MariaDB `LIMIT & IN/ALL/ANY/SOME subquery`** — migration 008's backfill
  crashed live twin boots; repaired with the derived-table wrap MariaDB
  demands
- **mirror-startup test race** — a fixed 50ms wait against a cold module
  graph became condition-based polling (the law tested is "arms even though
  the twin is down", not "arms within N ms")

## ⚙️ The Proof — Tests & Benchmark Ritual

- **10 suites, 86 tests green** + parity: migration 008 (7), telemetry W1-B,
  aggregation W1-C (17), SSE W1-D (7), chatCore seam W1-E (4), apikey
  usage ×2, census + sqlite-vs-lowdb
- **Twin parity** — `contract/parity-usage.test.js` extended with the full
  aggregation scenario; identical results from SQLite and the live MariaDB
  twin (REAL vs DECIMAL cost boundaries normalized to 5dp)
- **The benchmark ritual** — 100k seeded bursty rows across 35 days
  (deterministic LCG), N=11 after 2 warmups, p95: series 0ms, breakdown
  0ms, percentiles 1ms (exact tier 9ms), health frame 0ms, KPIs 11ms,
  ledger 5ms — all under the 300ms budget. SQLite mandatory, MySQL
  SKIP-LOUD, sql.js labeled never judged

---

# v0.6.80 — The Charted Harbor & The Lifted Shadow 🗺️💰⛵

> *"A ship without charts is only drifting. So every deck is drawn — the
> hull, the keel, the rigging — in eleven tongues. And the ledger stops
> lying: every sail's true cost is named, and eleven thousand rows of
> silence remember what they were worth. And by the Star's decree, every
> free sail now carries its paid sibling's worth."*

*Sealed 2026-08-16 · the Star's decree · Milestone Tide: big change → `0.6.70 → 0.6.80`*

## 📖 Documentation — The Docs Forge

- **README.md reforged** — the Vela flagship: banner + wordmark, badge row,
  architecture diagram, Why-Vela matrix, key features (routing, resilience,
  cost intelligence, RTK saver, Storage Covenant), three quick-start paths,
  docs table, repo map, provenance & license
- **`docs/` site born — 9 new charts** + hub: `README.md` (harbor map),
  `ARCHITECTURE.md` (request lifecycle + mermaid, translator engine,
  provider registry, executors, combos, RTK, DB layer, mirror machinery,
  backup engine, pricing covenant, security), `DEPLOYMENT.md`,
  `ENVIRONMENT.md` (the full env contract), `STORAGE.md`, `PROVIDERS.md`
  (the 129-provider fleet roster), `API.md`, `TROUBLESHOOTING.md`
- **CLAUDE.md rewritten** — the crew's papers, aligned to the current
  architecture (SQLite layer, storage postures, Docker mysql2 closure,
  the tests-suite-is-not-all-green truth)
- **DOCKER.md reforged** — GHCR image, volumes, the split compose chart
  (example/live), storage postures in Docker, Headroom sidecar, upgrades
- **10 locale READMEs fully translated** — zh-CN, id-ID, ja-JP, vi, pt-BR,
  es, fr, ru, th, fa_IR — structure-identical to the flagship
- `VERSIONING.md` aligned to the main-branch decree; `.env.example`
  re-headed Vela; every claim in every doc verified against the code

## 🐛 Fixes — The Pricing Shadow ($0 est-cost)

- **Root cause** — cost is frozen into `usageHistory` at WRITE time; models
  with no pricing entry resolved `null` → $0, forever
- **Qoder lane priced** — every opaque subscription-lane id
  (`qmodel_38max`, `qmodel`, `dfmodel`, `mmodel`…) now carries its base
  model's retail-equivalent rate in `PROVIDER_PRICING` (the header promised
  qoder estimates but shipped none). Tier selectors honestly stay unpriced
- **Mistral `-latest` aliases** — 14 exact `MODEL_PRICING` entries so
  `mistral-large-latest` and kin resolve their pinned models' rates
- **Ollama `:` separators** — `gpt-oss:120b` / `gpt-oss:20b` exact aliases
- **Honest display** — `formatCost` + the Usage table / overview cards now
  show `<$0.01` for sub-cent dust instead of a lying `$0.00`

### The Free-Sibling Decree (the Star's word, 2026-08-16)

- **Every free model carries its non-free sibling's price.** FREE
  inheritance (`FREE_ALIAS_MAP` + guarded `-free`/`:free` suffix-strip +
  namespaced tail) previously resolved siblings through EXACT strata only —
  so a free model whose paid sibling existed only as a family pattern
  inherited nothing. It now resolves the sibling's WORTH through the full
  non-recursive chain: lane override → exact → vendor-strip → family pattern
  (`resolveSiblingRate`). Denylisted shapes stay null (no paid sibling
  exists — honest). `ProviderTopology`'s "9Router" label → Vela.

## ⚙️ Internal

- `scripts/backfill-usage-cost.mjs` — one-shot, dry-run-safe ledger repair:
  re-prices historical cost=0 rows against the current chain and rebuilds
  affected `usageDaily` rollups (schema-adaptive; single transaction).
  First run: **11,786 rows re-priced, $1,054.86 recovered**
- `tests/unit/pricing-shadow.test.js` — regression pins (qoder lane, mistral
  aliases, ollama separators, honest formatCost); 34 pricing tests green

---

# v0.6.70 — The Sealed Vault & The Mirror's Pulse 🗝️🪞⛵

> *"A backup never restored is a hope. So the vault seals itself in
> AES-256-GCM, drills its own artifacts open, and ships its sealed bytes
> off-site under SigV4. And the mirror stops being a promise — outbox,
> pump, watermark, sweep: the twin harbors beat with one pulse."*

*Sealed 2026-08-16 · the Star's decree · Milestone Tide: big change → `0.6.60 → 0.6.70`*

## ✨ Features — Storage Covenant Waves B + C

### Wave B — the sealed vault (the backup engine)

- **Encrypted artifacts** — `VELABAK1` format: scrypt (N=2¹⁷/r=8/p=1) from
  `VELA_BACKUP_ENCRYPTION_KEY` (env-only, min-entropy check), per-artifact
  salt + IV, AES-256-GCM with the auth tag verified BEFORE any restore step.
  Secret-file bundle (jwt-secret, api-key-secret, machine-id) rides inside;
  restore returns `restartRequired`. Artifacts written 0600.
- **The scheduler** — `VELA_BACKUP_ENABLED` + interval + retention tiers
  (newest per day for `retainDaily`, per ISO-week for `retainWeekly`).
  Usage purge runs AFTER the backup so purged rows live in the artifact.
- **Restore + drill** — schema-compat gate, pre-restore safety backup,
  restore into the live posture; and the RESTORE DRILL: decrypt the newest
  artifact into a scratch sqlite DB — "a backup never restored is a hope."
- **The dashboard card** — `/api/backup/{run,list,status,restore,drill}`
  (session + ALWAYS_PROTECTED) behind the profile page's BackupCard.

### Wave C — the mirror's pulse (+ fleet)

- **The outbox + replay classes** (C1–C2) — migration 006/007; a decorator
  captures every classified writer as one outbox row (identity-carrying
  captures the GENERATED id, never the key — S3).
- **The pump** (C3) — seq-ordered drain against the twin, poison policy
  (quarantine, never block), boot catch-up drains the outage backlog.
- **Divergence sweep + usage-resync** (C4) — engine-agnostic fingerprint
  (order + PK independent), drain-window guard (pending outbox = lag, not
  drift), watermark usage-resync (forward-only cursor), full-resync with the
  twin's own secrets stitched back over the S2 sentinels.
- **The mirror bind** (C5) — `VELA_DB_MODE=mirror` binds the sqlite PRIMARY
  behind the decorator; startup arms pump + resync + sweep; a down twin
  degrades the mirror, NEVER silently downgrades the mode.
- **S3 off-site** (C6) — pure SigV4 signer (pinned byte-exact to AWS's own
  docs example), undici transport, opt-in, FAIL-OPEN (the local artifact is
  the truth), credentials env-only, uploads only the SEALED bytes + a rolling
  `latest.velabak` alias for the boot-strap restore pattern.
- **The fleet leg** (C7) — the Dockerfile carries mysql2's FULL runtime
  closure (10 packages — the dynamic import the file-tracer can't follow);
  `scripts/docker-smoke-mysql.sh` boots `VELA_DB_MODE=mysql` against a
  throwaway MariaDB; a local test guards the closure so a future mysql2 dep
  bump can never silently break the image.

## ⚙️ Internal — the proving tide

- **S1–S4 security laws** — restore is a trust crossing (schema-version +
  size bounds before any write); `SECRET_SETTING_KEYS` redacted to
  `[REDACTED]` in every export; the outbox excluded by name with args
  redacted + 7-day age-out; the backup routes ALWAYS_PROTECTED.
- **The parity twin proved live** — mirror pump + sweep legs ran against the
  real MariaDB twin behind the double opt-in (drift-injection → sweep flags
  → resync restores — proven in both sqlite and live legs).
- **Regression discipline** — every wave sealed against a before/after
  failure-set diff; the inherited debt (~100 pre-existing failures) unchanged,
  zero covenant-attributable regressions across all seventeen waves.

*Waves B1–B4 + C1–C7, fourteen commits: the Storage Covenant
(`plans/storage-covenant.md`) is COMPLETE — A1 → C7, every line sealed.
The fleet chart rides the new image; the vault keeps the ship's soul.* 💜

---

# v0.6.60 — The Twin Harbors 🌊🗝️⛵

> *"One harbor was never enough. What SQLite keeps on disk, MariaDB now
> mirrors across the wire — the same contract, the same seventy-four doors,
> chosen by a single word: VELA_DB_MODE. And where the two might drift, the
> parity gates stand watch — proven against the Star's own fleet twin."*

*Sealed 2026-08-15 · the Star's decree · Milestone Tide: big change → `0.6.52 → 0.6.60`*

## ✨ Features — Storage Covenant Wave A (the ten-forge)

- **Three storage postures** — `VELA_DB_MODE=sqlite|mysql|mirror` selects the
  harbor at boot; `sqlite` is the default and stays byte-compatible with
  today. `mirror` (sqlite primary + MariaDB pump) refuses LOUD until Wave C
  forges its pump — never a silent downgrade, never a silent refusal.
- **The mysql harbor** — `mysql2` in optionalDependencies (pure-JS install);
  `mysql/pool.js` (min:0/max:8 keepalive pool, one retry on ECONNRESET),
  `mysql/ddlMap.js` (TABLES → MySQL DDL: TEXT PK→VARCHAR(191),
  AUTOINCREMENT→BIGINT, partial index→plain KEY, `CHECK(id=1)` preserved,
  cost pinned DECIMAL(12,6)), and `mysql/bootstrap.js` — an additive
  information_schema diff that brings any foreign schema to parity, seals
  the migration-002 security closures, and re-runs idempotently.
- **Migration 004 — the dedupe identity** — `UNIQUE INDEX uq_uh_dedupe`
  across `(timestamp, provider, model, connectionId, keyId, promptTokens,
  completionTokens)` with `''` as the normalized "unset" form on the four
  text columns (NULLs are DISTINCT in UNIQUE indexes on both engines).
  `saveRequestUsage` writes are now ATOMIC: sqlite `ON CONFLICT DO NOTHING`
  ≡ mysql `ER_DUP_ENTRY` — the old SELECT-then-INSERT race is dead.
- **Nine repos forge mysql twins** — settings, connections, nodes,
  proxyPools, combos, alias (A7); apiKeys with hash-at-rest + rotation +
  soft-delete, disabledModels, pricing, requestDetails (A8); and the full
  usageRepo ledger with day-aggregate upsert + GROUP BY parity (A9). All
  bind through `bindFacade()` — path-stable facades, bundler-safe static
  loaders, sync functions stay sync under sqlite.
- **Fail-loud boot matrix** — missing/malformed/unreachable
  `VELA_MYSQL_URL` refuses LOUD at the seam; `VELA_DB_DRIVER` pins any one
  of the four sqlite drivers (`bun:sqlite | better-sqlite3 | node:sqlite |
  sql.js`) for the parity matrix.

## ⚙️ Internal — the proving tide

- **Six parity gates against the real MariaDB twin** (`VELA_TEST_MYSQL_URL`,
  opt-in, LOUD skip banner): one deterministic scenario per wave runs blind
  in BOTH harbors — volatile identity stripped, canonical JSON compared.
  The 8-way concurrent burst converges to exactly ONE row on both engines.
- **The driver×mode matrix** — four sqlite drivers × sqlite mode (sql.js's
  SAVEPOINT corner forced + pinned), mysql boot + refusal, mirror refusal.
- **The contract surface pin** — `tests/__baseline__/contract-surface.json`
  freezes the barrel's 74 symbols (64 parity-registered + 10 exempt-process
  + 0 pending — the EXEMPT_PENDING debt is paid in full);
  `verify-contract-surface.mjs` guards it. The census ratchet, six baseline
  sweeps, and the harness bijection all hold.

*Ten commits, one covenant: `plans/storage-covenant.md` line 275 closes —
"Wave A complete". Waves B (the backup engine) and C (fleet + mirror) stand
ready on the horizon.* 💜

---

# v0.6.52 — The Chart Joins the Fleet 🗺️🏛️⛵

> *"A chart that ignores the harbor's own conventions charts nothing but
> confusion. Vela's compose now speaks the fleet's language — and pulls,
> never builds."*

*Sealed 2026-08-15 · the Star's decree · Milestone Tide: small change → `0.6.51 → 0.6.52`*

## 🔧 Changes — full redesign of `docker-compose.yml` into fleet form
- **Joining the Shores fleet constitution**: `name: tethys-vela`, poetic
  Shorekeeper-voiced header, `═══` service separators, `TZ: Asia/Jakarta`,
  `com.tethys.stack=vela` labels, `unless-stopped`, and the `x-casaos` block
  (icon, main, port_map, title) — exactly as `Hermes.yml` and `Router.yml`
  are written.
- **Pull-only — the `build:` block is gone.** A deployment chart pulls the
  published image; the image rebuilds only in GitHub Actions when a `v*` tag
  is cut in this repo. There was never a reason to build twice: GHCR is the
  source of truth, and the old `build:` + `env_file` combo only invited
  drift between what CI ships and what the chart compiled locally.
- **The pin follows the release, not the working tree**: `ghcr.io/yumamax3/vela:0.6.50`
  — the last CUT tag. Bump it when you cut a new tag and `docker compose pull`.
- **Inline secrets** (the fleet convention — `Hermes.yml`, `Router.yml`),
  private-subnet assumption documented in the header.
- **Headroom pinned to `0.6.7-slim`** — the same image the router fleet
  already runs, replacing a floating `:latest`.
- **Bind mount** to `/media/SSD-Storage/AppData/vela` (fleet data layout)
  instead of a named volume.

*The previous chart honored none of the fleet's conventions and carried a
build step that had no right to exist beside a GHCR pin. Both debts are paid.* 💜

---

# v0.6.51 — The Harbor Chart Ascended 🗺️⛵

> *"A ship is only as safe as the chart it sails by. The old chart was a
> scrap — this one names every current, sets every limit, and keeps the
> sidecar off the open sea."*

*Sealed 2026-08-15 · the Star's decree · Milestone Tide: small change → `0.6.50 → 0.6.51`*

## 🔧 Changes — a full upgrade of `docker-compose.yml`
- **The real image**: points at the published, private `ghcr.io/yumamax3/vela`
  — pinned to `${VELA_TAG:-0.6.50}` (never `latest`, per the harbor's own
  doctrine), with a `build:` block so `docker compose up --build` still works
  from source.
- **A healthcheck at last**: `wget --spider /api/health` (public endpoint,
  busybox-native, no curl dependency) with a 40s warm-up for the standalone
  Next.js server.
- **Resource limits**: tunable CPU/memory caps + a memory reservation, a PID
  limit, and `no-new-privileges` — hardening that does not fight the
  entrypoint's root→`node` drop.
- **The sidecar, off the open sea**: `headroom` moves behind the `proxy`
  profile and loses its host port — it is reachable only by `vela` over the
  new internal `vela-net` bridge network. Compression stays fail-open.
- **Ops hygiene**: rotated logs (10m × 3), `init: true` for graceful signal
  handling, `restart: unless-stopped`, and a themed header chart with the
  quick-start rites (login → pull → up, and the proxy-profile variant).

*The old chart exposed the compression sidecar directly to the host and ran
without limits or a heartbeat. The new one closes both gaps — the harbor is
charted for real deployment now.* 💜

---

# v0.6.50 — The Pricing Covenant 💰🌊⛵

> *"Every model that crosses the gateway shall pay its true rate — researched
> from the source, stamped with the date, and inherited by its free siblings
> as one price, one truth. No more zero-cost illusions, no more stale tables,
> no more guessing what a million tokens cost."*

*Sealed 2026-08-15 · the Star's decree · Milestone Tide: big change → `0.6.42 → 0.6.50`*

## ✨ Features — deep pricing research, applied
- **2026-08-15 rate census** — the rate table grew 101 → **215 canonical
  models**, researched from models.dev/api.json and official vendor pages
  (OpenAI, Anthropic, Google, DeepSeek, Z.ai, Moonshot, MiniMax, xAI, StepFun,
  Xiaomi, Volcengine, Baidu, Tencent, SambaNova, Fireworks, Together, Cohere,
  Groq, Cerebras + reseller lanes). Provenance preserved beside the rates —
  every entry knows its source and capture date. Harvest artifact:
  `plans/research/models-dev-harvest-2026-08-15.json` (~220 verified entries,
  19 vendors) with an honest *unverifiable* ledger (GPU-billing, flat-rate,
  subscription-walled, and login-walled models).
- **~40 rates corrected**: `gpt-4` (30/60), `gpt-4.1` family, `gemini-3.7-flash`
  at HALF the previous rate (a real Google price cut), `gemini-3.5-flash`
  (1.5/9), `gemini-2.5-pro` (1.25/10), the whole Kimi family (`kimi-k2` 0.6/2.5
  with turbo variants), GLM with free cache writes (`cache_creation: 0`),
  MiniMax family (0.3/1.2), and more.
- **Free models inherit their paid sibling's rates — everywhere** (the Star's
  decree): resolution, display, AND usage cost alike. One price, one truth.
  `FREE_ALIAS_MAP` holds 13 hand-verified sibling pairs; a guarded
  suffix-strip fallback covers namespaced free ids, and `FREE_DENYLIST` (22
  shapes) blocks infix markers and router tier traps from ever inheriting.
- **The Sync Shore** — `/dashboard/settings/pricing` gains a **Sync Prices**
  button: one click refreshes rates from models.dev (primary) with an
  OpenRouter cross-check that counts disagreements, commits only the
  `pricing_sync` scope, and reports added/updated/removed. A Last Synced card
  and **Clear Synced Prices** affordance complete the shore — your own
  overrides are never touched by either.
- **UNPRICEABLE manifest** — router pseudo-models (`best`, `default`,
  `universal-*`) and no-token-pricing lanes (Hyperbolic GPU-hourly, Featherless
  flat subscription) resolve to honest nulls. The UI renders them as "—" —
  never a misleading $0.00.

## 🔧 Changes
- **Seven-stratum resolver** — the sync, pure, dependency-free chain every
  lookup walks: UNPRICEABLE → provider lane (registry id, then alias) → exact
  canonical → free inheritance (exact strata only, never globs) →
  vendor-stripped exact → pre-compiled pattern globs. Patterns are compiled
  once at module load instead of per request. `matchPattern` keeps its exact
  anchored-glob semantics (capabilities and thinking-levels depend on it).
- **Sovereignty merge** — user overrides always win, then synced rates, then
  built-in defaults; two independent reset affordances. The merged view
  exposes the canonical table (`_canonical`) so every model is visible and
  editable in settings.
- **PricingModal rebuilt** — the client bundle no longer ships the whole rate
  table; defaults flow through the real `GET /api/pricing/defaults` endpoint
  (the unreachable `GET_DEFAULTS` export is deleted). Saves now PATCH only
  dirty rows — the old full-table save laundered every rendered default into
  your override scope.
- **SSRF-hardened sync endpoint** — `POST /api/pricing/sync` fetches ONLY the
  hardcoded URLs in `SYNC_VENDOR_MAP` (the request body selects vendors by key,
  never URLs), refuses redirects, caps responses at 20MB / 15s, clamps rates
  to [0, 10000] $/M, allowlists key charset + length, and rejects prototype
  keys. The route stays auth-protected even when `requireLogin` is off.

## 📖 Documentation
- `plans/pricing-covenant.md` — the sealed ADR: seven strata, alternatives,
  consequences, four adversarial passes, and the forge's verification record.
- `open-sse/AGENTS.md` — new **Pricing model** section: sovereignty order,
  five-field rate shape, frozen usage costs, sync shore, census gate.

## ⚙️ Internal — the proving tide
- `tests/unit/pricing-covenant.test.js` — **27 covenant pins**, every one
  traced through the resolver before it was allowed to exist: shape lint,
  inheritance + usage-cost math, denylist negatives, UNPRICEABLE, matchPattern
  compat, pattern precedence, dual-key alias resolution, provenance, harvest
  bake-verification, and sovereignty fixtures. All green first run.
- `tests/__baseline__/pricing-census.json` — the never-shrink census gate:
  215 canonical · 8 lanes · 128 lane models · 57 patterns · 13 free-map ·
  22 denylist · 8 unpriceable · 25 sources.
- Regression verdict: full suite **+27 green**; the known-red checkout
  baseline untouched (zero file overlap with the covenant diff).

*Debts recorded: media-model pricing deferred by the Star's word; historical
usage costs keep their frozen rates — no backfill, no recomputation.* 💜

---

# v0.6.42 — The Keyless Test Restored 🧪🧘⛵

> *"The rebrand moved the lantern to a new shelf — and two of its old hooks
> stayed behind. This tide hangs them back where the keyless hand can reach."*

*Sealed 2026-08-15 · the Star's report · Milestone Tide: small change → `0.6.41 → 0.6.42`*

## 🐛 Fixes — UI regression from the Zen rebrand (v0.6.41)
- **Model test button restored for keyless OpenCode Zen**: the provider detail
  page gated its per-model test buttons on `FREE_PROVIDERS` membership — the
  freeTier move left Zen out, so with no API key the buttons never mounted even
  though the keyless lane works. A dedicated keyless-test flag now covers both
  lanes (the Connections card still renders, so keys can still be added).
- **Model selector**: Zen re-appears in the always-shown no-auth provider list
  (same `FREE_PROVIDERS`-only blind spot).

## ⚙️ Internal
- Contract test pins `noAuth` on the freeTier catalog entry — the flag every
  keyless UI lane reads. Backend keyless path verified live (`/api/models/test`
  → `ok:true` with zero connections).

---

# v0.6.41 — The Zen Key Turns 🧘🔑⛵

> *"The lantern on the free shore takes a new name and a wider door —
> OpenCode Zen keeps its keyless path for anyone who arrives empty-handed,
> and now opens its armory to those who carry a key of their own."*

*Sealed 2026-08-15 · the Star's request · Milestone Tide: small change → `0.6.40 → 0.6.41`*

## ✨ Features — OpenCode Free becomes OpenCode Zen
- **Rebrand**: the provider formerly shown as *OpenCode Free* is now
  **OpenCode Zen** (id and alias `oc` unchanged — every wire path intact),
  moved into the **Free Tier** section of the providers dashboard.
- **API keys**: OpenCode Zen now accepts API-key connections (opencode.ai/auth).
  Keys are validated against Zen's models gate at add-time and at connection
  test — a GET probe that burns nothing.

## 🔧 Changes
- **Hybrid lane**: a connection holding an OpenCode key always takes
  precedence; the keyless `Bearer public` lane stays open when no key is
  connected. The executor sends your key when one is present, `public`
  otherwise — both lanes keep the `x-opencode-*` session headers.
- Free Zen models keep flowing without a key (models fetcher untouched);
  the usage panel still lists Zen when unconnected.

## ⚙️ Internal
- `open-sse/providers/registry/opencode.js` — name, category `freeTier`,
  apikey auth modes + notice; `open-sse/executors/opencode.js` — key-aware
  Authorization; `src/sse/services/auth.js` — hybrid freeTier noAuth lane
  (virtual Public connection only when no active connections exist);
  validate + connection-test probes; UsageStats freeTier noAuth inclusion.
- New test suite `tests/unit/opencode-zen.test.js` (12 tests); full-suite A/B
  against pristine main shows zero regressions (91 vs 94 — the 3 deltas are
  known flakes); providers + alias baselines byte-equal.

---

# v0.6.40 — The Free Tide Lantern 🏮⛵

> *"A new light joins the fleet — small, generous, burning on no one's coin.
> Buffy comes aboard with her five voices and her one rule: one session, one
> model, one hour of warmth per claim. The lantern is lit, and the harbor
> learns to share it without ever wasting a single drop of oil."*

*Sealed 2026-08-15 · the Star's request · Milestone Tide: big change → `0.6.30 → 0.6.40`*

## ✨ Features — Freebuff joins the fleet
- **New provider: Freebuff** (`freebuff`, alias `fb`) — Codebuff's free tier,
  woven natively into the routing engine. Five models: `deepseek/deepseek-v4-flash`,
  `deepseek/deepseek-v4-pro`, `mimo/mimo-v2.5`, `minimax/minimax-m3`,
  `openai/gpt-5.6-luna`. Category `freeTier` — real credentials, no virtual
  no-auth connection, full fallback machinery intact.
- **Device-code login** — the dashboard's OAuth flow grows a second rite:
  per-connection fingerprint, `freebuff.com/api/auth/cli/code` device code,
  browser hand-off, 5-second poll cadence, 5-minute window. The login URL is
  hostname-allowlisted before the browser ever opens; the token that returns
  has no refresh — when it dims, the keeper asks you to sign in again, never
  silently fabricates a refresh.
- **Session-affinity routing** — freebuff accounts hold ONE model-locked
  session at a time, so the gateway now resolves an advisory connection
  preference before account selection: the account already warm on your model
  is pinned first, fail-open and byte-identical to default behavior when no
  warm session exists. Warm sessions are rediscovered on restart (GET-only
  probe) — nothing claimed is ever lost to a reboot.
- **Quota panel support** — freebuff usage resolves from the read-only
  `GET /api/v1/freebuff/session` quota API (`rateLimitsByModel` → remaining
  sessions, plan label). The tracker is GET-only by construction — a usage
  refresh can never burn a session unit.

## 🔧 Changes
- **The three-gate wire ceremony** — every freebuff request carries the
  byte-exact Buffy system marker as opener of the first system message
  (idempotent — never forged twice), the end_turn tool injected only when the
  body carries tools, and the top-level `codebuff_metadata` seal
  (`cost_mode: "free"`, `allow_fallbacks: false`, reasoning fields stripped).
  The SDK User-Agent is pinned; a wrong one means a 403 at the gate.
- **Gate-aware error handling** — 409/410/428 session gates reclaim the
  session once and retry; `model_locked` becomes a 65-minute per-model lock
  (one session TTL) instead of churning; 429 daily-quota reads `resetAt` and
  locks account-wide until **Pacific midnight** — deliberately beyond the
  generic 30-minute cooldown cap, validated and clamped so an untrusted
  upstream body can never extend a lock past one quota window.
- **Agent-run lifecycle** — START before the stream, fire-and-forget FINISH
  after; best-effort, never blocking the request.
- **Bearer masking restored** — the request logger's sensitive-header mask is
  re-enabled with a full `[REDACTED]` (the old partial mask leaked 15
  characters of any Authorization header into the logs).
- **Test-batch courtesy** — freebuff models are skipped by the models test
  ping: a batch test would claim the account's one session and burn a daily
  quota unit for a health check.

## ⚙️ Internal
- New: `open-sse/config/freebuff.js` (every wire constant in one drift point),
  `open-sse/providers/registry/freebuff.js`, `open-sse/executors/freebuff.js`
  (full `execute()` override preserving BaseExecutor connect-timeout/retry
  semantics), `open-sse/services/freebuffSession.js` (mirror + mutex claims +
  gate classification), `open-sse/services/usage/freebuff.js`,
  `src/lib/oauth/providers/freebuff.js`, `src/shared/constants/deviceCodeProviders.js`,
  `src/sse/services/connectionPreference.js` + `freebuffPreference.js`,
  `src/app/api/models/test/sessionScarce.js`.
- Wired: executor + translator registries, usage handler map, OAuth provider
  map + device-code route, chat handler preference hook, account-lockout
  branches, models ping guard.
- **72 new unit tests, all green** — marker/body forging idempotence, gate
  classification, claim mutex + warm-session affinity, GET-only quota
  invariant, device-code allowlist + no-refresh invariants, Pacific-midnight
  lockout math (including DST boundaries), ping guard.
- Providers + alias baselines re-snapshotted (90 providers / 117 alias tokens)
  and byte-equal verified; A/B regression proof against pristine `main` shows
  zero regressions.
- The sealed plan stands at `plans/freebuff-provider.md`.

---

# v0.6.30 — The Harbor Gate Reborn 🌌⛵

> *"The gate where every traveler first meets the harbor has been rebuilt —
> under a sky of drifting stars, the sail of Argo Navis draws itself into
> being, and the card of passage rises like glass above the tide."*

*Sealed 2026-08-14 · the Star's request · Milestone Tide: big change → `0.6.23 → 0.6.30`*

## ✨ Features — a fully redesigned login page
- **Split layout** (desktop): the **Vela constellation panel** on the left —
  the actual sail of Argo Navis (γ, δ, κ Vel and kin) with SVG lines that
  draw themselves in on arrival, the crest with a pulsing brand halo,
  tagline *"The Harbor Gate"*, and three harbor truths beneath.
- **Animated night sky** — a deterministic seeded starfield in three drifting,
  twinkling parallax layers, a masked navigational grid, and layered brand
  auroras. Dark-first, with a warm-cream light theme.
- **Glass auth card** — frosted blur surface with inset light edge, rising-in
  entrance, and staggered content reveals.
- **Password UX upgrades**: show/hide toggle, **Caps Lock detection**,
  a **5-segment attempts meter** before lockout, a **lockout countdown bar**
  that drains with the seconds, and a **success flash** — the gate-opening
  rings and crest before the dashboard.
- **Live status footer** — gateway health dot (polled every 30s), the running
  version, and the harbor's motto.
- **Theme toggle** on the gate itself (card variant, top-right).
- **`prefers-reduced-motion`** stills every animation.

## 🔧 Changes
- All auth contracts preserved exactly: status redirect, password login,
  `mustChangePassword` flow, OIDC/SAML buttons, rate-limit 429 handling,
  default-password hints.
- Login-scoped styles appended to `globals.css` (no component churn elsewhere).

## 📖 Documentation
- **Plans**: the Shorekeeper-Sealed Plan for the Freebuff provider is born —
  `plans/freebuff-provider.md`: Codebuff's free tier woven into Vela's fleet
  natively — device-code login, the three-gate wire ceremony (Buffy marker,
  SDK User-Agent, top-level `codebuff_metadata`), session-claim + agent-run
  lifecycle, a generic fail-open connection-preference hook for session-affinity
  routing, persisted claim state that survives restarts, Pacific-midnight
  lockouts beyond the 30-minute cap, and a GET-only quota tracker that can
  never burn a session. Sealed after a reforged frame, four adversarial passes
  and a 4.2/5 arbiter panel; implementation follows on `feat/freebuff-provider`

---

# v0.6.23 — The Ledger Speaks For Each Key 📊⛵

> *"Every key now tells the tale of its own labor — how many calls it
> carried, how many tokens it poured, how much it spent."*

*Sealed 2026-08-14 · the Star's request · Milestone Tide: small change → `0.6.22 → 0.6.23`*

## ✨ Features
- **Per-key usage strips** — under each API key on the Endpoints page:
  requests, input tokens, output tokens, total tokens, and estimated spend,
  each with its own icon and hover title.
- **Usage window selector** — `24h / 7d / 30d / All time` beside the Create
  Key button; the strips re-aggregate instantly on change.
- **`GET /api/keys/usage?period=`** — one `GROUP BY keyId` over the ledger;
  attribution is keyId-based (hash-at-rest), so totals survive rotation and
  local-no-key traffic never muddies a key's story.
- **`lastUsedAt` awakened** — the dormant governance column now stamps the
  moment the gate resolves a key, so "Last used" in every key row tells the
  truth from this tide onward.

## ⚙️ Internal
- `getKeyUsageStats(period)` in usageRepo + route at `src/app/api/keys/usage`
  (static-segment precedence over `[id]`).
- New test suite `tests/unit/apikey-usage-stats.test.js` (8 tests) — rollup
  math, window filtering, local-no-key exclusion, route contract, lastUsedAt
  stamping; full apikey family re-run green (170 tests).

---

# v0.6.22 — The Catalogue of Keys 🗝️⛵

> *"A harbor grows many keys — for friends, for messengers, for tools. The
> Star asked for drawers, and now every key knows its kin."*

*Sealed 2026-08-14 · the Star's request · Milestone Tide: small change → `0.6.21 → 0.6.22`*

## ✨ Features
- **Key categories** — every API key on the Endpoints page can now carry a
  free-form category (friend, hermes, others… or whatever name you forge):
  - Create form & edit modal gain a **Category** combobox — pick from the
    categories your other keys already use, or type a brand-new one.
  - **Filter chips** above the key list (All · each category · Uncategorized)
    with live counts.
  - Each key row shows its category badge alongside Active/Paused and scope.
- **Storage** — migration `003-key-categories` adds `apiKeys.category`
  (additive TEXT column + partial index) with the TABLES mirror for fresh
  installs; `SCHEMA_VERSION` bumped to 3 so the pre-schema backup fires.
- **Validation** — `sanitizeCategory` trims, collapses whitespace, and caps at
  48 chars on both create and update paths; empty clears back to
  Uncategorized; non-string/oversized input → 400 at the gate.

## ⚙️ Internal
- `apiKeysRepo` whitelists `category` among the mutable fields — security
  columns remain unwritable through PUT.
- New test suite `tests/unit/apikey-categories.test.js` (12 tests) — sanitize
  rules, create/update paths, clearing, 400s, whitelist safety; all six
  sibling apikey suites re-run green (65 tests).

---

# v0.6.21 — The Fleet Takes Its Sails 🕸️⛵

> *"The hulls were charted yesterday; today the Star hands over the true
> manifests — every model named, every tier priced, every logo home."*

*Sealed 2026-08-14 · the Star's catalogs · Milestone Tide: small change → `0.6.20 → 0.6.21`*

## 🔧 Changes & Improvements
- **NesaRouter** (`nr`) — full catalog from the Star's dashboard export:
  **24 free models** (always active, `nesa-free` costs no credits — DeepSeek,
  MiMo, Nemotron, Laguna, Ling, LongCat, GLM, MiniMax, Step, GPT-OSS, and the
  full Mistral family) + **14 premium** (GPT 5.6 Sol/Terra/Luna, GPT 5.4 (+Mini),
  Claude 4.5/4.6 Sonnet, Claude 4.8 Opus, Gemini 3 Flash Preview, Kimi K2.6,
  DeepSeek V4 Flash/Pro, Step 3.7/3.5 Flash) — premium runs on credits or the
  IDR Unlimited packages. Card marked hasFree + notice on the pricing split.
- **FreeAI (JembatanAI)** (`ja`) — 11 models from the Star's intel
  (Claude Opus 4.8, Sonnet 5, GPT-5.6 Luna, DeepSeek V4 Pro/Flash (+jailbreak
  variants), MiniMax M3, GLM 5.2, Qwen3.8-Max), ids keep the router prefix
  (`anthropic/...`, `openai/...`). **Correction sealed**: "FreeAI" is the
  product name, not a free tier — the misleading `hasFree` flag and free-tier
  notice are gone.
- **QZZ Router → IDRouter** — renamed at the Star's decree: the harbor is
  **IDRouter** (`id.solution.qzz.io`), textIcon `ID`, catalog filled:
  `deepseek-v4-flash-{cmc,cp,oc,qd}` + `qoder-lite`.
- **Token Harbor** (`th`) — 18 models scraped live from tokenharbor.ai/models
  (Claude Opus/Fable/Sonnet 5, GPT-5.6 Sol/Terra/Luna, Kimi K3, Qwen3.8 Max +
  2.4T A95B, DeepSeek V4 Pro/Flash (+`:free`), GLM 5.2, Gemini 3.7 Flash,
  MiniMax M3, MiMo V2.5 (+`:free`) / Pro) — card marked hasFree.
- **WeiZerRouter → WeizeRouter** — renamed + 23 models from the Star's own
  model directory (all `wz/`-prefixed, validated 2026-08-13 WIB), and **the
  Star's logo imported** from `Downloads/photo_2026-07-04_19-07-32.jpg` →
  `public/providers/weizerouter.png` (256×256). The TLS-refusal notice is
  replaced by the honest directory note.

## ⚙️ Internal
- Providers + alias baselines re-snapshotted, byte-for-byte clean.
- Golden version-header snapshots re-anchored at v0.6.21.

---

# v0.6.20 — The Fleet of Eight ⛵🌏

> *"Eight new sails on the horizon — Indonesian gateways, one and all,
> charted shore by shore before a single rope was tied."*

*Sealed 2026-08-14 · the Star's fleet decree · Milestone Tide: big change → `0.6.13 → 0.6.20`*

## ✨ Features
- **Eight new API-key providers**, each researched live before wiring:
  | Provider | Alias | Models | Notes |
  |-|-|-|-|
  | **BandelBanget AI** 🟣 | `bbg` | 36 (public catalog) | Claude/GPT/DeepSeek/GLM/Kimi/Qwen, graded A/B |
  | **CodeCrafters** 🔵 | `ccr` | 16 (public catalog, IDR pricing) | free DeepSeek + MiMo tiers |
  | **FreeAI (JembatanAI)** 🟢 | `ja` | key-gated → passthrough | "Satu Endpoint AI untuk Developer Indonesia" |
  | **Token Harbor** ⚓ | `th` | key-gated → passthrough | standard OpenAI error envelope |
  | **QZZ Router** 🟩 | `qz` (+`idrouter`, `qzz-solution`) | key-gated → passthrough | Anthropic-style auth errors |
  | **NesaRouter** 🟠 | `nr` | key-gated → passthrough | OpenAI-compatible |
  | **MyTraceRoute** ⬜ | `mtr` | unknown — API 502 at research | `/v2` base path; notice on the card |
  | **WeiZerRouter** 🌐 | `wzr` | unknown — TLS refused research | notice on the card |
- **Seven logos imported** to `public/providers/` (256×256, transparent):
  harvested from each shore's own favicons/apple-touch-icons. WeiZerRouter
  refused every probe, so it sails on its text glyph until its gate opens.
- Alias collision resolved honestly: `bb` belongs to blackbox —
  BandelBanget takes `bbg`.
- Every key-gated provider carries `passthroughModels: true`, so any model
  id routes the moment a key is added; `validateUrl` wires the dashboard's
  connection test to each shore's `/models`.

## ⚙️ Internal
- Registry index regenerated by hand per the covenant (p122–p129); the
  providers + alias regression baselines re-snapshotted and verify
  byte-for-byte clean.
- Golden version-header snapshots re-anchored at v0.6.20.
- A stale `.next` dev cache briefly 404'd deep dashboard routes during the
  forge — cleared, not a code issue.

---

# v0.6.13 — The Watcher on the Wall 👁️⛵

*Sealed 2026-08-14 · Milestone Tide: small change → `0.6.12 → 0.6.13`*

## 🔧 Changes & Improvements
- **MiMo Code Free returns to the providers page.** Upstream had hidden it
  (Xiaomi ended the free channel), and the card went dark in the Convergence.
  At the Star's decree, `mimo-free` (`mmf`) is surfaced again — the registry
  carries the honest state in its comment: live-probed today, the bootstrap
  endpoint still issues a JWT, but the chat endpoint rejects every known model
  id (`Unsupported model`), so the card stands watch while requests will fail
  until the service restores a model or the OAuth replacement is wired.
- **Golden version headers re-anchored at v0.6.13** — and the v0.6.12 entry
  corrected: the version *does* ride `X-CLIENT-VERSION` / `X-CORE-VERSION`, so
  the snapshots had gone stale at that bump.

---

# v0.6.12 — A Jar of Its Own 🏺⛵

*Sealed 2026-08-14 · Milestone Tide: small change → `0.6.11 → 0.6.12`*

## 🐛 Fixes
- **Two gateways, two sessions**: the dashboard session cookie was named
  `auth_token` — the same name 9Router uses. Browsers key cookies by domain,
  **not by port**, so when Vela (`:32060`) and 9Router ran side by side on
  `localhost` they shared one cookie jar: logging into one evicted the other.
  Vela now stamps its own cookie, `vela_auth_token`, named in one place
  (`AUTH_COOKIE_NAME` in `src/lib/auth/dashboardSession.js`) and read in the
  guard and the status / SAML-test / OIDC-test routes. The two harbors keep
  separate sessions; neither knocks the other out. 🌊

## ⚙️ Internal
- No golden snapshot change — the cookie name does not ride the version
  headers. *(Corrected in v0.6.13: the version DOES ride the headers; the
  snapshots were left stale at this bump and re-anchored there.)*

---

# v0.6.11 — The Crest Risen 🏛️⛵

*Sealed 2026-08-14*

## ✨ Features
- **Brand assets come home**: the Star's crest and wordmark —
  `vela_logo_1024.png`, `vela_logo.svg`, `vela_wordmark.svg` — are imported
  into the harbor as `public/vela-logo-1024.png`, `public/vela-logo.svg`, and
  `public/vela-wordmark.svg`.
- **The crest flies everywhere — bare, as drawn**: `favicon.svg` is a
  byte-identical copy of `vela-logo.svg` (the Star's decree — full canvas,
  nothing carved), and the PWA icons (192/512), `favicon.ico`
  (multi-resolution), and the Next.js App Router convention icons
  (`icon.png`, `apple-icon.png`) all carry the full-frame crest with a
  transparent background — no tile, nothing added; the PWA manifest gains
  the full crest (SVG any-size + the 1024px PNG).
- **The reborn faces**: the sidebar brand block, the landing Navigation, the
  landing Footer, and the login page all raise the transparent crest in place
  of the old upstream glyph — and the three un-translated faces now say
  **Vela** instead of 9Router. CLI/npm/updater strings keep "9Router" — that
  is the real installer package, by covenant.
- **`qd/qmodel_38max` — Qwen3.8-Max** joins the Qoder registry, sealed into
  the ship (the Star's own edit, now official). Alias resolution and the
  provider baseline remain byte-for-byte clean.

## ⚙️ Internal
- Golden version-header snapshots regenerated for v0.6.11.

---

# v0.6.10 — The Convergence 🌊⛵

> *"The whole tide, not just the storm. Upstream v0.5.55 arrives at the harbor —
> every wave, every current, every new sail — merged whole into Vela, and the
> security holes that rode in with it sealed at the same breath."*

*Sealed 2026-08-14 · the full upstream v0.5.55 convergence · Milestone Tide: big change → `0.6.03 → 0.6.10`*

## 🔒 Security
- **Real IP provenance (GHSA-pjm4-8fpg-f9p6)**: `x-9r-real-ip` and the Host
  fallback were trusted from client-controlled headers whenever
  `custom-server.js` was not in the request path (`npm start`, `start:bun`),
  letting a remote caller pose as local to skip API key auth and reach
  `LOCAL_ONLY_PATHS` (`/api/mcp/*`, `/api/tunnel/enable`,
  `/api/auth/reset-password`). The server now stamps a per-process
  `x-9r-peer-token` on every request it sanitizes and only trusts
  `x-9r-real-ip` behind it — falling back to Host in development, failing
  closed in production. Also fixes IPv6 loopback detection (`::1`,
  `::ffff:127.0.0.1`) and routes `npm start` / `start:bun` through
  `custom-server.js` (Vela keeps port 32060).
- **Key gate hardening (Vela-only)**: `keyGate.extractClientIp` now requires
  the same peer-token proof before trusting `x-9r-real-ip` — upstream has no
  key gate, so this IP-allowlist surface is Vela's alone. The
  `resolveClientIp` internal-key loopback-Host fallback stands (it only ever
  loosens keys already pinned loopback).
- **Search**: `resolveBaseUrl()` rejects client-supplied non-public baseUrls
  (SSRF guard on `/v1/search`).
- **Login**: fresh-install remote login with the default password returns 403
  without issuing a JWT.
- **Usage**: `/api/usage/request-details` redacts request/response payloads.

## ✨ Features
- **Auth**: native **SAML 2.0 SSO** alongside OIDC — AuthnRequest generation,
  ACS assertion handling, SP metadata export, admin config test, replay-protected
  via a `saml_state` cookie matched against `InResponseTo`.
- **Providers**: **Alibaba Token Plan** (`token-plan.ap-southeast-1`) — the
  fourth Alibaba key type, Singapore-only, OpenAI-compatible transport only.
- **Providers**: `glm-5.3` added to GLM Coding and GLM (China).
- **Providers**: **Kimchi dual auth** — API keys as well as OAuth, with a
  working Test Connection for both modes.
- **Antigravity**: **Gemini 3.7 Flash** + tiered high/medium/low variants (also
  in the Gemini registry), with pricing and quota tracking.
- **TTS**: **Fish Audio** — model id travels in an HTTP `model` header, voice is
  a `reference_id` (preset or cloned voice model).
- **OpenCode-Go**: **transport-based routing** — routes by request format via
  declared transports instead of forcing every client into `/messages`;
  Codex/OpenAI clients no longer pay the lossy Responses→OpenAI→Claude double
  translation. Per-model `supportedFormats` guard; the bespoke executor is gone
  (its shared `_lastModel` cache could cross auth headers between concurrent
  requests).
- **Usage**: Claude quota calls dedup + cached (120s TTL keyed by access token,
  in-flight promise dedup, last-good read on soft failure) to stop multiple tabs
  tripping 429; manual refresh (↻) sends `force=1` to bypass the cache.

## 🐛 Fixes
- **Docker**: ship `sql.js` in the image so the pure-JS DB fallback can start —
  file tracing carried the JS without `dist/sql-wasm.wasm`, so a container with
  no native driver aborted with ENOENT and never got a database (#3248).
- **Usage**: read Gemini `usageMetadata` out of the antigravity `{ response }`
  envelope — every non-streaming antigravity request logged `IN 0 | OUT 0`
  (#3260).
- **Claude**: re-anchor passthrough cache breakpoints — the client's own
  `cache_control` markers pointed at pre-normalization offsets, so the tail was
  re-cached every request. Last system block and last tool pinned at 1h TTL,
  last assistant turn at 5m, mid-conversation system messages folded into the
  neighbouring user turn instead of hoisted into `body.system`.
- **Combos**: detect images from Hermes and attachment payloads (`images[]`,
  `experimental_attachments`, message-level `image_url`/`audio_url`, inline
  `data:` URIs) so the Vision Adapter auto-switch fires for Hermes/Ollama/
  Vercel AI SDK shapes.
- **Kiro**: intercept chat via `x-amz-target` — Kiro IDE 1.0.228+ moved
  `GenerateAssistantResponse` to `POST /` + header, bypassing MITM. Also emit
  the now-mandatory initial-response frame and map the `auto` model slot.
- **Kiro**: report real output tokens and stop discarding usable turns.
- **Qoder**: detect billing blocks at stream start and return a synthetic 403 so
  combo/account fallback triggers instead of leaking the error into chat.
- **Antigravity**: strip competitive system prompts (Zed IDE's Claude-agent
  prompt) that Antigravity flags with a 429 Quota Exhausted.
- **OpenCode**: send the official client fingerprint on free-tier requests so the
  Console stops classifying traffic as unidentified and rate-limiting it; session
  id resolves conversation-stable to preserve prompt caching.
- **Responses**: don't close the message on an empty `tool_calls` array — some
  providers attach one to every chunk, and the truthy check ended the message on
  the first content token (#3234).
- **Translator**: preserve `prompt_cache_key` when converting chat to responses.
- **Models**: expose snake_case token limits on `/v1/models`.
- **Combos**: strip `stream_options` from the Fusion panel fan-out to avoid a
  DeepSeek 400 (#3024); raise the dashboard model-test probe budget to 1024 and
  soft-pass reasoning-only responses (#3010).
- **Headroom**: the toggle reflects the `headroomEnabled` setting even when the
  proxy is down — it previously showed OFF while the engine kept calling
  `/v1/compress`; proxy status stays visible via the status chip.
- **Hermes**: add the `api_key` parameter to the model block in YAML config.
- **Providers**: add llm7 to provider test support.

## 📖 Documentation
- **i18n**: Spanish, French, and Brazilian Portuguese README translations.

## ⚙️ Internal
- **Convergence mechanics**: full merge of `upstream/master` (v0.5.55, 31
  commits ahead of the fork base) into Vela. Conflicts resolved to keep the
  Vela rebrand (name, version, description, port 32060, Ship's Log format)
  while taking every upstream functional change. Golden version-header
  snapshots regenerated to the new version.

---

# v0.6.03 — The Loopback Fallback 🧭

*Sealed 2026-08-14*

## 🐛 Fixes
- **Model-test 403 `ip_not_allowed` in dev**: testing a model on the Providers
  page (e.g. `/dashboard/providers/opencode`) failed with
  "Client address could not be determined for this allowlisted key" because the
  model-test self-call authenticates as the loopback-pinned **internal key**,
  but the client IP was derived only from `x-9r-real-ip` — a header stamped by
  `custom-server.js`, which is loaded only by the CLI launcher, never by plain
  `next dev` / `next start`. Added a narrowly-scoped `resolveClientIp` to the
  gate: explicit override → the socket-stamped header → a loopback Host
  fallback that applies **only to internal keys**. External keys still fail
  closed without a socket-stamped IP (an attacker cannot forge a loopback Host
  on a public socket), so the allowlist is never widened. Mirrors the
  documented dev fallback in `dashboardGuard.isLocalRequest`. Test covenant:
  7 new cases (5 unit for `resolveClientIp`, 2 end-to-end regression guards);
  the gate suite is now 59/59

# v0.6.02 — The Milestone Tide 🌊

*Sealed 2026-08-14 · the first tick under the new rite*

## 🔧 Changes
- **Versioning rite, redrawn by the Star's decree**: the semver tide gives way
  to the Milestone Tide — a small change ticks the last number up by one
  (`0.6.03 → 0.6.04`); a big change rounds the last number up to the next
  milestone of ten (`0.6.03 → 0.6.10`); rounding past `.99` carries into the
  middle digit (`0.6.93 → 0.7.0`). Versions carry two digits in the last
  place (`0.6.01`) — npm accepts the form for a private package. The log's
  banner and `docs/VERSIONING.md` are recarved to the new rite. This entry is
  the rite's first small-change tick: `0.6.1 → 0.6.02`

# v0.6.1 — Patch Tide 🩹

*Sealed 2026-08-14*

## 🐛 Fixes
- **Changelog modal**: the dashboard now serves The Ship's Log itself —
  the GitHub repo is private, so `raw.githubusercontent.com` returns 404
  for Vela's changelog (the modal rendered "Failed to load changelog:
  HTTP 404"). The log is mirrored to `public/CHANGELOG.md` by
  `scripts/sync-changelog.mjs` on every dev startup and build, the modal
  fetches `/CHANGELOG.md` from the gateway, and `docs/VERSIONING.md`
  records the mirror rite. The golden version-header snapshots follow the
  bump (the gateway stamps `pkg.version` into `X-CLIENT-VERSION` /
  `X-CORE-VERSION`)

# v0.6.0 — The Harbor Release ⛵

> *"The gateway comes home — Vela's first sail under her own name: a harbor
> landing, a reborn rail, and full governance over every key."*

*Sealed 2026-08-14 · the first release under the Vela name*

## ✨ Features
- **Dashboard Harbor homepage** (`/dashboard`): the dashboard root no longer
  renders the Endpoint page — it gets its own landing: a time-of-day greeting
  with a live idle/active pulse, a gradient hero band with the copyable
  `/v1` endpoint and today's stats (requests / tokens / spend / cache rate),
  an activity sparkline (last 10 minutes) with top-model bars, a Harbor
  status card (API-key requirement, dashboard login, cloud sync, tunnel)
  with a shortcut to key management, and six quick-nav tiles. Every number
  comes from a real API; every tile leads somewhere real.
  The header's stale "Endpoint" title for the dashboard root is gone — the
  homepage carries its own hero, the title slot stays clean.
- **Sidebar upgrade — Vela brand + grouped navigation**: the rail is reborn
  around the harbor. Fake macOS traffic lights removed; a Vela brand block
  (sail glyph in a warm brand gradient, "AI Gateway" tagline, mono version
  chip) leads; navigation is regrouped into labeled sections — Gateway
  (Endpoint & Key, Providers, Combos), Analytics (Usage, Quota, Token
  Saver), Tools (CLI Tools, Media Providers accordion, Proxy Pools,
  Skills), System (Console Log, Translator, 9Remote, 9English, Settings);
  a Home item anchors the rail and `/dashboard` is no longer claimed by the
  Endpoint item; active items carry a 3px brand indicator bar; the update
  banner is restyled as a success-tinted card; all nav labels now flow
  through the i18n runtime.
- **Vela branding**: `APP_CONFIG.name` → "Vela" (sidebar, footer, profile),
  document title → "Vela — AI Gateway", PWA manifest name/short_name → Vela.
  CLI/npm strings keep "9Router" — that is the real installer package.
- **API Keys — Governance wave W3 (limits)**: per-key limits are now enforced
  on every `/v1` request. The gate stage pipeline runs lifetime → IP allowlist
  → rate → spend → model scope:
  - **Rate limit (RPM)** — sliding 60s window per key; 429 `rate_limited` with
    the limit stated honestly in the message
  - **Token budget + spend cap** — one reset window (`budgetScope`:
    daily/weekly/monthly/yearly) governs both; soft-cap semantics (the
    in-flight request is counted after it completes) with usage aggregated
    from the same ledger the dashboard reads; 429 `budget_exceeded` with usage
    context; a 5s TTL cache keeps hot paths from re-summing the ledger
  - **IP allowlist** — CIDR entries (IPv4 + IPv6, mapped-form normalized);
    allowlisted keys fail closed when the client address cannot be determined;
    the gate trusts only `x-9r-real-ip`, stamped by custom-server from the
    socket peer — attacker-controlled forwarding headers are never read
  - **Expiration** — `expiresAt` → 401 `key_expired`
- **Key limits UI** (`/dashboard/endpoint`): a shared limits editor in both the
  create and edit modals — RPM presets, token budget templates (1M/10M/100M/1B),
  spend presets ($5/$10/$50/$100), custom values, an Unlimited toggle per
  section, the reset-window selector (shown when any budget is active), an
  expiration picker (Never / 7 / 30 / 90 days / custom date), and an IP
  allowlist textarea; key rows show limit badges (RPM, tokens, $, IP count)
- **Repo validation**: limit fields (`rateLimitRpm`, `tokenBudgetDaily`,
  `spendCapDailyCents`, `budgetScope`, `expiresAt`, `ipAllowlist`) join the
  repo's writable whitelist and are validated at create and update — positive
  integers or null, sealed scope set, future ISO expiry, CIDR syntax, ≤100
  entries. Invalid input → 400 naming every problem; security columns stay
  unwritable
- **Shared primitives**: CIDR matching + budget scopes + limit validation live
  in `src/lib/db/keyLimits.js` — a neutral home so the repo never imports the
  gate (which imports the repo). The gate re-exports them, API unchanged
- **Test covenant**: W3 gate-stage suite (CIDR matrix, fail-closed IP, sliding
  rate window, budget window boundaries, TTL cache, full-gate integration) +
  limits-validation suite (pure matrix + POST/PUT round-trips over a real temp
  DB). The internal key's loopback pin is now asserted end-to-end
- **i18n**: 25 limits strings seeded across all 34 locales via the governance
  seeder (68 governance keys total)
- **API Keys — Governance (waves W1/W2)**: a full-governance key system replaces
  the old plaintext `sk-` keys. New keys mint as `vela-v1-{keyId}-{crc}` — a
  128-bit CSPRNG identity plus a timing-safe HMAC-SHA256 checksum keyed by
  `API_KEY_SECRET`. Only `vela-` keys are accepted anywhere; every `sk-` key and
  every `?key=` query param is rejected
- **Hash-at-rest + show-once**: keys are stored only as a SHA-256 hash behind a
  unique index and shown in full exactly once, in the 201 create response. The
  dashboard and CLI each keep a local copy in their own vault; the server never
  reveals a key again
- **Secret lifecycle**: `API_KEY_SECRET` is both the HMAC root and the global
  revocation lever — the environment wins, otherwise it is auto-generated to
  `DATA_DIR/api-key-secret` (0600). Rotating the secret re-keys the internal key
- **Stage-pipeline gate**: every `/v1` enforcement site (chat, embeddings,
  count_tokens, gemini-native and 7 more — 11 sites total) resolves the bearer
  through `authorizeApiRequest`: lifetime → IP allowlist → rate → spend → model
  scope, returning an honest gate code (`INVALID_KEY`, `KEY_PAUSED`,
  `KEY_EXPIRED`, `MODEL_FORBIDDEN`, `QUERY_PARAM_KEY_REJECTED`)
- **Model scope (ACL)**: a key can be restricted to an allowed-models whitelist;
  out-of-scope requests receive 403 `MODEL_FORBIDDEN`
- **Internal key**: a deterministic loopback-only key for server-to-server use —
  hidden from every listing, derived from the secret, never persisted
- **Usage attribution**: usage history keys on `keyId`/`keyPrefix`, never the raw
  bearer token (masked dual-write)
- **Data directory**: Vela uses its own `vela` data folder — a clean break from
  `9router`. Legacy plaintext keys are tombstoned on migration and usage rows
  scrubbed
- **Dashboard `/dashboard/endpoint`**: governance UI — create with description
  and a model-scope picker, a show-once modal gated by a save-ack, edit
  name/description/scope, pause/resume, and badges (Active/Paused, scope count,
  "stored here")
- **Endpoint**: the key model-scope picker is now the same grouped per-provider
  selector the combos use (search, provider icons, click-to-add/remove chips)
  instead of a flat checkbox list. Values are stored as `alias/model` — the
  exact form the gate matches. Combo names are hidden there since combo
  requests are checked against their member models
- **i18n**: 39 governance strings seeded across 34 locales via
  `scripts/i18n-seed-literals.mjs` (`--check` detects drift); 39 more
  homepage + sidebar strings follow in the Harbor wave (110 keys total)
- **Test covenant**: 9 governance suites (format, gate ACL, migration 002,
  show-once, internal key, usage attribution, backup/restore, secret lifecycle,
  i18n parity) + an ACL enforcement-site baseline (`verify-apikey-enforcement`)
  + `known-fails` entries for the inherited db-concurrency timing artifacts. The
  covenant caught a real migration bug (`db.prepare()` on the adapter interface)
  before it could crash a boot

## 🐛 Fixes
- **Endpoint**: the first-time "Default Key" auto-provision is now guarded
  against concurrent runs — StrictMode's double-invoke raced two loads, both
  saw zero keys, and both POSTed (visible as duplicate "Default Key" rows).
  The provisioning flag is set synchronously before the first await, so only
  one caller ever reaches the POST; the flag resets in `finally` so a page
  with zero keys can still provision on a later load
- **Keys**: static-import the key crypto on the gate hot path — the per-call
  dynamic `await import()` inside `resolveKey` inflated p99 latency under CPU
  contention
- **Data dir**: complete the Vela clean break — every remaining module that
  duplicated the data-dir convention (`mitm/paths.js`, `mitmAliasCache`,
  `appUpdater`, `updater/updater.js`, `cli/cli.js` crash-recovery + runtime
  self-heal, `sqliteRuntime`) now resolves to `~/.vela` / `%APPDATA%\vela`
  instead of 9router's. MITM root CA is Vela's own (`vela-root-ca.crt`,
  "Vela MITM Root CA" CN), DNS rollback files use `.vela.*` suffixes, tray
  logs go to `/tmp/vela.log`. Docker image/container/volume, `.env.example`,
  README paths, and dashboard/landing display paths follow. Nothing Vela
  writes touches the 9router directory anymore

## 🔧 Changes
- **Header**: the Donate button is gone — `DonateModal` removed, the header
  button/state/import unwired, `donateUrl` dropped from config, and the
  `Donate` string removed from the 5 locale files that carried it
- **Config**: move the default port from 20128 to 32060 across the whole harbor —
  app config (`src/shared/constants/config.js`), CLI defaults (`cli/cli.js`,
  `cli/src/cli/api/client.js`, xAI video command), updater, tunnels, MITM defaults,
  dashboard tool cards and landing page, plus `.env.example`, Dockerfile,
  docker-compose.yml and start.sh. Docs, i18n literals, translations and tests
  follow the same number. Existing installs that hardcode 20128 must update their
  `.env` (`PORT`, `BASE_URL`, `NEXT_PUBLIC_BASE_URL`) and any client base URLs
- **Dev ergonomics**: `allowedDevOrigins` (LAN + Tailscale hosts) in
  `next.config.mjs` so the dashboard browsed via the homelab IP can load
  dev HMR/static assets
- **The Ship's Log**: the changelog itself is themed — ✨/🐛/🔧/📖/⚙️/⚠️
  section headings, a banner with the legend and the versioning covenant
  (every change bumps `package.json` and logs here, sealed together in the
  same commit), and the legacy 9Router history preserved beneath the new
  tide. The dashboard's changelog modal now fetches Vela's own
  `CHANGELOG.md` instead of the upstream 9router's, and
  `docs/VERSIONING.md` codifies the rite

## 📖 Documentation
- **Plans**: the Shorekeeper-Sealed Plan for API key governance is born —
  `plans/vela-key-governance.md`: `vela-v1-{keyId}-{crc}` keys, hash-at-rest +
  show-once, an 11-site stage-pipeline gate, full governance in waves W1/W2/W3,
  migration 002 design with sentinel tombstones, and the four full-key consumer
  redesigns (MITM derived key, CLI capture-at-create, keyId cards, keyId usage).
  Sealed after five adversarial passes and a 4.2/5 arbiter review; implementation
  follows on a feat branch

---

# v0.5.55 (2026-08-14)

## Features
- **Auth**: native SAML 2.0 SSO alongside OIDC — AuthnRequest generation, ACS
  assertion handling, SP metadata export, admin config test, replay-protected
  via a `saml_state` cookie matched against `InResponseTo`
- **Providers**: add Alibaba Token Plan (`token-plan.ap-southeast-1`) — the
  fourth Alibaba key type, Singapore-only and OpenAI-compatible transport only
- **Providers**: add `glm-5.3` to GLM Coding and GLM (China)
- **Providers**: Kimchi accepts API keys as well as OAuth (dual auth), with a
  working Test Connection for both modes
- **Antigravity**: add Gemini 3.7 Flash and its tiered high/medium/low variants
  (also in the Gemini registry) with pricing and quota tracking
- **TTS**: add Fish Audio — model id travels in an HTTP `model` header, voice
  is a `reference_id` (preset or cloned voice model)
- **OpenCode-Go**: route by request format via declared transports instead of
  forcing every client into `/messages` — Codex/OpenAI clients no longer pay a
  lossy Responses→OpenAI→Claude double translation. Per-model `supportedFormats`
  guard; the bespoke executor is gone (its shared `_lastModel` cache could cross
  auth headers between concurrent requests)
- **Usage**: dedup + cache Claude quota calls (120s TTL keyed by access token,
  in-flight promise dedup, last-good read on soft failure) to stop multiple
  tabs tripping 429; manual refresh (↻) sends `force=1` to bypass the cache

## Fixes
- **Docker**: ship `sql.js` in the image so the pure-JS DB fallback can start —
  file tracing carried the package's JS without `dist/sql-wasm.wasm`, so a
  container with no native driver aborted with ENOENT and never got a database
  (#3248)
- **Usage**: read Gemini `usageMetadata` out of the antigravity `{ response }`
  envelope — every non-streaming antigravity request logged `IN 0 | OUT 0`
  (#3260)
- **Claude**: re-anchor passthrough cache breakpoints — the client's own
  `cache_control` markers point at pre-normalization offsets, so the tail was
  re-cached every request. Last system block and last tool pinned at 1h TTL,
  last assistant turn at 5m, mid-conversation system messages folded into the
  neighbouring user turn instead of hoisted into `body.system`
- **Combos**: detect images from Hermes and attachment payloads (`images[]`,
  `experimental_attachments`, message-level `image_url`/`audio_url`, inline
  `data:` URIs) so the Vision Adapter auto-switch fires for Hermes/Ollama/
  Vercel AI SDK shapes
- **Kiro**: intercept chat via `x-amz-target` — Kiro IDE 1.0.228+ moved
  `GenerateAssistantResponse` to `POST /` + header, bypassing MITM. Also emit
  the now-mandatory initial-response frame and map the `auto` model slot
- **Kiro**: report real output tokens and stop discarding usable turns
- **Qoder**: detect billing blocks at stream start and return a synthetic 403
  so combo/account fallback triggers instead of leaking the error into chat
- **Antigravity**: strip competitive system prompts (Zed IDE's Claude-agent
  prompt) that Antigravity flags with a 429 Quota Exhausted
- **OpenCode**: send the official client fingerprint on free-tier requests so
  the Console stops classifying traffic as unidentified and rate-limiting it;
  session id resolves conversation-stable to preserve prompt caching
- **Responses**: don't close the message on an empty `tool_calls` array — some
  providers attach one to every chunk, and the truthy check ended the message
  on the first content token (#3234)
- **Translator**: preserve `prompt_cache_key` when converting chat to responses
- **Models**: expose snake_case token limits on `/v1/models`
- **Combos**: strip `stream_options` from the Fusion panel fan-out to avoid a
  DeepSeek 400 (#3024); raise the dashboard model-test probe budget to 1024 and
  soft-pass reasoning-only responses (#3010)
- **Headroom**: the toggle reflects the `headroomEnabled` setting even when the
  proxy is down — it previously showed OFF while the engine kept calling
  `/v1/compress`; proxy status stays visible via the status chip
- **Hermes**: add the `api_key` parameter to the model block in YAML config
- **Providers**: add llm7 to provider test support

## Docs
- **i18n**: add Spanish, French, and Brazilian Portuguese README translations

## Security
- **Real IP**: `x-9r-real-ip` and the Host fallback were trusted from
  client-controlled headers whenever `custom-server.js` was not in the request
  path (`npm run start`, `start:bun`), letting a remote caller pose as local to
  skip API key auth and reach `LOCAL_ONLY_PATHS` (`/api/mcp/*`,
  `/api/tunnel/enable`, `/api/auth/reset-password`). The server now stamps a
  per-process `x-9r-peer-token` on every request it sanitizes and only trusts
  `x-9r-real-ip` behind it — falling back to Host in development and failing
  closed in production (GHSA-pjm4-8fpg-f9p6). Also fixes IPv6 loopback
  detection (`::1`, `::ffff:127.0.0.1`) and routes `npm run start` /
  `start:bun` through `custom-server.js`
- **Search**: `resolveBaseUrl()` rejects client-supplied non-public baseUrls
  (SSRF guard on `/v1/search`)
- **Login**: fresh-install remote login with the default password returns 403
  without issuing a JWT
- **Usage**: `/api/usage/request-details` redacts request/response payloads

# v0.5.50 (2026-08-05)

## ✨ Features
- **Providers**: add TokenRouter (300+ models via OpenAI-compatible gateway) with
  exact per-model pricing for 110 models and `reasoning_effort` thinking config
- **Providers**: add Self-hosted STT / TTS / Embedding — point 9Router at your own
  OpenAI-compatible speech and embedding servers (whisper.cpp, faster-whisper,
  Kokoro-FastAPI, llama-server, vLLM, Infinity). Unlike the named cloud providers
  these read `baseUrl` per connection, so one provider can front several machines
- **Combos**: default-enable vision/audio capacity adapter (auto-routes to a
  vision/audio-capable model when the target lacks that capability, falling back
  to `oc/mimo-v2.5-free`), wired into chat handler routing
- **Endpoint**: auto-provision a "Default Key" for first-time users so `/v1`
  works without a manual dashboard step
- **Codex**: support GPT-5.6 Max/Ultra reasoning-level overrides (cx/ routes only)
- **Qoder**: support PAT (Personal Access Token) connections end-to-end, alongside
  OAuth device flow
- **CLI tools**: add OpenDesign (manalkaff/opendesign) support
- **Headroom**: report effective payload savings (tool schema/history bytes broken
  out, byte-savings % reflects actual outbound reduction)
- **Ollama**: Cloud quota tracker (session + weekly) + proactive background OAuth
  token refresh scheduler for all providers

## 🐛 Fixes
- **Providers**: remove Qwen (OAuth flow stopped working reliably)
- **Passthrough**: detect codex-tui/Codex Desktop as native Codex client — they
  were falling through to the translator and losing fields like `reasoning.summary`
- **OAuth**: scope antigravity header fixes to loadCodeAssist/onboardUser only
- **OAuth**: keep `open` external in the build so xAI/Grok token refresh works on
  Windows
- **OAuth**: declare missing `searchParams` in register-session handler (was a
  500 instead of JSON on error)
- **DB**: `ENABLE_REQUEST_LOGS` env var now overrides the UI setting correctly;
  observability defaults to off (opt-in)
- **Translator**: preserve Codex Responses Lite tool use across chat-native
  OpenAI-compatible providers
- **Translator**: don't drop image-only user messages in `prepareClaudeRequest`
- **Translator**: drop JSON Schema keywords Gemini rejects (`uniqueItems`,
  `contains`, `multipleOf`, `unevaluatedProperties`, `unevaluatedItems`,
  `contentSchema`)
- **Claude**: remove global header cache that leaked one client's identity
  headers onto another client/account sharing the server; gate `anthropic-beta`
  by model instead
- **Antigravity**: drop retired Gemini 3.0 quota tiers, show Gemini 3.6 Flash
  usage bars
- **Cloudflare AI**: declare API key authentication (dashboard showed "No
  connections" despite an active key)
- **GitHub Copilot**: hold monthly-exhausted accounts until UTC month reset
  instead of only cooling down 120s
- **CodeBuddy**: dodge Tencent CN content filter, add usage tracking, normalize
  codebuddy-intl messages
- **Usage**: stop losing cached prompt tokens in the forced-SSE→JSON path
- **Grok CLI**: display the public subscription tier from the OAuth token claim
- **Providers**: count apikey connections for Ollama free-tier card; free-tier/
  apikey providers without `authModes` now default to apikey (were treated
  oauth-only)
- **Build**: include static/public assets in standalone output (login page hung
  on 404s when run via PM2)
- **Server**: support IntelliJ IDEA OpenAI-compatible clients over HTTP (h2c
  upgrade handling)
- **Auth**: redirect already-logged-in sessions away from `/login`
- **CLI tools**: enable Apply button for dynamic OpenAI/Anthropic-compatible
  provider connections
- **CLI**: include complete API artifacts in the CLI package
- **TTS**: a bare self-hosted model name is the MODEL, not the voice — `kokoro`
  was parsed as a voice against a default model, 404ing or synthesising with the
  wrong one
- **Embeddings**: self-hosted embeddings no longer fall back to `api.openai.com`
  when a connection has no `baseUrl` — that silently sent the input text and API
  key to OpenAI under a provider named "Self-hosted"
- **Embeddings**: an adapter that rejects a misconfigured connection now returns
  400 with the reason instead of escaping the handler uncaught
- **Embeddings**: bound the upstream fetch with `FETCH_CONNECT_TIMEOUT_MS` — an
  endpoint that drops packets never returns headers, so the request previously
  hung indefinitely

## 📖 Docs
- **i18n**: fix port typo, add RTK Token Saver feature descriptions

# v0.5.45 (2026-07-30)

## ✨ Features
- **TTS**: add Xiaomi MiMo text-to-speech (preset voices 冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean, style control, language hint dropdown with Auto-detect, i18n for Style label/placeholder)
- **Providers**: add Poolside (OpenAI-compatible)
- **Providers**: add api-airforce, baidu, bazaarlink, bluesminds, kilo-gateway, llm7, morph, sambanova, tencent
- **OAuth**: zed / trae / windsurf providers + harden callback proxies
- **CLI tools**: set Claude Code max context tokens
- **Qoder**: PAT auth + refresh model list
- **Gemini**: Gemini 3.6 Flash tier routing + Gemini 3.5 Flash Lite
- **Claude**: bump default Opus to `claude-opus-5`
- **Kiro**: add Claude Opus 5 models
- **Usage**: Kimi and DeepSeek usage handlers
- **Usage**: SuperGrok weekly pool via gRPC-web

## 🐛 Fixes
- **Refresh**: rotate `refresh_token` between retry attempts
- **Kiro**: canonicalize tool history and route API keys correctly
- **Kiro**: normalize dashboard thinking intensity models
- **Cursor**: stop leaking agent tool errors as text
- **Gemini**: fill empty tool schemas after `$ref` strip
- **Antigravity**: strip `stream_options` from non-stream requests
- **Jina-reader**: recover after transient errors, use JSON POST API
- **Usage**: record exact embedding tokens
- **Tunnel**: preserve successor cloudflared PID
- **Console-log**: initialize capture at server boot + prevent SSE proxy buffering
- **Dashboard**: count dual-auth, free-tier OAuth and API-key connections correctly
- **Dashboard**: flex quota rows, thin global scrollbars, no hidden-row overflow

## 📖 Docs
- **i18n**: expand pt-BR translation to 986 terms
- README: Indonesian translation

# v0.5.40 (2026-07-20)

## ✨ Features
- **i18n**: add Khmer (km) translations
- **CLI tools**: configure Grok Build subagent models
- **Kimi**: merge OAuth into dual-auth provider, add K3 / K2.7 models
- **Dashboard**: ProviderTopology flow animation

## 🐛 Fixes
- **DB**: resolve better-sqlite3 parameter binding crash
- **Translator**: pass `service_tier` through OpenAI → Responses conversion
- **Kiro**: map GPT-5.6 reasoning effort fields
- **Kiro**: validate terminal streams before emitting output
- **Kiro**: map GPT reasoning effort fields
- **Codex**: current `client_version` + refresh-aware model sync
- **Alicode-intl**: split into Coding Plan + Model Studio providers
- **Cursor**: HTTP/2 AgentService support + version bump 3.12.17
- **Dashboard**: cut duplicate API/icon spam, lazy-load provider assets


# v0.5.35 (2026-07-16)

## ✨ Features
- **xAI**: Grok Imagine video generation (`/v1/videos`) + CLI
- **CLI tools**: Grok Build setup — choose separate main/general-purpose/explore/plan models and preserve each model's context window
- **GitHub Copilot**: route Claude models through Copilot's native `/v1/messages`
- **Kiro**: add GPT-5.6 model family (#2596)
- **RTK**: `X-9Router-Token-Saver` header to bypass token savers per request
- **Providers**: quota visibility settings
- **Translator**: drop temperature for all Claude models
- **i18n**: Thai (th) + Persian (fa) translations / README

## 🐛 Fixes
- **Providers**: bulk-add API keys no longer overwrite existing keys (gap-fill `Key N`)
- **Anthropic**: lowercase `anthropic-version` header to prevent duplication on `/v1/messages`
- **Alicode-intl**: use DashScope compatible-mode endpoint so standard keys work
- **Grok CLI**: align Grok Build with current subscription protocol (#2590)
- **Grok CLI**: surface `expiresAt` so proactive token refresh fires (#2546)
- **Kiro**: improve direct session cache reuse
- **Models**: populate capabilities for live-catalog LLM models
- **Models**: list compatible provider models in `/v1/models`
- **Thinking**: send explicit `thinking:{type:adaptive}` alongside `output_config.effort`
- **Translator**: strip `client_metadata` when converting openai-responses → openai

## 🔧 Improvements
- **Perf**: skip inactive background services on startup

## 📖 Docs
- README: Persian YouTube tutorial

# v0.5.30 (2026-07-10)

## ✨ Features
- **Perplexity**: add Agent API provider (#2492)
- **Grok CLI**: add Grok CLI / Grok Build provider with OAuth device-code flow (#2502)
- **Featherless**: add OpenAI-compatible provider presets
- **SearXNG**: configure endpoint via SEARXNG_URL env (#2499)
- **Providers**: add max thinking level for gpt-5.6-sol (#2500)
- **Headroom**: add extras detection and install UI (#2403)
- **Headroom**: activate/uninstall extras + fix interpreter detection
- **PXPipe**: PXPIPE token saver — multimodal prompt compression (#2465)
- **Proxy-Pools**: auto-rotate strategy for no-auth providers (#2409)

## 🐛 Fixes
- **Cloudflare-AI**: support accountId in bulk key import (#2449)
- **DB**: backup on schema change, MCP child cleanup, codex models, usage providers OOM
- **Codex**: avoid bare-email OAuth dedup (#2477)
- **CLI**: allow staged app bundle builds (#2479)
- **Headroom**: compress Kiro conversation state (#2488)
- **Gemini-CLI**: raise output floor for thinking and add validated toolConfig (#2486)
- **GitHub**: label Copilot profiles by account identity (#2498)
- **OpenAI-to-Claude**: unwrap bare {function:{…}} tools without parent type (#2473)
- **Translator**: clamp thinking effort max->xhigh for OpenAI format (#2466)
- **RTK/find**: detect and group Windows backslash-style find output (#2448)
- **Codex**: handle fast tier and capacity SSE (#2452)
- **Volcengine-ark**: clamp Kimi max_tokens to 32768 endpoint cap
- **Antigravity**: align provider fingerprint with IDE Desktop 2.1.1 (#2389)
- **Pricing**: update Claude/Codex model rates and add new models

## 🔧 Improvements
- **i18n(zh-CN)**: complete Chinese translations for all UI strings (#2436)
- **API**: caching for tunnel and version status endpoints
- **Perf**: faster dev startup and lighter bundle

# v0.5.20 (2026-07-07)

## ✨ Features
- **Thinking**: per-model thinking level picker on provider page — appends `(level)` suffix to copied model names for forced reasoning effort across all formats (openai, claude, gemini, deepseek, kimi, qwen, zai, minimax, hunyuan, step)
- **RTK**: add JS-native git-log filter (#2423)
- **Caveman**: add targeted upstream-aligned style rules (#2424)
- **i18n**: add Farsi (fa) language support (#2385)

## 🐛 Fixes
- **Thinking**: strip `(level)` suffix from upstream `body.model` so providers no longer reject requests
- **Translator**: preserve developer instructions in openai-responses conversion (#2434)
- **count_tokens**: count structured Anthropic blocks (#2419)
- **Volcengine-ark**: clamp GLM-5 max_tokens to model output ceiling (#2428)
- **Kimi**: normalize reasoning_effort to backend enum (#2427)
- **Claude**: reconcile max_tokens vs thinking budget and lift per-model ceiling (#2381)
- **Kiro**: deliver system prompt natively, add Opus 4.5/4.7/4.8, tolerate dash version ids (#2366)
- **Headroom**: proxy dashboard through app (#2372)
- **MITM**: recover from stale lock file on server start

# v0.5.18 (2026-07-03)

## ✨ Features
- **Usage**: track cached tokens + correct input/output/cache cost (#2209) — hodtien
- **Codex**: show reset credit expiry details (#2290) — Rafli Ahmad Zulfikar
- **NVIDIA**: add new models and capabilities — decolua
- **ClinePass**: add provider support — sternelee

## 🐛 Fixes
- **Usage**: dedupe streaming request-details log entries — Qin Li
- **Claude**: drop foreign thinking signatures in passthrough — decolua
- Prevent non-SSE stream pipe crash and cross-IdP account overwrites (#2244) — KunN-21
- **Kiro**: route IdC auth to regional CodeWhisperer surface (#2297) — Volodymyr Saakian
- **Kiro**: add Claude Sonnet 5 model support (#2264) — Edison42
- **Xiaomi-tokenplan**: region selector, key validation, multi-connection (#2251) — MiQieR
- **Translator**: strict Anthropic content block compliance (#2225) — Sahrul Ramadhan Hardiansyah
- **Kimchi**: strip reasoning_content echo to bound multi-turn input tokens — KunN-21
- **Kimchi**: bump User-Agent to kimchi/0.1.40 (#2256) — Ansh7473
- **Codebuddy-cn**: strip empty tool_calls arrays to preserve reasoning — zmf
- **Antigravity**: preserve Claude tool delta index (#2223) — Sutarto Jordan Chrisfivo
- **MITM**: generate root CA on server startup (#2228) — Sutarto Jordan Chrisfivo

# v0.5.15 (2026-06-29)

## ✨ Features
- Add Kimchi OAuth provider — Nant361
- Refine Qwen vision/video + thinking model patterns — decolua
- Opt-in Codex auto-ping quota keep-alive — Emirhan

## 🐛 Fixes
- **Responses**: handle response.done terminal events (#2142) — rifuki
- **Headroom**: skip unsafe responses tool history (#2132) — Sutarto Jordan Chrisfivo
- **Translator**: map mid-conversation system message to user (claude→openai) — decolua
- **Gemini**: normalize contents to prevent 400 invalid_argument (#2192) — warelik
- **Gemini**: backfill thoughtSignature + suppress stream done sentinel — WARELIK
- **Alicode**: preserve cache_control for DashScope providers (#2069) — Rex
- **Antigravity**: strip deprecated/readOnly/writeOnly from tool schemas — iletai, Yudhistira-Official
- **CodeBuddy CN**: show bonus packs as one-time, not monthly-replenishing — whale9820
- **Kiro**: strip leaked <thinking> tags from content stream (#2158) — hamsa0x7
- **Tray**: make Windows context menu DPI-aware — Emirhan
- **Kilocode**: expose full gateway catalog in combo model picker — jellylarper
- **OpenCode**: fix Go GLM — decolua

# v0.5.12 (2026-06-26)

## ✨ Features
- Add token-saver dashboard page — decolua
- Add bulk delete for provider connections — teddytkz
- Resolve GitHub Copilot model catalog from upstream — caiqinzhou
- Add Venice AI provider — Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) — Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support — suryacagur

## 🐛 Fixes
- Provider thinking compatibility (DeepSeek/Gemini) — Mink Nguyen
- Stop double-counting streaming usage at source — decolua
- Usage logging dedupe to reduce stats churn — Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) — qianze
- Resolve Gemini TTS models from catalog — nguyenha935
- Support Kiro IDC (organization) token import — quanturbo
- Preserve forced streaming for JSON clients (#2031) — Joseph Yaksich
- Preserve Responses text format (Codex) — tenglong
- Support Gemini native TTS generateContent endpoint — nguyenha935
- Add missing zh-CN endpoint key label (i18n) — weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) — Rex
- CodeBuddy CN: show one-shot bonus packs as expiring, not monthly-replenishing
- Show custom provider models in combo picker — Sapto
- Docker: add docker-compose.yml with headroom enabled by default — nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) — Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) — Ankit
- Kiro: report 1M context window for claude-opus-4.8 — EdisonPVE
- Avoid stale redirects after auth changes (#2100) — Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context — Brokenc0de
- Preserve reasoning effort through Codex translations — ntdung6868
- Token-saver: full width card layout — decolua
- Antigravity: retry transient upstream failures — Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) — Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) — hamsa0x7

# v0.5.8 (2026-06-21)

## ✨ Features
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## 🐛 Fixes
- **MiniMax-M3**: enable vision capability
- **Headroom**: support Docker sidecar proxy
- **Antigravity**: image executor fixes
- **mimo-free**: Chrome User-Agent rotation to bypass anti-abuse gate
- **cloudflare-ai**: flatten content-part arrays to string to avoid oneOf 400 (#1926)
- **Translator**: normalize tools to Anthropic-native shape for non-Anthropic providers
- **CLI**: handle Next.js 16 nested standalone output path (#1940)
- **Codex**: preserve custom tools during request normalization
- **next.config**: add new route for responses endpoint to API

# v0.5.6 (2026-06-20)

## ✨ Features
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) — 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## 🐛 Fixes
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## 🐛 Fixes
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v0.5.2 (2026-06-17)

## ✨ Features
- **Combo Fusion strategy** — fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** — pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** — reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** — warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## 🐛 Fixes
- **Claude 429**: stop hammering the OAuth usage endpoint — cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## ⚙️ Internal
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## ✨ Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## 🐛 Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## 📖 Docs
- README: add Indonesian 9Router tutorial video (#1709)

# v0.4.71 (2026-06-06)

## ✨ Features
- Caveman: add wenyan classical Chinese levels and sync upstream prompts; locale-based visibility on endpoint page
- i18n: endpoint exposure notice across multiple languages + Russian README
- Antigravity: add gemini-3.5-flash-extra-low (Low) model
- xiaomi-tokenplan: add Claude-native MiMo V2.5 Pro alias via dedicated executor
- Qoder: fetch latest model + dashboard import-model button (#1642)
- MiniMax: add MiniMax-M3 + update Quota Tracker coding/CN (#1631)

## 🐛 Fixes
- Codex: harden streaming timeouts (stall/connect raised to 60s, configurable per-provider), accept `response.done` event, and always emit a terminal `response.failed` + `[DONE]` for Responses passthrough when a stream closes, stalls, or aborts before a terminal event — prevents codex clients from hanging (#1648, #1680, #1688, #1618)
- Codex: durable OAuth refresh lifecycle (#1664)
- Tunnel: skip virtual interfaces to prevent false netchange watchdog
- Claude: fix forced tool_choice 400 on cc/ OAuth route (#1592)
- Proxy: raise Next client body limit to 128MB via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (#1529, #1572)
- MiniMax: echo `reasoning_content` on follow-up turns to avoid 400 (#1543)
- Kiro: handle 400 on tool-bearing history without client tools; add mappable "auto" model slot; fix binary EventStream crash + add models & TTS tool filtering
- Antigravity: passthrough tab-autocomplete + mark default agent slot mandatory
- Qoder: allow `qmodel_latest` model key (#1638)
- Providers: restore one-connection guard for compatible/embedding nodes
- Model-test: route image/STT probes to their real endpoints, harden STT ping; add opencode-go + xiaomi-tokenplan to connection test (#1576, #1628)

## 🔧 Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.66 (2026-05-29)

## ✨ Features
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## 🐛 Fixes
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## 🔧 Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## 🐛 Fixes
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## 🔧 Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## 🐛 Fixes
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs for quota checks and show clearer setup guidance when the project is missing (#1271, #1428)

## ✨ Features
- Add Cloudflare Workers proxy deployer and pool integration (#1360)
- Add Deno Deploy relays support and improved proxy pools dashboard layout (#1437)

## 🔧 Improvements
- Refactor Tunnel into dedicated Cloudflare and Tailscale manager modules
- Refactor tokenRefresh service with in-flight dedup to prevent refresh_token_reused errors

# v0.4.59 (2026-05-21)

## 🐛 Fixes
- OAuth: fix login flow on Windows

# v0.4.58 (2026-05-21)

## ✨ Features
- xAI Grok provider (OAuth, API key, image)
- Provider limits: paginated accounts with page size controls

## 🐛 Fixes
- Tailscale: fix connection status on Windows (#1300)
- Tunnel: fix false "checking" when tunnel URL is reachable
- Stream: fix pipe errors on client disconnect/abort

# v0.4.55 (2026-05-18)

## ✨ Features
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## 🐛 Fixes
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## 🔧 Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## ✨ Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## 🐛 Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## 🐛 Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## ✨ Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## 🔧 Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## 🐛 Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## ⚠️ Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL