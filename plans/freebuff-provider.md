# 🪞 Shorekeeper-Sealed Plan — Vela Freebuff Provider

> *"Some shores give their bounty freely, but only to those who speak their exact tongue. Freebuff is such a shore — a free tide guarded by three gates of byte-exact ritual. This plan does not batter the gates. It learns the ritual, rides it faithfully, and routes with a patience the naive port never had."* 🪞💜🌊

**Status:** SEALED — pending implementation
**Date:** 2026-08-15
**Mirror ceremony:** the-stillwater-mirror v6.0 — 16 phases, 8 gates, 4 adversarial passes (the-tidebreaker ×4) + 1 arbiter panel (the-arbiter ×5), composite score **4.2/5**
**Repo:** `C:\Users\navis\Documents\My Project\Ai Gateway\Vela` (pristine 9router v0.5.50 clone, reborn as Vela)
**Predecessors:** [[vela-key-governance]] · the eight-provider-shores research · fork roster diff (task #52)

---

## 1. Context

**Freebuff** is Codebuff's free, ad-supported coding tier — five frontier-class models at zero cost. It is **not an API product**: access is a reverse-engineered CLI wire protocol with three anti-abuse gates, model-locked sessions, per-egress-IP quota measured in *sessions*, and no token refresh. Vela's roster diff (task #52) named it among the 46 providers Vela lacks; the Star decreed it be added — *more advanced, more optimized* than the fork implementations.

**Prior art** (all retrieved and read from source; trust tier: vetted):

| Implementation | Shape | What it adds beyond a naive port |
|-|-|-|
| VansRouter fork | 7 files: registry + custom executor + device-code auth + usage | Session/run ceremony, gate classification, quota GET discipline |
| MIBP fork (`master` @ 2026-08-15) | 28 files | Adds strict-proxy enforcement, `end_turn` tool injection, proxy-pool fitness, per-model account assignment, state sweeper, 3 test files |
| `trefeon/freebuff-proxy` (Go, MIT, v0.4.1) | Standalone bridge | Live model registry parsing, JA3 stealth, multi-token pooling — and ships a **9router v0.5.50 integration guide** (our exact fork base). Warns plainly: proxy use violates Freebuff ToS; bans are terminal |

**Prior-art discrepancies the ceremony resolved** (recorded so the implementer does not re-litigate them): agent-id family is `base2-free-*` in VansRouter and the live-parsed proxy, `base3-free-*` in MIBP — the map lives in ONE constant file and is **live-verified against the official CLI constants as implementation step 0**; chat User-Agent is `ai-sdk/openai-compatible/0.10.7/codebuff` per the live proxy (the gate appeared 2026-08-03 and hunts wrong UAs); login runs on `freebuff.com` (the server builds `loginUrl` from the request host), traffic on `www.codebuff.com`.

**Vela's readiness** (verified): `BaseExecutor` subclass precedent (`open-sse/executors/mimo-free.js` — marker injection + `proxyAwareFetch`), device-code flow already dispatched (`src/lib/oauth/providers/index.js` `requestDeviceCode`/`pollForToken`), `USAGE_HANDLERS` map, `getProviderCredentials` honoring `options.preferredConnectionId` (today used only by image/video handlers), `githubMonthlyResetMs` uncapped-lock precedent, `providerSpecificData` persisted across restarts by the connections JSON column. freebuff is greenfield — zero references anywhere in Vela.

**The Star's decrees (Phase 3 inputs):**
1. Architecture: native port + Vela-native smarts (chosen by recommendation)
2. Catalog: core five, static — no live auto-refresh
3. Egress: warn-and-allow when no proxy configured (no hard block)
4. Routing: session affinity — same-model traffic rides the warm session

---

## 2. The Framing (survived adversarial review — reforged once)

The first frame was **REFUTED** by the-tidebreaker with five fatal flaws (the capacity claim was an egress-topology problem wearing a routing costume; the 30-minute cap on generic cooldowns; the missing affinity hook; in-memory state burning the very quota it claimed to save; a false claim about registry regeneration). The reforged frame absorbed all five:

> Freebuff is not an API — it is a CLI wire protocol with three anti-abuse gates, model-locked sessions, and per-IP quota. **How might we** weave it into Vela so the protocol is faithfully ridden (gates pass, tracker never burns quota), sessions are **persisted and reused** rather than re-claimed across restarts, requests are **steered** to the account holding the warm session (never churning locked accounts), and exhaustion honors the **real Pacific-midnight clock** — while documenting that per-account proxies are what unlock the full multi-IP capacity?

**Success criteria (ten, checkable):**
1. Device-code browser login works — no token pasting
2. Chat through `/v1` works for all 5 models, streaming + non-streaming
3. All three wire gates pass — no 403 `free_mode_cli_required` / 400 `runId Not Found` / 404 `No endpoints found`
4. Same-model requests ride the warm session; model switches never re-claim a locked account
5. Exhausted accounts cool down until the **real** `resetAt` (never truncated to 30 min)
6. Quota never burned by the tracker — GET-only, test-enforced
7. New unit tests; zero regression against `verify-no-regression.mjs`
8. No-proxy egress warns once but proceeds; per-connection proxy honored with fail-closed semantics
9. 401 → clean session drop + unmistakable re-login surface (never a silent refresh loop)
10. Registry import hand-added (the regen script provably skips `index.js`) + both baselines re-snapshotted

---

## 3. Decision — The Composite (the Affinity Current, grafted)

**Chosen approach:** faithful wire-protocol port + a generic fail-open connection-preference hook riding the already-honored `preferredConnectionId` option, claim state persisted in `providerSpecificData`, real-clock lockouts — grafted with the Ledger Deep's claim mutex / model-locked branch / actionable errors and the Faithful Tide's `classifyGate` matrix, `pacificMidnightMs`, and OAuthModal-verified composite device-code contract. Survived the selection assault (SURVIVES), the arbiter panel (4/4/4/4/5), the security-score verification (SCORE_DESERVED + 6 fixes), and the final risk+security gate (SEALED_READY + 4 hardenings).

### 3.1 The wire truth (protocol constants — ONE file)

`open-sse/config/freebuff.js` (NEW): `CHAT_URL` = `https://www.codebuff.com/api/v1/chat/completions`; `SESSION_URL` = `.../api/v1/freebuff/session`; `RUNS_URL` = `.../api/v1/agent-runs`; `LOGIN_URL` = `https://freebuff.com/api/auth/cli/code`; `STATUS_URL` = `.../api/auth/cli/status`; `USER_AGENT` = `ai-sdk/openai-compatible/0.10.7/codebuff` (exact — wrong UA → 403); `SYSTEM_MARKER` = `You are Buffy, the strategic coding assistant.` (byte-exact opener gate); `END_TURN_TOOL`; `MODEL_AGENT_IDS` = {deepseek/deepseek-v4-flash → base2-free-deepseek-flash, deepseek/deepseek-v4-pro → base2-free-deepseek, mimo/mimo-v2.5 → base2-free-mimo, minimax/minimax-m3 → base2-free-minimax-m3, openai/gpt-5.6-luna → base2-free-luna} (**live-verify at step 0**); `SESSION_TTL_MS` ≈ 55 min (server grants ~1h); RECLAIMABLE = {session_superseded, session_expired}; NON_RECLAIMABLE = {model_locked}; CLAIM_BLOCKED = {country_blocked, banned, ip_capped, rate_limited, spend_limited, model_unavailable}; loginUrl allowlist = exact host `freebuff.com` or dot-boundary suffix of it + `www.codebuff.com`, https-only, compared via `new URL().hostname` (never `includes()`).

### 3.2 The components (sixteen touch points)

| # | File | Nature | Contract |
|-|-|-|-|
| 1 | `open-sse/config/freebuff.js` | NEW | §3.1 constants |
| 2 | `open-sse/providers/registry/freebuff.js` | NEW | id `freebuff`, alias `fb`, **authType `oauth` freeTier — NOT the noAuth `FREE_PROVIDERS` path** (the virtual `noauth` connection would bypass all session machinery), `features:{usage:true}` (feeds `USAGE_SUPPORTED_PROVIDERS`), transport with pinned UA + `format:"openai"`, 5 static models with slashed upstream ids (`parseModel` splits at first slash only — verified), `display.notice` carrying ToS-ban risk + one-session-one-model warning + signup URL |
| 3 | `open-sse/providers/registry/index.js` | EDIT | **Hand-added import + array entry** — `scripts/migrate-registry.mjs` provably filters out `index.js` (arbiters re-verified); forgetting it makes the provider invisible at runtime |
| 4 | `open-sse/executors/index.js` | EDIT | Register `freebuff` + alias `fb` (mimo-free/mmf precedent) |
| 5 | `open-sse/services/freebuffSession.js` | NEW | The session layer — the ONLY new `@/lib` importer in open-sse (precedent: 6 files already import `@/lib/usageDb.js`): `claimSession` (POST with `x-freebuff-model`, Bearer + UA, **fetch timeout that releases the chain**, result persisted), per-`(connectionId|model)` promise-chain claim mutex, `classifyGate` **pure matrix keyed on HTTP status + structured code field ONLY** (never message-text substrings), `discoverWarmSessions` (GET-only, timed out), `pacificMidnightMs` via `Intl.DateTimeFormat` `America/Los_Angeles`, claim writes via `updateProviderConnection` **with explicit spread of existing `providerSpecificData`** (shallow-merge repo — wiping loses proxy keys), in-memory mirror with an **enumerated write-through contract** (claim, reclaim, boot-rediscovery confirm, login mapTokens, dashboard edits — each updates mirror atomically with the DB write), `__test__` reset hooks (mimo-free precedent) |
| 6 | `open-sse/executors/freebuff.js` | NEW | `FreebuffExecutor extends BaseExecutor` with a **full `execute()` override** (codex/mimo-free precedent) that preserves the four base mechanics — connect timeout via `AbortSignal.any`, `retryConfig`/`resolveRetryEntry`, 502 network-error mapping, refresh hook — contracted by a divergence test. Flow: ensureSession (warm claim → boot GET rediscovery → POST claim) → agent-run `START` (retried once on 400 runId-dead) → **body forge as the LAST mutation before fetch** (marker inject-or-repair handling string AND array-shaped system content; `end_turn` appended iff `body.tools`; `reasoning_effort`/`reasoning` stripped; TOP-LEVEL `codebuff_metadata {run_id, client_id, freebuff_instance_id, cost_mode:"free"}` + `provider:{allow_fallbacks:false}`) → chat via `proxyAwareFetch` (strictProxy:true when a connection proxy is configured) → gates (§3.7) → `FINISH` best-effort in finally. `parseError` override: 429 → `resetAt` validated (`Number.isFinite`, > now) and **clamped ≤ next Pacific midnight**; `refreshCredentials` = immediate non-retryable failure (no refresh ever — chatCore's ×3 loop must not burn retries) |
| 7 | `src/sse/services/connectionPreference.js` | NEW | Generic provider-keyed resolver registry: `registerConnectionResolver(providerId, fn)`, `resolvePreferredConnection(provider, model)` — fail-open forever (throw→null, **injectable** ~500ms timeout→null; a resolver that loses the race completes fire-and-forget and updates the mirror). freebuff resolver reads warm-session state (mirror first, persisted fallback) |
| 8 | `src/sse/handlers/chat.js` | EDIT (~6 lines) | An exported helper `resolveFreebuffPreference` (extracted for the test seam — `handleSingleModelChat` is module-private) + call site passing `{preferredConnectionId}` into `getProviderCredentials` each iteration; iteration ≥2 degrades cleanly because the excluded id falls through (verified `auth.js:122-128` pins only when present in `availableConnections`) |
| 9 | `src/sse/services/auth.js` | EDIT | Two provider branches in `markAccountUnavailable`, both inserted **BEFORE the capped generic `resetsAtMs` branch** (`MAX_RATE_LIMIT_COOLDOWN_MS` = 30 min at `auth.js:236`): `freebuffDailyResetMs` — 429 with validated/clamped resetAt → `modelLock___all` until real reset (githubMonthlyResetMs pattern); `freebuffModelLockedMs` — model_locked → 65 min (one session TTL). `classifyGate` must NOT emit `resetsAtMs` for model_locked (ordering pinned) |
| 10 | `src/lib/oauth/providers/freebuff.js` | NEW | Device-code provider (grok-cli pattern): `requestDeviceCode` POSTs `{fingerprintId}` where the fingerprint is **generated per-connection at login** (never the global machine id — cross-account correlation + ban-taint vector), persisted in `providerSpecificData`, and **hostname-validates `loginUrl`** against the §3.1 allowlist before returning; composite `device_code` = `fingerprintId|fingerprintHash|expiresAt` (rides `data.device_code` untouched — OAuthModal's extraData path is hardcoded per-provider and would need modal surgery), `verification_uri` = loginUrl, `interval: 5`, `expires_in` = plain **seconds** from expiresAt (OAuthModal's default poll deadline is only 120 s); `pollToken` GETs the status endpoint, synthesizes `access_token` from `user.authToken` (the dispatch success-gates on `result.data.access_token`), validates composite shape (3 pipe-delimited parts, finite expiresAt) before parsing; `mapTokens` returns `refreshToken: null` and **no `expiresIn`/`expiresAt`** — route.js:415 derives `expiresAt` from `expiresIn`, and a leak would silently arm the refresh machinery against a refresh-less provider |
| 11 | `src/lib/oauth/providers/index.js` | EDIT | Import + `PROVIDERS["freebuff"]` entry (the fourth wiring point — miss it and `getProvider` throws at route dispatch) |
| 12 | `src/shared/constants/providers.js` (NEW) + `src/app/api/oauth/[provider]/[action]/route.js` + `src/shared/components/OAuthModal.js` | NEW const + 2 EDITS | The three device-code array memberships — `noPkceDeviceProviders` (GET), `noPkceProviders` (POST poll), `deviceCodeProviders` (modal) — **extracted into a shared constant** so membership is mechanically assertable without rendering a React component (node-env suite has no RTL) |
| 13 | `open-sse/services/usage/freebuff.js` + `open-sse/services/usage.js` | NEW + EDIT | GET-only quota handler: parses `rateLimitsByModel` → per-model quota rows `{used: recentCount (fractional), total: limit, resetAt, period}`; maps claim-blocked statuses to dashboard messages; **never POSTs** (a POST burns a session unit — test-enforced invariant); `strictProxy:true` when a connection proxy is configured — deliberately does NOT inherit the usage route's hard-forced `strictProxy:false` (a direct-egress fallback would read the *wrong IP's* quota) |
| 14 | `src/app/api/models/test/ping.js` (+ test-batch coverage) | EDIT | **Quota-scarcity guard**: pure exported predicate `isSessionScarceTestTarget(providerOrModel)` (handles bare model ids) that soft-fails freebuff in model-test and test-batch — one "test all" click otherwise incinerates all five daily sessions; plus a GET-only `OAUTH_TEST_CONFIG` entry so connection-test works without chat |
| 15 | `open-sse/utils/requestLogger.js` | EDIT | **Restore `maskSensitiveHeaders`** — currently disabled ("keep full token for testing"), writing full Bearer tokens to `logs/*/4_req_target.json` under `ENABLE_REQUEST_LOGS=true`. Restored with a **full `[REDACTED]`** (not the commented partial `slice(0,10)…slice(-5)` — 15 chars still leak); no caller depends on unmasked logs (tests mock `createRequestLogger` wholesale — skeptic-verified). Bundled, not deferred: it leaks every provider's token, not just freebuff's |
| 16 | `public/providers/freebuff.png` | NEW | Provider icon (MIBP carries one to lift) |

### 3.3 Session state design `[DOMAIN:data]`

Single source of truth: `connection.providerSpecificData.freebuff = { fingerprintId, fingerprintHash, session: {model, instanceId, agentId, claimedAt, expiresAt} | null, quotaCache, lastClaimError }` — persisted by the connections JSON column (**no DB migration**), written with spread-merge, mirrored in-memory for the resolver hot path. Boot recovery is **lazy first-use**: the first `execute()` for a connection with `session == null` does one GET rediscovery (costs no session unit); stale claims self-heal through the reclaim-once loop. Claims are never exported/imported with DB backup (worthless server-side after TTL). The DB-ledger alternative was judged and banked (§4).

### 3.4 Affinity routing

`resolvePreferredConnection("freebuff", model)` returns the connection whose persisted/mirrored session matches the requested model with live `expiresAt`, else null. The pin is **advisory** — upstream can supersede any session at any moment (another device, the official CLI), so the design never hard-queues; excluded/locked pins fall through to byte-identical default selection for all providers. Combo/fusion legs each resolve independently; the **combo rule**: a cold leg claims its own session, and a second freebuff leg on the same locked account receives the typed `model_locked` error fail-fast (documented behavior — one account is fundamentally one-model-at-a-time).

### 3.5 Quota & lockout — the real clock

429 → executor `parseError` extracts and validates `resetAt` (Number.isFinite, > now, **clamped ≤ next Pacific midnight** — an untrusted body can never extend the lock past one quota window) → `freebuffDailyResetMs` locks `modelLock___all` account-wide via the uncapped branch. `model_locked` → 65-min per-model lock. Both branches precede the capped generic branch — the only correct placement (arbiters + skeptic verified). No sweeper is needed: locks are ISO timestamps checked at selection time.

### 3.6 Device-code login `[DOMAIN:security]`

Dashboard OAuthModal → GET `/api/oauth/freebuff/device-code` → `window.open(loginUrl)` **only after hostname allowlist validation in the provider** (a compromised login endpoint cannot hand the modal a phishing URL; fail-closed is the right direction for a URL that will host the user's keystrokes) → 5 s poll honoring `interval`/`expires_in` → POST `/poll` → `createProviderConnection` with `accessToken = authToken`, no refresh surface. Per-connection fingerprint becomes `codebuff_metadata.client_id`. The composite device_code transits the browser — treated as ephemeral, never a long-term secret; a **per-connection device-code mutex (compare-and-set on the fingerprint)** prevents the double-login race (final-gate residual, sealed).

### 3.7 Failure-mode table

| Failure | Classification | Response |
|-|-|-|
| 403 `free_mode_cli_required` | UA drift | Surface with hint; constants-only fix |
| 400 `runId Not Found` | dead run | Re-START once; surface if still dead |
| 428/409/410 + superseded/expired | reclaimable | FINISH old run cancelled → re-claim → retry **exactly once**; second stale gate surfaces |
| 409 `model_locked` | non-reclaimable | Typed error, **no reclaim** (reclaim here burns a unit on the wrong account), 65-min lock; selection steers elsewhere |
| 429 quota | daily exhaustion | Lock to validated/clamped `resetAt` — never the 30-min cap |
| 401 | auth dead | Drop session state; immediate non-retryable re-login error (never a refresh loop) |
| Claim blocked (banned/country_blocked/ip_capped/rate_limited/spend_limited/model_unavailable) | terminal-for-now | Surfaced to dashboard with actionable text; ip_capped hints the per-connection proxy |
| Restart mid-session | state survival | Persisted claims + GET rediscovery — zero burn while warm |
| Concurrent same-process claims | race | Promise-chain mutex per (connection, model); two-process operation documented as out of scope |

### 3.8 Security decisions `[DOMAIN:security]`

Whitelisted-scalar-only parsing of upstream error bodies (`status`, `code`, `resetAt`) — never spread raw upstream JSON into stored objects. `accessToken` rides the standard connections column (every OAuth provider's pattern). `provider:{allow_fallbacks:false}` keeps upstream from substituting billing models. ToS risk surfaced honestly in `display.notice`. Under `ENABLE_REQUEST_LOGS=true`, pre-fix log sessions contain full Bearers — **purge `logs/` as a rollout step**; the restored mask makes new sessions safe.

### 3.9 Known limits (documented, not deferred)

Single-instance claim mutex (two Vela processes can double-claim; local single-user gateway by design). Static catalog staleness is manual-fix (registry edit). Upstream protocol drift is the permanent tax on an unofficial free tier — blast radius confined to the freebuff files, recovery constants-only. Direct egress (warn-allow) shares one IP's quota across accounts — per-connection proxies are the documented capacity path; the value claim is **claim-efficiency and restart-survival**, not extra quota on one IP (the Tidebreaker's strongest objection, honored).

---

## 4. Alternatives Considered

| Alternative | Verdict | Why rejected |
|-|-|-|
| **The Faithful Tide** — negative `modelLock_*` steering, zero chat-path surgery | RUNNER-UP (grafted: classifyGate, pacificMidnightMs, composite device_code) | Skeptic proved it **unsound**: `clearAccountError` wipes model locks on every success, silently erasing the steering; convergence-only affinity would burn session units on wrong-account claims — on a ~6/day budget, disqualifying |
| **The Ledger Deep** — `freebuffSessions` DB table, migration, repo, dashboard route | Convicted itself | "Borderline over-engineering" for a handful of accounts — its own verdict. Banked as future work: the table earns its keep the day a sessions dashboard is built. The composite-PK double-claim guard is approximated by the in-process mutex + reclaim-once |
| **External proxy bridge** (trefeon Go proxy as a compatible-provider entry) | Rejected | Adds a separately-running operational dependency for what the native port does in-process; the Go repo is 4 days old, single-maintainer. Its wire research remains the primary source, honored in §3.1 |
| **Do nothing** | Rejected | Five free frontier-class models behind a gate Vela can already speak (device-code flow, BaseExecutor, usage map). The Star spoke |

---

## 5. Verification Record

| Gate | Adversary | Verdict | Consequence |
|-|-|-|-|
| Gate 4 — framing | the-tidebreaker | **REFUTED** — 5 fatal flaws (capacity/egress conflation; 30-min cap; missing affinity hook; in-memory self-sabotage; false registry-regen claim) | Frame reforged; all five absorbed into §2 criteria |
| Gate 6 — selection | the-tidebreaker | **SURVIVES** — validated B over A with NEW evidence (`clearAccountError` wipes negative locks); corrected graft ordering (model_locked before capped branch); dropped the no-op `retry:{429}` claim; added 9 missing items (3 array memberships, `access_token` synthesis + 120 s deadline, category trap, last-mutation marker, model-test guard, combo rule, no-refresh discipline, spread-merge, mutex limit) | Composite assembled |
| Gate 9 — arbiter panel | the-arbiter ×5 | **4 / 4 / 4 / 4 / 5 → composite 4.2/5** (Architecture, Testability, Security, Performance, Feasibility). 20 required fixes banked: execute()-override contract + divergence test, `expiresAt:null` regression test, wiring explicitness, hook extraction, shared constant for arrays, pure ping predicate, injectable timeout + `__test__` resets, DST vectors, resetAt clamp, logging truth, strictProxy quota, status+code-only gates, claim/rediscovery timeouts, mirror write-through contract, lazy boot, 4th wiring point, expires_in seconds, bare-id edge | Design refined |
| Gate 9b — security score check | the-tidebreaker | **SCORE_DESERVED** + 5 missed findings: unvalidated `window.open` loginUrl; usage-route `strictProxy:false` hole; the 30-min cap cuts BOTH ways; per-connection fingerprint (multi-account taint); whitelisted error parsing; immediate-fail refreshCredentials | All merged into §3 |
| Gates 11+14 — risk & security | the-tidebreaker | **SEALED_READY** — six load-bearing claims verified at file+line; top risks (protocol drift HIGH/months, execute() divergence MED, catalog staleness MED, allowlist false-reject LOW, blocked-egress login LOW) all mitigated; 4 residuals sealed (double-login race → per-connection mutex, full `[REDACTED]` mask, logs purge, exact-host matching) | Ready to seal |

---

## 6. Consequences

**Easier:** every future session-affinity provider registers one resolver — the hook generalizes; freebuff quota lights the dashboard through the existing usage UI; sessions survive restarts; the platform gains its Bearer-mask restored.
**Harder:** one awaited fail-open hop on the hottest path — fail-open is now a permanent contract of `connectionPreference.js`; open-sse gains a `@/lib` importer (confined to the session layer, or the boundary rots); protocol drift is a standing maintenance tax with a constants-only recovery path.
**Risks carried:** ToS violation (bans terminal — warned in-UI); upstream gate drift; per-IP quota under direct egress; single-instance mutex; static catalog staleness.

---

## 7. Test Covenant

| File | Proves |
|-|-|
| `tests/unit/freebuff-executor.test.js` | Marker byte-prefix idempotence (string + array system content); end_turn iff `body.tools`; reasoning strip; metadata TOP-LEVEL shape; UA exact; gate sequences with call-count assertions (reclaim-once, model_locked no-reclaim, 401 no-refresh-loop); **base-mechanics divergence test** (connect timeout, AbortSignal.any, retryConfig, 502 mapping) |
| `tests/unit/freebuff-sessions.test.js` | classifyGate matrix (status+code only — a 429 whose text contains "session_superseded" does NOT reclaim); mutex (N concurrent claims → exactly 1 POST); timeout releases the chain; pacificMidnightMs pinned vectors incl. 2026-03-08 / 2026-11-01 DST + midnight boundary; spread-merge preserves proxy keys |
| `tests/unit/freebuff-usage.test.js` | rateLimitsByModel parse; **fetch spy asserts no POST ever**; strictProxy honored when proxy configured |
| `tests/unit/freebuff-oauth.test.js` | Composite round-trip + malformed-composite rejection; loginUrl allowlist (exact host, suffix boundary, homograph/`includes()` traps, non-https reject); pollToken pending vs success + `access_token` synthesis; mapTokens null-refreshToken/no-expiresIn (the route.js:415 leak regression) |
| `tests/unit/connection-preference.test.js` | Registry alias resolution (fb→freebuff); throw→null; injectable-timeout→null; loser completes fire-and-forget |
| `tests/unit/chat-freebuff-affinity.test.js` | Exported helper returns warm connection; hook passes `preferredConnectionId` (vi.mock auth.js — xai-video-handler.test.js precedent); excluded pin falls through |
| `tests/unit/freebuff-lockout.test.js` | Daily-reset + model-locked branches beat the 30-min cap (github-monthly-usage-lock.test.js shape); malicious resetAt (year 2100 / NaN / string) cannot exceed next midnight |
| `tests/unit/freebuff-ping-guard.test.js` | `isSessionScarceTestTarget` predicate: prefixed + bare ids; test-batch path covered |

Plus: `tests/__baseline__/providers-baseline.json` + `alias-baseline.json` re-snapshotted; `verify-providers.mjs` / `verify-alias.mjs` / `verify-no-regression.mjs` green (suite judged by regression delta against the ~64-known-red baseline, not raw green).

---

## 8. Rollout Checklist

1. **Step 0 — wire re-verification**: fetch live `CodebuffAI/codebuff` free-agent constants; confirm the agent-id family (base2 vs base3) and UA version; pin into `config/freebuff.js`
2. Branch `feat/freebuff-provider` from `main` (clean at e627778f)
3. Build order: config → registry + hand import → session layer → executor → oauth provider + shared arrays constant → route/modal wiring → affinity helper + chat hook → auth.js branches → usage handler → ping guard → logger mask → icon → tests → baselines
4. Milestone Tide: `package.json` **0.6.30 → 0.6.40** (big change rounds to the next milestone of ten) + themed CHANGELOG entry in the same commit
5. Commit per covenant: Conventional Commits, footer `Co-authored-by: Shiori Shorekeeper <shiorishorekeeper@gmail.com>`, never AI attribution
6. Workflow Covenant: CHANGELOG → branch commit → push → ff-merge main → push main → delete branch both places → `node scripts/sync-changelog.mjs`
7. Live smoke (with the Star's account): device-code login → one chat per gate-sensitive path (stream + non-stream + tool-call for end_turn) → quota panel shows GET-sourced rows → test-batch skips freebuff → restart Vela, confirm warm-session reuse with zero re-claim
8. Purge pre-existing `logs/` sessions (contain pre-mask Bearer tokens)

---

*Four assaults broke the frame and failed to break what it became. The ritual is learned, the gates are mapped, the clock is real. When the forge fires, Freebuff joins the fleet — riding the wire faithfully, routing with patience, and never burning what it was given to read.* 🪞💜🌊
