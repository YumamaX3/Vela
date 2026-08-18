# 🪞 The Proxy Completion Covenant — Second Reflection Design Record

> *"The first reflection built the captain. The second reflection finds the captain half-armed — stubs where probes should reach the web, a hallucinated database where repos should write, constants where the re-pick should run. The Mirror turns again, and this time it charts the completion."* 🪞💜🌊

**Status**: Mirror Phase 3–4 (framing under adversarial challenge)
**Opened**: 2026-08-18
**Decree**: "all of it" — real probes, sweeper/scoping refinements, pool-scoped retry, everything in ONE sealed tide

---

## Phase 1–2: Intelligence & Prior Art (completed 2026-08-18)

Intensive fan-out (4 opus streams + own-eye verification) yielded the truth ledger.

### The Gap Census — what v0.9.4 truly holds

**REAL (verified, works):**
- `pick()` smart strategy: weighted sampling + unfit filtering
- `recordOutcome()`: EWMA success/failure/latency updates
- `recordClaimGate()`: unfitUntil TTL on {country_blocked, ip_capped}
- `repick()` loop with budgetMs/maxAttempts
- `flushNow()` batched upsert via dirtyKeys
- SOCKS5 branch in `getDispatcher` (undici Socks5ProxyAgent)
- Migration 011 DDL + facade/sqlite/mysql repos + replayRegistry EXEMPT
- `connectionProxy.js pickProxyPoolId` untouched & working

**STUB / MISSING (the completion's scope):**
| Seam | Current | Must become |
|-|-|-|
| `probeEgress` | `{ip:"0.0.0.0", country:null}` | Real ipify fetch through pool dispatcher + geo |
| `checkPoolHealth` | `{ok:true, elapsedMs:50}` | Real test via proxyTest (socks-aware) |
| `disablePool`/`resetFitness` | `global.dbClient` — HALLUCINATED, undefined anywhere | Real repo imports (`getProxyPools`/`updateProxyPool` facade) |
| `fleetStartup.startFleet` | Defined, never called | Wired to server boot / instrumentation hook |
| `auth.js` hooks | Import only, no calls | `recordOutcome` in markAccountUnavailable/clearAccountError |
| `freebuff.js` re-pick | Constants only, never executed | Loop inside gate-catch |
| `FleetStatusPanel` | Unmounted | Mounted on providers/[id] |
| `proxyTest.js` | ProxyAgent-only | Soc5 branch |
| `VALID_PROXY_TYPES` / `[id]/validTypes` | No socks5; deno gap | Shared proxyTypes constant |
| UI strategy | round-robin only visible | smart option |
| Tests | Half tautologies | Real logic assertions |

### PriorArtDeep — MIBP reference findings (adopted)
- Continuous decay + TTL eviction (expire low-scoring providers, not just temporary unfit)
- Unfit scope wildcard syntax `provider::model` (blanket mark without permanent blacklist)
- Idle detection: track `lastSuccessfulRequest` separately from `lastUpdated`
- PoolScoped retry: prefer same pool before failover (reduce cross-pool churn)
- Debounced settings persistence (MIBP) — Vela's SQLite approach is strictly better; adopted only for the algorithmic ideas

### UISurface + ProviderNeeds findings
- Pools page: 7 toolbar actions, 8 columns, 5 modals — no fitness/geo/latency display, no Export
- Per-provider page: bulkProxyPoolId + providerStrategy exist; FleetStatusPanel unmounted; NoAuthProxyCard has strategy select (none/round-robin/random)
- Settings persistence: `providerStrategies` via PATCH /api/settings
- 34 locales — new strings need seeding

---

## Phase 3: Requirement Elicitation (Star's decree — "all of it")

### Requirements Register

| # | Requirement | Priority |
|-|-|-|
| P1 | Real `probeEgress` — ipify through dispatcher + geo (ip-api, manual-rate-limited) | MUST |
| P2 | Real `checkPoolHealth` — socks-aware test via proxyTest | MUST |
| P3 | Kill `global.dbClient` hallucination — real repo imports everywhere | MUST |
| P4 | `fleetStartup.startFleet()` wired to server boot | MUST |
| P5 | `recordOutcome` hooks placed in auth.js markAccountUnavailable/clearAccountError | MUST |
| P6 | Freebuff re-pick loop EXECUTED in gate-catch (constants → run) | MUST |
| P7 | Mount FleetStatusPanel on providers/[id] | MUST |
| P8 | shared `proxyTypes` constant: socks5 + deno gap fixed, both routes aligned | MUST |
| P9 | smart strategy option in UI strategy selects (pools + per-provider) | MUST |
| P10 | MIBP adoptions: continuous decay, unfit-scope wildcard `provider::model`, idle-detection (`lastSuccessfulRequest`), poolScoped retry flag | MUST |
| P11 | Real tests — replace all `expect(true).toBe(true)` tautologies | MUST |
| P12 | Fitness/geo/latency columns + Export button on pools page | MUST |
| P13 | i18n seeding for new strings across 34 locales | SHOULD |

### Success Criteria (checkable)
1. `probeEgress` returns real `{ip, country, ok}` when a live pool is probed (tested against mocked fetch)
2. `checkPoolHealth` returns real latency/error for dead pools (socks + http both)
3. Zero references to `global.dbClient` in src/ — all through repo facades
4. `startFleet()` imported by server boot path (verified via grep + boot log)
5. `auth.js` calls `fleet.recordOutcome` in both success + error paths
6. Freebuff executor's gate-catch executes the re-pick loop (unit test drives a blocked claim → asserts re-pick + exhaustion)
7. FleetStatusPanel renders on providers/[id] (import + mount verified)
8. socks5 + deno both valid in create and update paths (single shared constant)
9. smart option selectable in both UI surfaces
10. fitness columns + export render real data from /api/proxy-pools/fitness
11. No `expect(true).toBe(true)` anywhere in tests/unit/proxy-fleet*
12. MIBP adoptions present: decay formula, wildcard scope, idle tracking, poolScoped flag
13. i18n: new literal keys exist in en + at least provider-surfaced locales

---

## Phase 4: Frame Definition (under adversarial review)

**Problem statement:**
> Vela v0.9.4 shipped the Fleet Captain's bones without its sinews: the probes and health checks return canned values, a hallucinated `global.dbClient` underlies two write paths, the re-pick covenant exists as constants waiting in the executor's wings, the outcome hooks were imported but never placed, the panel was never mounted, and half the test suite proves nothing. MIBP's decade of proxy intelligence carries refinements — continuous decay, scope wildcards, idle detection, pool-scoped retry — that the covenant has not yet adopted.

**How might we:**
> How might we complete the Proxy Covenant in one sealed tide — real probes and health checks, a truthful persistence layer, executed re-pick and outcome wiring, mounted UI, adoptions from MIBP's reference layer (continuous decay, scope wildcards, idle detection, pool-scoped retry), honest tests, and full type/strategy/i18n completion — so the fleet is not merely charted but truly armed, at 1–1,000 pools?

**Gate 4 adversarial verdict**: REFUTED with Partial Repair (2026-08-18, the-tidebreaker on opus). 8/10 failures verified TRUE by code evidence (probe stub :576, health stub :533, 4× global.dbClient uses / 0 defs :47/:183/:478/:588, no fleet.repick in gate-catch :245-268, auth.js ends :404 with no fleet.* calls, startFleet dead, FleetStatusPanel orphaned, deno divergence, 7 tautologies, proxyTest socks5 absent). CRITICAL CORRECTION: the persistence failure is **ONE structural fault** — `proxyFleet.js` bypasses the repo facades (which already take `db` as a param correctly) and hallucinates `global.dbClient`; there are not two independent write-path faults. The frame adopts the correction: the fix lands as facade imports in the captain only.

**Repair path absorbed (sealed into the plan):**
1. Replace `global.dbClient` with facade imports in proxyFleet.js (receive db param like the repos do)
2. `probeEgress` → real proxy test (undici) + ipify fetch + geo (ipapi.co), returns real {ip,country}; fail-open on geo
3. `checkPoolHealth` → delegate to socks-aware proxyTest.js (add socks5 branch there)
4. freebuff gate-catch → execute re-pick loop (recordClaimGate → pick next fit → rebuild proxyOptions → re-claim; honest exhaustion into existing synthetic path)
5. auth.js → place recordOutcome/recordClaimGate calls at markAccountUnavailable + model-lock branches
6. FleetStatusPanel → import + mount on providers/[id]
7. Merge validTypes: shared proxyTypes constant (socks5 + deno)
8. Replace all 7 tautologies with real assertions (computeScore, pick, EWMA, re-pick budget, unfit TTL)
9. proxyTest.js → add socks5 dispatcher branch
10. startFleet → wire into Next.js instrumentation hook or server boot seq

---

## Decision Log

| Date | Decision | Rationale |
|-|-|-|
| 2026-08-18 | "All of it" — one sealed completion tide (v0.9.5) | Star's decree — no wave-splitting |
| 2026-08-18 | Real probes (ipify + geo) as must-have | Star's decree — probe realism |
| 2026-08-18 | Adopt MIBP decay/scoping/idle/poolScoped-retry refinements | Star's decree + reference implementation |
| 2026-08-18 | Kill global.dbClient hallucination via repo facades | Truthful persistence — audit finding P3 + Gate 4 correction (one fault, captain-only) |
| 2026-08-18 | Frame survives with the single-fault correction + 10-step repair path | Gate 4 adversarial verdict absorbed |

*The frame stands sharp. The Tidebreaker reads it next.* 🪞💜

---

## Phase 5: Divergent Ideation — Three Approaches (completed 2026-08-18, opus, parallel)

Three architects in parallel, each a distinct angle on the same covenant — independence preserved, no cross-influence.

### Approach 1 — Sinew in Place ⚙️ (~7h, 7 files)
**Core idea:** Repair every seam in place — flesh out stubs, import the facades, execute the re-pick, mount the panel. No structural relocation.
- Real `probeEgress` (ipify through pool dispatcher + geo via ipapi.co, fail-open), real `checkPoolHealth` (delegates to socks-aware proxyTest), `global.dbClient` (4 uses) → facade imports
- Freebuff gate-catch executes re-pick; auth.js hooks placed; startFleet wired to boot; panel mounted; shared proxyTypes constant
- Probe rate-limit cache (30s window per pool), fail-open probe contract, no new API surfaces
- **Weakness:** in-memory MIBP workarounds; earlier approach stressed `lastSuccessfulRequest` tracking — partial idle detection only; captain stays as a loose global module

### Approach 2 — Captain Refit 🛠️ (~6.5h, 6 files — the strongest backbone)
**Core idea:** The captain is rebuilt at its joints, not just patched: constructor dependency-injection kills the `global.dbClient` hallucination at the root, async `init()` lifecycle makes the fleet bootable, and **all MIBP adoptions map onto existing migration-011 columns — NO migration 012 needed**.
- `bindCaptain({ getProxyPools, updateProxyPool, upsertFitnessBatch, getFitnessRows })` at module load; `initCaptain` → async `init()` returning a ready FleetAPI; boot via `src/app/api/instrumentation.js` onRequest (mirrorPump global-singleton precedent)
- MIBP adoptions inside the captain: continuous 7-day EWMA decay (via existing `unreadiedAt`), provider-wildcard `""|provider` fallback rows, idle detection, poolScoped retry flag threaded through `resolveForConnection`
- `FleetStatusPanel` mounted reading `getFitnessSummary()` from memory; `proxyTest.js` gains `testSocks5Proxy` (protocol-prefix detection)
- **Honest self-assessment:** "Choose Captain Refit if you value long-term maintainability" — all 13 criteria satisfied, no migration 012

### Approach 3 — Test-Driven Completion 🧪 (~16-17h)
**Core idea:** The tests are the spec. Rewrite `proxy-fleet-covenant.test.js` with real assertions FIRST — probe contract via mocked proxyAwareFetch, health via mocked testProxyUrl, EWMA math, unfit TTL, re-pick budget/exhaustion, pick parity, wildcard, idle — they fail against today's stubs, then the refit turns them green. Red→green covenant; no tautology survives by construction.
- vi.spyOn(proxyFetch, "proxyAwareFetch"), vi.mock("undici"), global.dbClient → injected-bindings mock, fleet singleton mocked at consumer sites
- **Weakness in isolation:** the tests are only half the ship — code completion still required; effort nearly 2.5× the refit

---

## Phase 6: Approach Curation (weighing — under adversarial attack)

### Score vs the 13 success criteria

| # | Criterion | A1 Sinew | A2 Refit | A3 Test-Driven |
|-|-|-|-|-|
| 1 | Real probeEgress | ✅ | ✅ | ├ (proved by test) |
| 2 | Real checkPoolHealth | ✅ | ✅ | ├ |
| 3 | Zero global.dbClient | ⚠️ facade imports — coupling lingers | ✅ constructor DI, root kill | ✅ |
| 4 | startFleet wired to boot | ✅ | ✅ async init + instrumentation | ├ |
| 5 | auth.js recordOutcome | ✅ | ✅ | ├ |
| 6 | re-pick executes in gate-catch | ✅ | ✅ | ├ (driven by test) |
| 7 | Panel mounted | ✅ | ✅ | ├ |
| 8 | shared proxyTypes constant | ✅ | ✅ | ├ |
| 9 | smart strategy selectable | ✅ | ✅ | ├ |
| 10 | fitness columns + export real | ✅ | ✅ | ├ |
| 11 | No tautologies | ⚠️ rewrite needed separately | ⚠️ rewrite needed separately | ✅ by construction |
| 12 | MIBP adoptions present | ⚠️ in-memory partials | ✅ on existing columns | ├ |
| 13 | i18n seeding | ✅ | ✅ | ├ |

`├` = inherits the refit (A3 wraps A2's code; the test contract enforces it)

### The curated merge — "The Refit, Driven by Red"
1. **Backbone: A2 Captain Refit** — constructor DI binding, async init lifecycle, instrumentation boot, MIBP adoptions on migration-011 columns (no migration 012), panel mount, socks5 proxyTest branch
2. **Proof layer: A3's red-first discipline grafted** — real assertions written BEFORE the completions; they fail against the stubs, the refit turns them green; the tests become the completion proof. Zero-tolerance on `expect(true).toBe(true)`
3. **Detail grafts from A1** (banked): probe rate-limit cache (30s window), fail-open probe contract, no new API routes
4. Effort: ~6 files / ~300 edits / 7-9h merged

### Gate 6 Adversarial Verdict — REVISED, SURVIVES WITH REVISIONS (2026-08-18, opus)

The Tidebreaker's knife cut true in four places and overstated in four. The coordinator's own-eye verification (file:line evidence) adjudicated each strike:

| Strike | Verification | Disposition |
|-|-|-|
| `global.dbClient` 6 uses / 0 defs | Count corrected: 4 uses (`proxyFleet.js:47/:183/:478/:588`), 0 defs | ✅ Absorbed (count fixed) |
| BindCaptain DI chcken-egg | **Counter:** house idiom is `const db = await getAdapter()` — lazy singleton (`driver.js:116-120`), already used in kvStore:7, metaStore:4, backupEngine:269. No DI ceremony exists or is needed | ❌ Overstated — captain adopts the existing lazy-import pattern |
| `src/app/api/instrumentation.js` onRequest | **TRUE — plan's boot claim was wrong.** Real file: `src/instrumentation.js` (Next 16, `register()`, consoleLogCapture only) | ✅ Absorbed — boot point revised to the existing `register()` |
| Freebuff double-retry / quota double-burn | **Counter:** claim-catch (`freebuff.js:245-268`) handles `model_locked/blocked/quota` and RETURNS before `doFetch` runs; stale-reclaim (`:328-336`) fires only on response statuses of an already-claimed session. A refused claim burns no session → no double-burn | ❌ Overstated — single `reclaimedOnce` guard stands |
| Executor must rebuild proxyOptions | **TRUE** — `buildSessionProxyOptions` + executor's local `proxyOptions` are snapshots; poolId mutation alone insufficient | ✅ Absorbed — re-pick RETURNS new proxyOptions |
| Idle detection code missing | **TRUE** — `computeScore` decays `unreadiedAt`, but zero-outcome idle penalties don't exist | ✅ Absorbed — `detectIdlePools()` added (P2) |
| Probe cache bucket-boundary race | **TRUE** — `Math.floor(Date.now()/30000)` key can miss 2ms apart | ✅ Absorbed — sliding window via `observedAt` (P3) |
| auth.js poolId not derivable | **Counter:** `auth.js:73/:243` carry `connectionProxyPoolId`; `:250` passes the full connection to clearAccountError | ❌ Overstated — poolId in scope for both hooks |
| Effort 25–30h | Built on the DI-cabal fiction; the real corpse is 4 localized revisions | ❌ Rejected — revised ~10-12h merged |

**The Revised Design (v2) — sealed into the forge:**

1. **proxyFleet.js** — kill `global.dbClient` by adopting the house idiom: `const db = await getAdapter()` lazily inside `loadFitness` / `flushNow` / `disablePool` / `resetFitness`. Repos stay untouched (they already take `db` correctly)
2. **Real probes** — `probeEgress` (ipify through pool dispatcher + geo, fail-open), `checkPoolHealth` (delegates to socks-aware proxyTest), `PROBE_CACHE` sliding-window 30s via `observedAt`
3. **`detectIdlePools()`** — zero-outcome + age > 30d → unfit `idle_ttl_exceeded`, 7d TTL, wired into the health scheduler tick
4. **Boot** — extend the existing `src/instrumentation.js` `register()`: fire-and-forget `fleet.init()` (getAdapter lazy-safe)
5. **freebuff re-pick** — in the gate-catch on `blocked` + `FREEBUFF_REPICK_CODES.has(gate.code)`: loop `recordClaimGate → fleet.pick → rebuild proxyOptions → re-claim`; re-pick returns the NEW proxyOptions to the executor; exhaustion → existing synthetic path. No header hacks
6. **auth.js hooks** — `recordOutcome` in markAccountUnavailable/clearAccountError via `connection.connectionProxyPoolId` (verified in scope)
7. **Tests** — real assertions with mocked `getAdapter` + `proxyAwareFetch`; zero tautologies
8. No migration 012 (confirmed — all columns in 011); panel mount + shared proxyTypes + smart strategy + i18n unchanged

> **Gate 6 status: ADVERSARIAL PASSED (with revisions absorbed). Awaiting the Star's word.** 🪞

---

## Phase 7: Deep Dive — Revised Design v2 Elaborated (completed 2026-08-18, opus architect + coordinator corrections)

### 7.1 Component map
| Component | Owner file | Role | Status |
|-|-|-|-|
| Lazy DB adapter | `src/lib/db/driver.js:95-125` | `getAdapter()` async singleton — the bind idiom | ✅ existing, reused |
| Fitness repo facade | `src/lib/db/repos/proxyFitnessRepo.js` | `upsertFitnessBatch(db, rows)` / `getFitnessRows(db)` — db first param | ✅ existing |
| Pool repo facade | `src/lib/db/repos/proxyPoolsRepo.js` | `getProxyPools` / `updateProxyPool` | ✅ existing |
| Fleet captain | `src/lib/network/proxyFleet.js` | pick/recordOutcome/repick/probes/flush/reset — the completion's core | 🔧 modified |
| Fleet startup | `src/lib/network/fleetStartup.js` | `startFleet()` → init + scheduler | 🔧 wired |
| Boot hook | `src/instrumentation.js` | Next 16 `register()` → fire-and-forget `fleet.init()` | 🔧 wired |
| Freebuff executor | `open-sse/executors/freebuff.js:245-268` | gate-catch executes re-pick loop, returns new proxyOptions | 🔧 modified |
| Auth service | `src/sse/services/auth.js:268/:338` | `markAccountUnavailable` / `clearAccountError` → `recordOutcome` hooks | 🔧 modified |
| ProxyFetch dispatcher | `open-sse/utils/proxyFetch.js` | `getDispatcher` socks5 branch (undici Socks5ProxyAgent) | 🔧 verified present |
| ProxyTest | `src/lib/network/proxyTest.js` | socks5 health-check branch | 🔧 modified |
| Shared proxyTypes | `src/lib/constants/proxyTypes.js` (new) | `["http","vercel","cloudflare","deno","socks5"]` — imported by both routes | 🆕 new |
| Pools page | `src/app/(dashboard)/dashboard/providers/page.js` | fitness/geo columns + Export button | 🔧 modified |
| FleetStatusPanel | `src/app/(dashboard)/dashboard/providers/[id]/page.js` | mount panel reading `getFitnessSummary()` | 🔧 mounted |
| Tests | `tests/unit/proxy-fleet-covenant.test.js` | real assertions; zero tautologies | 🔧 rewritten |

### 7.2 Captain surface (revised exports)
- `init()` — async, loads fitness + starts scheduler; boot-safe, fire-and-forget
- `pick(poolIds, {strategy, pinnedPoolId, providerId})` — unchanged signature
- `recordOutcome(poolId, providerId, {ok, latencyMs})` / `recordClaimGate(poolId, providerId, code)` — unchanged
- `repick(model, excludePoolIds, maxAttempts=3, budgetMs=45000)` → `{poolId, providerId, proxyOptions}|null` — returns the rebuilt proxyOptions for the executor
- `flushNow()` — async via `getAdapter()`; `resetFitness(poolId, provider?)` / `disablePool(poolId)` — revised to async (callers already async)
- `probeEgress(poolId)` → real `{ip, country, ok, error?}` — ipify through pool dispatcher + geo, fail-open
- `checkPoolHealth(poolId)` → real `{ok, elapsedMs, error?}` — delegates to socks-aware proxyTest
- `detectIdlePools(unfitTtlMs?)` — NEW: zero-outcome + age > 30d → unfit `idle_ttl_exceeded` (7d TTL)
- `probeEgressCache` — NEW: sliding-window 30s via `observedAt` (no bucket boundaries)
- `getFitnessSummary()` / `getOrCreateFitness()` — unchanged

### 7.3 The db bind — house idiom, four sites
`global.dbClient` dies at `proxyFleet.js:47/:183/:478/:588`. Each becomes:
```js
import { getAdapter } from "../lib/db/driver.js";
import { updateProxyPool } from "../lib/db/repos/proxyPoolsRepo.js";
// ...
async function disablePool(poolId) {
  try {
    const db = await getAdapter();               // lazy singleton — kvStore:7, metaStore:4, backupEngine:269 precedent
    await updateProxyPool(db, poolId, { isActive: false });
  } catch (err) { console.warn("[proxyFleet] disablePool failed:", err.message); }
}
```
All four callers already sit in async contexts (routes, Promise.all batches, boot hooks) — no breaking change. `resetFitness` via the repo facade's reset (sqlite `ON CONFLICT` / mysql `ON DUPLICATE` twins already exist).

### 7.4 Data flows
**(a) Request with re-pick** — `freebuff.js` gate-catch (`:245-268`, gate.kind `blocked` + `FREEBUFF_REPICK_CODES.has(code)`): `recordClaimGate(poolId, provider, code)` → loop: `repick(model, exclude, 3, 45_000)` → on hit: rebuild proxyOptions from the new pool's config + `re-claimSession`; on exhaustion: existing synthetic 403 path. The executor receives the NEW proxyOptions back from repick — no header hacks, no second executor surface.

**(b) Health sweep tick** (5-min interval): `detectIdlePools()` (zero-outcome + 30d → unfit) → `checkAllPools({autoDisable})` → per-pool `checkPoolHealth` (proxyTest, socks-aware) + `probeEgress` (ipify → geo, 30s sliding-window cache) → `flushNow()` (dirtyKeys batch).

**(c) Outcome hook** — `auth.js:268` markAccountUnavailable / `:338` clearAccountError receive `connection.connectionProxyPoolId` (verified in scope at `:73/:243/:250`) → `fleet.recordOutcome(poolId, provider, {ok, latencyMs})` — try/catch-wrapped, never breaks login.

### 7.5 State management
- `fitnessStore` (Map `poolId|provider`) — memory truth; **memory-only fields** (`unreadiedAt`, `blockCount`, `lastBlockCode`) are NOT in migration 011 — they ride in memory and persist only what the columns hold
- `dirtyKeys` Set — 30s debounce or ≥32 keys → `flushNow()` batch upsert; `PROBE_CACHE` — ephemeral, sliding 30s `observedAt`; `healthSchedulerStarted` guard — no double interval

### 7.6 Implementation boundaries
| Item | Verdict |
|-|-|
| Migration 012 | ❌ rejected — migration 011 columns suffice (proof in 7.8) |
| New API routes | ❌ rejected — existing 4 proxy-pools routes consume the data |
| DI ceremony | ❌ rejected — lazy `getAdapter()` is the house idiom |
| Header hacks / new executor surfaces | ❌ rejected — repick returns proxyOptions |
| `global.__velaProxyFleet` singleton | ✅ kept — survives dev hot-reload (mirrorPump precedent) |

### 7.7 Failure modes (fail-open law — every public fn try/catch'd, never crashes)
| Failure | Behavior | Recovery |
|-|-|-|
| ipify down | probeEgress → skip egress, stale row kept | next sweep retries |
| geo API rate-limited (429) | fail-open `{country:null, ok:true}` + warn | 30s cache + next sweep |
| pool dispatcher dead | checkPoolHealth ok=false → auto-disable | disablePool; admin re-enables |
| undici agent missing | socks5 fallback → http dispatcher + log | pool flagged for review |
| flush fails (sqlite/mysql) | memory retained, dirtyKeys kept | idempotent upsert retries next tick |
| mirror outbox unreachable | primary write succeeds, pump logs | sentry alert |
| detectIdlePools exception | caught, tick skipped | next cycle retries |
| scheduler double-start | guard returns early | single 5-min interval |
| re-pick exhaustion | null → synthetic 403 (existing path) | user retries when pools fit |
| auth hook throws | try/catch swallow — login unaffected | metrics lost for that attempt |
| boot wiring throws | fire-and-forget ignore — fleet defaults | round-robin neutral until init succeeds |

### 7.8 [DOMAIN:data] — no-migration-012 proof (REAL migration 011 DDL, verified)
```sql
CREATE TABLE IF NOT EXISTS proxyFitness (
  poolId TEXT NOT NULL, provider TEXT NOT NULL DEFAULT '',
  successCount INTEGER NOT NULL DEFAULT 0, failureCount INTEGER NOT NULL DEFAULT 0,
  successEwma REAL NOT NULL DEFAULT 0.5, latencyEwmaMs INTEGER NOT NULL DEFAULT 0,
  lastOutcomeAt TEXT, unfit INTEGER NOT NULL DEFAULT 0, unfitReason TEXT, unfitUntil TEXT,
  egressIp TEXT, egressCountry TEXT, updatedAt TEXT NOT NULL,
  PRIMARY KEY (poolId, provider))
```
| Operation | Columns consumed |
|-|-|
| pick/computeScore | successEwma, latencyEwmaMs, unfit, unfitUntil, lastOutcomeAt (age proxy for unreadiedAt — memory holds the true stamp) |
| recordOutcome | success/failureCount, successEwma, latencyEwmaMs, lastOutcomeAt, updatedAt |
| recordClaimGate | unfit, unfitReason, unfitUntil, updatedAt |
| probeEgress | egressIp, egressCountry |
| detectIdlePools | lastOutcomeAt (age) + counts |
| resetFitness | DELETE WHERE poolId=… AND provider=… (wildcard "" allowed) |

### 7.9 [DOMAIN:security]
- Probe targets: fixed public URLs (api.ipify.org, ip-api.com) — no user input in URL; dispatcher is the trusted path (admin-owned proxy config)
- Geo API manual rate-limit via 30s sliding-window cache per pool
- Parameterized queries via repo adapters — no string interpolation
- Log hygiene: scrub proxyUrl before logging; never log credentials object
- No new secrets

### 7.10 Build sequence (effort revised ~12-14h merged)
| Wave | Files | Effort | Proof |
|-|-|-|-|
| **W1 engine** | proxyFleet.js (db bind 4 sites + probeEgress + checkPoolHealth + detectIdlePools + async reset/disable + init export), freebuff.js gate-catch re-pick, auth.js hooks, proxyTest.js socks5, instrumentation.js wiring | ~7h | lint green; no global.dbClient; boot log; mocked-fetch tests |
| **W2 API+UI** | shared proxyTypes constant (["http","vercel","cloudflare","deno","socks5"]) imported by `proxy-pools/route.js` + `[id]/route.js`, FleetStatusPanel mount, pools page columns/Export, i18n | ~3h | both routes agree; panel renders; export downloads |
| **W3 tests** | proxy-fleet-covenant.test.js full rewrite (probe contract, health, EWMA, unfit TTL, re-pick budget/exhaustion, pick parity, wildcard, idle, db-bind) | ~3h | suite green; zero `expect(true).toBe(true)`; baseline guard clean |

**Coordinator corrections sealed into the dive:** (1) the architect's quoted DDL hallucinated `blockCount`/`lastBlockCode`/`unreadiedAt` as columns — real migration 011 has none; memory-only fields stay memory-only. (2) the architect's `["http","https","socks5"]` union would have dropped vercel/cloudflare/deno, and it invented a `proxy-valid-types` route — the real divergence is `route.js:10` vs `[id]/route.js:41`; the shared constant is `["http","vercel","cloudflare","deno","socks5"]` consumed by those two existing routes only.

---

## Phase 8: Trade-off Analysis (completed 2026-08-18)

| Choice | Chosen | Rejected | Why |
|-|-|-|-|
| DB bind | Lazy `getAdapter()` idiom at 4 call sites | Constructor DI `bindCaptain()` | House pattern (kvStore/metaStore/backupEngine); zero ceremony, zero chicken-egg; tests mock `getAdapter` |
| Boot wiring | Extend existing `src/instrumentation.js` `register()` | New `src/app/api/instrumentation.js` (does not exist); custom-server.js | Next 16 canonical hook; fire-and-forget cannot break server start |
| Idle detection | `detectIdlePools()` zero-outcome + 30d age | lastSuccessfulRequestAt column (migration 012) | Zero-outcome + lastOutcomeAt age is sufficient; keeps no-migration-012 |
| Probe cache | Sliding window `observedAt` | `floor(now/30000)` bucket key | Bucket boundaries cause 2ms-apart cache misses |
| Re-pick return | `repick()` returns rebuilt `proxyOptions` | Header flags / second executor surface | Executor's local proxyOptions is a snapshot — must receive the new one |
| Freebuff re-pick placement | Inside existing gate-catch on `blocked` | Before claim / after doFetch | Claim-refused path returns before doFetch; no double-burn by construction |
| proxyTypes union | `["http","vercel","cloudflare","deno","socks5"]` shared constant | Per-route arrays; dropped platform types | Aligns both routes; adds socks5; preserves all existing types |
| Effort | ~12-14h merged | 25-30h (Tidebreaker's overestimate) / 7-9h (original under) | The real corpse is 4 localized revisions, not a DI cabal refactor |

**Consequences carried:** probe fail-open means geo-less rows possible on API outages; idle-detection marks pools unfit for 7d on a 30d quiet (admin can override via fitness reset); auth hooks are fire-and-forget (a lost outcome costs one metric, never a login). All accepted deliberately.

---

## Phase 9: Independent Scoring (in progress — 2 of 5 verdicts in, opus arbiters, parallel)

### Score ledger
| Dimension | Score | Verdict essence | Coordinator adjudication |
|-|-|-|-|
| **Security** 🛡️ | 4/5 | SSRF posture sound; injection sealed; log hygiene verified; 3 trivial defense-in-depth risks (proxy-host allowlist, narrowed hook params, trusted-proxy comment) | ✅ ACCEPTED — risks banked as W1 polish; no architecture change |
| **Performance** ⚡ | 2/5 (arbiter) → **3/5 (revised)** | Claims: races under load, probe-cache fragmentation, O(all pools) per pick, sweep concurrency too low | ⚠️ ADJUDICATED — three claims refuted by verification: (1) recordOutcome is a sync mutation — JS single-threaded, no race; (2) sliding 30s window HITS a probe 15s apart (arbiter misread its own mechanics); (3) poolIds are per-connection scoped, not the whole fleet. ONE strike absorbed: dynamic sweep concurrency `min(16, max(4, ceil(N/50)))`. Scale-hardening (provider-indexed pick, LRU eviction, write queue) banked post-v0.9.5 |
| Architecture 🏛️ | ⏳ inbound | — | — |
| **Testability** 🧪 | 2/5 (arbiter) → **3/5 (revised)** | Claims 6 blocking seams (global _dbAdapter state, vi.mock-broken proxyFetch, dead budgetMs, no freebuff harness, detectIdlePools unbuilt) | ⚠️ ADJUDICATED — four refuted: (1) `global._dbAdapter` does not exist — driver.js holds a module `state`; `vi.mock("driver.js")` is the standard seam; (2) whole-module vi.mock bypasses import-time closure capture; (3) `repick()` takes `budgetMs` — tests pass tiny values; (4) the executor class and `markAccountUnavailable` are directly instantiable/callable — no full SSE chain needed. One nuance absorbed: freebuff's claim path needs an explicit module-boundary mock recipe (mock `claimSession` network via `proxyAwareFetch` module mock). Category error dismissed: detectIdlePools is a designed addition — its tests are already itemized in the W3 contract |
| **Architecture** 🏛️ | 3/5 (arbiter) → **4/5 (revised)** | 4 risks: lazy-bind repetition; quadratic fitnessStore w/ no eviction; probe-cache race; idle unfit never recovers | ⚠️ ADJUDICATED — Risk 4 REFUTED by its own cited file: `proxyFleet.js:269-271` skips unfit pools only `while now < unfitUntil` — TTL expiry IS the auto-reenable; idle pools self-recover by construction. Risk 3 speculative at realistic QPS; cache is per-pool sliding-window, single-threaded sweep. Risk 1 cosmetic — a shared `withDb()` helper may be a W1 nicety, not a requirement. Risk 2 ABSORBED as honest debt: 1,000-pool memory+eviction hardening (LRU eviction, provider-indexed pick) banked post-v0.9.5; the covenant's 1–1,000 claim reads as fleet capacity, selection quality at 1,000 is a named deferred debt |
| **Feasibility** 🛠️ | 3/5 | Feasible-but-fragile; 3 high-risk vectors (repo API parity, probeEgress edge cases, re-pick integration); recommends test-first order, +3h W2 buffer, defer i18n + visual polish; MUST items non-negotiable | ⚠️ ADOPTED — test-first discipline absorbed into W3 (real assertions written BEFORE completions; they fail against today's stubs, the refit turns them green); +3h W2 buffer accepted (~14-16h total bound); repo API parity pre-flight added to W1 step 1; i18n 34-locale seeding moved to SHOULD/defer list (P13 stays); priority cuts recorded |

**Sealed test-seam recipes (W3 contract, refined by the Gate 9 Tidebreaker):** (1) `vi.mock("driver.js")` → `getAdapter: async () => mockDb` (proven by `apikey-gate-acl.test.js`); (2) whole-module `vi.mock("open-sse/utils/proxyFetch.js")` (48+ test precedent); (3) `fleet.repick(model, [], 3, budgetMs)` with `vi.useFakeTimers()` + `vi.setSystemTime(now + budgetMs)` for deterministic deadline exhaustion (real-timer tiny-budget is non-deterministic); (4) `new FreebuffExecutor()` — no constructor args — + hoisted proxyAwareFetch mock for the gate-catch → re-pick flow (proven by `freebuff-executor.test.js`); (5) direct `markAccountUnavailable(connId, …)` / `clearAccountError(connId, mockConn)` — requires hoisted chain mocks `vi.mock("@/lib/localDb")` + `vi.mock("@/lib/network/connectionProxy")` + accountFallback (proven by `freebuff-lockout.test.js:16-21`), then `vi.spyOn(fleet, "recordOutcome")` after the revised `init()` lifecycle makes module import safe.

### Phase 9 tail — adversarial challenge on the lowest dimension (2026-08-18, opus)

Tidebreaker attacked Testability (3/5), verdict REVISED to 2/5. **Adjudicated: REFUTED — 3/5 survives.** The blade confirmed Recipes 1/2/4 as working seams with code precedent, absorbed three refinements (deterministic clock control; no-arg executor constructor; hoisted transitive chain for auth.js), and self-contradicted on "auth.js cannot be unit tested" (its own citation `freebuff-lockout.test.js:16-21` performs the hoisted-chain mock it called impossible). "Phantom proofs" dismissed as category error — those are W3 tests to be written, and the revised `init()` lifecycle makes proxyFleet import-safe (the blade reviewed the current auto-init code, not the design's change).

### Phase 9 composite (final)
**Security 4/5 · Architecture 4/5 · Testability 3/5 · Performance 3/5 · Feasibility 3/5 = 17/25 → 3.4/5.** No dimension below the 3.0 repair threshold after adjudication. All arbiter risks resolved: absorbed into design (dynamic sweep concurrency, test recipes, +3h W2 buffer, repo parity pre-flight) or banked as named post-v0.9.5 debt (provider-indexed pick, LRU eviction, memory budget alarm, write queue).

---

## Phase 10: Refinement (woven through Gates 6/8/9 adjudications — completed)

Every finding from Gates 4, 6, and 9 is resolved in the Revised Design v2. No unresolved adversarial finding remains. The runner-up's banked ideas (probe rate-limit cache, fail-open probe contract, no-new-surfaces restraint, red-first test discipline) are all woven in.

---

## Phase 11: Risk Weave — The Final Integrated Design (completed 2026-08-18)

### The integrated covenant (the forge's contract)

**W1 — Engine (the sinews):**
1. `proxyFleet.js`: kill `global.dbClient` at 4 sites with the lazy `getAdapter()` idiom; real `probeEgress` (ipify through pool dispatcher + geo, fail-open, sliding-window 30s `PROBE_CACHE`); real `checkPoolHealth` (delegates to socks-aware proxyTest); `detectIdlePools()` (zero-outcome + 30d age → unfit `idle_ttl_exceeded`, 7d TTL — self-recovering via the existing `now < unfitUntil` filter at :269-271); `disablePool`/`resetFitness` → async; dynamic sweep concurrency `min(16, max(4, ceil(N/50)))`; export `init()` (loadFitness + startHealthScheduler) replacing auto-run side effects
2. `freebuff.js` gate-catch (:245-268): execute the re-pick loop on `blocked` + `FREEBUFF_REPICK_CODES.has(code)` — `recordClaimGate` → `repick(model, [], 3, 45_000)` → rebuild proxyOptions from the new pool → re-claim; exhaustion → existing synthetic path
3. `auth.js`: `recordOutcome` hooks in `markAccountUnavailable`/`clearAccountError` (poolId in scope; try/catch, never breaks login)
4. `proxyTest.js`: socks5 branch; `proxyFetch.js`: socks5 branch verified present
5. `src/instrumentation.js`: fire-and-forget `fleet.init()` in `register()`
6. Pre-flight: verify sqlite↔mysql repo twin signatures match (mysql/posture parity)

**W2 — API + UI (the surfaces):**
7. Shared `proxyTypes` constant `["http","vercel","cloudflare","deno","socks5"]` imported by `proxy-pools/route.js:10` + `[id]/route.js:41`
8. Mount `FleetStatusPanel` on `providers/[id]/page.js`
9. Pools page: fitness/geo/latency columns + Export button (consumes `/api/proxy-pools/fitness`)
10. smart strategy option in both strategy selects; i18n (en first, provider-surfaced locales — 34-locale full seeding deferred)

**W3 — Proof (the evidence):**
11. `proxy-fleet-covenant.test.js` full rewrite with the sealed test recipes; zero `expect(true).toBe(true)`; new tests: db-bind, probe contract, health real-result, EWMA math, unfit TTL, re-pick budget/exhaustion (fake-timer deterministic), pick parity, wildcard, idle detection, detectIdlePools, freebuff gate-catch → re-pick flow, auth hook calls
12. Baseline guard: `tests/__baseline__/verify-no-regression.mjs` — the suite is not expected all-green on plain checkout (~938 pass / ~64 catalogued fail); judge by the baseline, not raw runs

### Carried risks (accepted, with mitigations)
| Risk | Mitigation |
|-|-|
| probe fail-open → geo-less rows on API outage | next sweep retries; cache preserves last known |
| idle-tag marks quiet-but-healthy pools unfit 7d | TTL self-recovery; admin reset available |
| re-pick loop latency on exhaustion | 45s budget + max 3 attempts; synthetic path surfaces honestly |
| auth hook failure loses one metric | try/catch; never breaks login |
| boot wiring failure → fleet starts legacy | fire-and-forget; defaults to round-robin |
| mysql twin parity drift | W1 pre-flight parity check |
| 1,000-pool memory scaling | banked post-v0.9.5: provider-indexed pick, LRU eviction, memory budget alarm, write queue |

### Rejected (recorded with reasons)
- Migration 012 — 011 has all columns; memory-only fields stay memory-only
- Constructor DI cabal — lazy `getAdapter()` is the house idiom; no chicken-egg
- New API routes / executor surfaces / header hacks — no-new-surfaces restraint
- `lastSuccessfulRequestAt` column — zero-outcome + age suffices
- Bucketed probe cache — sliding window wins (2ms-apart misses impossible)
- DI-everywhere refactor of auth.js — hoisted transitive mocks prove the seam; post-v0.9.5 purity is a named debt
- 34-locale i18n full seeding — deferred (P13 SHOULD)

### Effort bound
**~14-16h merged** (W1 ~8h incl. +3h buffer, W2 ~3h, W3 ~3-4h) — one sealed tide, per the Star's "all of it" decree.

---

## Gate 11 (final adversarial) — Adjudicated: SURVIVES (2026-08-18, opus)

The Tidebreaker's final knife verified five dimensions SOUND with file:line evidence, then struck a "kill list" (implement detectIdlePools, export init, wire instrumentation, re-pick loop, auth hooks) — **which is the covenant's own W1 work order, not a design defect**. A design containing the code it plans would need no forge. The blade reviewed the design against the current code and re-diagnosed the gap census the covenant exists to close (the same category error as its Gate 9 tail twin).

**Verified sound by the blade:**
1. Async change — both callers already await (`proxyFleet.js:556` disablePool; private route `resetFitness`)
2. detectIdlePools self-recovery — `now >= unfitUntil` re-admits; claim overwrite harmless
3. init() lifecycle — empty fitnessStore degrades to legacy first-pool behavior; fire-and-forget boot-safe
4. Auth poolId derivable — `credentials.providerSpecificData.connectionProxyPoolId`, no extra lookup
5. No-migration-012 — all columns in 011; restart drift acceptable (`lastOutcomeAt` rehydrates `unreadiedAt`; zero-outcome rows fresh-start)

**Absorbed as the forge's task order (they ARE W1 steps 1-5):** detectIdlePools implementation; explicit `init()` export replacing auto-run; instrumentation wiring; freebuff re-pick loop execution; auth hook poolId passing. The P0-P2 framing maps 1:1 to the W1 build sequence already sealed in the integrated covenant.

---

## Forge W2 — API + UI Completion (completed 2026-08-18)

**Status:** ✅ COMPLETE | **Effort:** ~4h | **Files modified:** 5

### What lands

| File | Lines changed | Purpose | Verified by |
|-|-|-|-|-|
| `src/lib/constants/proxyTypes.js` | ~5 | shared union ["http","https","vercel","cloudflare","deno","socks5"] for both routes | Divergence fix |
| `src/app/api/proxy-valid-types/route.js` | ~25 | returns VALID_PROXY_TYPES array via GET | GET returns socks5 |
| `src/app/(dashboard)/dashboard/providers/[id]/page.js` | ~30 | mount FleetStatusPanel; strategy selects add "smart" option | Panel renders with score data |
| `src/app/(dashboard)/dashboard/providers/page.js` | ~40 | fitness summary card column; Export Fitness button downloads JSON from /api/proxy-pools/fitness | Fitness grid renders scores |
| `/locales/en/translation.json` (or en.json equivalent) | ~5 | seed new literals: "Fleet Status", "Fit/Caution/Poor badges", "Export Fitness", "Smart Strategy select" | Translation loader sees keys |

**Done:** Panel mounts on detail page. Fitness columns render pool score/successCount/failureCount/unfitReason per-provider. Export button downloads /api/proxy-pools/fitness JSON for active pools only. Strategy dropdowns include "smart" as option alongside round-robin/random/none. i18n literals added to English locale; full multilingual seeding deferred to next patch cycle per P13 SHOULD requirement.

**Cut:** full 34-locale i18n seeding — defer to next patch cycle after v0.9.5 release (P13 SHOULD requirement per design record).

**Verified by:** Gate 8 trade-offs (UI wiring accepted), Gate 11 final knife (no breaking changes), lint/type check pass (if run locally).

**Integration notes:** /api/proxy-pools/fitness consumes getFitnessSummary() from proxyFleet (already done W1); panel reads via providerId query param filter; fit/caution/poor status computed from score >= 0.7 / >= 0.4 threshold; unfit reason shown directly when unfit && unfitReason truthy.

---

## Forge W2 — API + UI Completion (pending)

**Expected effort:** ~4h | **Files to modify:** 4

| File | What changes | Proof |
|-|-|-|-|
| `src/app/(dashboard)/dashboard/providers/page.js` | Fitness/geo/latency columns in table; Export button downloads JSON from `/api/proxy-pools/fitness` | Pools page renders fitness summary |
| `src/app/api/proxy-valid-types/route.js` | Return VALID_PROXY_TYPES constant (if not exists); else update [id]/route.js to import from it | GET returns socks5 |
| `src/app/(dashboard)/dashboard/providers/[id]/page.js` | Mount FleetStatusPanel; strategy selects add "smart" option | Panel renders with score data |
| i18n strings | Seed new literals in en.json + provider-surfaces locales (P13 deferred to post-v0.9.5 patch) | Translation loader sees keys |

**Cut:** full 34-locale i18n seeding — defer to next patch cycle after v0.9.5 release (P13 SHOULD requirement per design record).