# 🪞 The Proxy Covenant — Mirror Design Record

> *"Four currents returned from the deep — MIBP, VansRouter, AMRouter, and the state of the art — and all four say the same thing in different voices: the proxy fleet deserves a memory. This record carries the ceremony from research to sealed plan."* 🪞💜🌊

**Status**: Mirror Phase 4 in progress (framing under adversarial challenge)
**Opened**: 2026-08-17
**Decree**: full upgrade of the proxy system + freebuff — more features, more tools, more modes, more handlers, per-provider pages upgraded.

---

## Phase 1–2: Intelligence Briefing & Prior Art (completed)

Four research streams + internal recon, crystallized to Tethys:

| Stream | Artifact | Core Intelligence |
|-|-|-|
| MIBP container | `mibp-proxy-intelligence-survey` | Fitness registry, poolScoped retry, smart rotation — the intelligence layer |
| VansRouter | `vansrouter-proxy-survey` | proxyHash failure isolation, circuit breaker + semaphore, egress geo probing, sticky OAuth affinity |
| AMRouter | `amrouter-proxy-survey` | Three-tier config, strictProxy, test-driven auto-disable, bulk health-check UX, batch import, relay deploy, managed-env marker |
| Design patterns | `proxy-design-patterns-survey` | SOCKS via undici Socks5ProxyAgent (7.29.0 pinned — wiring problem, not dependency problem) |
| Convergence | `proxy-covenant-convergence-synthesis` | MIBP+VansRouter independently validated the intelligence layer; AMRouter validated the operational UX; Vela welds them + fills three gaps no fork shipped |

**Internal recon findings (live codebase, 2026-08-17):**
- `proxyAwareFetch` (open-sse/utils/proxyFetch.js): dispatcher cache (max 20), MITM DNS bypass, noProxy semantics, strictProxy, relay retargeting — solid core, no SOCKS, no fitness
- `connectionProxy.js`: Pool → Legacy → None resolution; `pickProxyPoolId(poolIds, strategy, providerId)` round-robin/random — rotation seam exists but has no failure memory
- `auth.js buildVirtualNoAuthConnection`: noAuth providers (incl. freebuff) already get `settings.providerStrategies[pid].rotateStrategy` over all active pools — freebuff rotation foundation is live but invisible in UI
- freebuff: `FREEBUFF_CLAIM_BLOCKED_CODES` (country_blocked, ip_capped, banned, rate_limited, spend_limited, model_unavailable, premium_slot_taken) → claim `blocked` → `clearSession` records `lastClaimError {code, at}` — nothing acts on it at the proxy layer
- proxy-pools API `VALID_PROXY_TYPES = ["http","vercel","cloudflare","deno"]` — no socks
- Dashboard targets: `(dashboard)/dashboard/proxy-pools/page.js` + `providers/[id]/page.js`

---

## Phase 3: Requirement Elicitation — The Star's Voice (completed 2026-08-17)

### The Star's Decrees (verbatim intent + structured answers)

1. **Release shape**: ONE sealed plan — the full upgrade ships in one ceremony. Larger diff, one version seal.
2. **Fitness state**: PERSISTED in SQLite — fitness survives restarts. Implies a new migration (next available number) with twin parity across sqlite/mysql/mirror postures per the DB Covenant.
3. **Freebuff block response**: INSTANT re-pick — on country_blocked / ip_capped, mark the pool unfit and re-attempt the claim through a different pool within the same request.
4. **SOCKS scope**: SOCKS5 only (no SOCKS4), via undici's Socks5ProxyAgent (undici 7.29.0 locked).

### Requirements Register

| # | Requirement | Source | Priority |
|-|-|-|-|
| R1 | SOCKS5 pool type accepted in API validation, test endpoint, and the main undici fetch path | Decree (modes) | MUST |
| R2 | Persisted fitness per pool: success/failure counters, latency EWMA, egress geo (ip + country), decay over time | Decree (state) + MIBP/VansRouter validation | MUST |
| R3 | Fitness-weighted ("smart") rotation strategy joining round-robin/random | Research convergence | MUST |
| R4 | Freebuff claim-block codes (esp. country_blocked/ip_capped) feed the fitness layer; instant re-pick within the same claim request; honest exhaustion error | Decree (freebuff heart) | MUST |
| R5 | Per-provider proxy panel on providers/[id]: pool binding, strategy selection, per-provider fitness view | Decree (per-provider pages) | MUST |
| R6 | Proxy tools on proxy-pools page: bulk health check (concurrency-capped, disable-dead confirm), batch import, export, IP-echo egress probe with geo display | Decree (tools) | MUST |
| R7 | Migration with sqlite/mysql/mirror parity + backup-export completeness | DB Covenant | MUST |
| R8 | Zero regression vs tests/__baseline__/verify-no-regression.mjs | Standing law | MUST |
| R9 | Relay auth hardening + masked proxy logging (AMRouter ideas) | Research (banked) | SHOULD |
| R10 | Test-driven pool auto-disable on health check failure | AMRouter | SHOULD |
| R11 | No secrets in committed diff (commit ritual grep) | Standing law | MUST |

### Success Criteria (checkable)
1. `socks5://` pool URLs accepted, tested, and used on the undici main fetch path
2. Fitness registry persisted per pool, decaying, visible in UI
3. A fitness-weighted strategy selectable alongside round-robin/random
4. Freebuff claim-block → fitness signal → instant re-pick; honest error when all pools exhausted
5. Per-provider proxy panel live on providers/[id]
6. Bulk health check + import/export + IP-echo probe live on the pools page
7. Persisted state passes twin parity (sqlite/mysql/mirror)
8. Baseline regression suite stays green
9. Commit ritual clean

### Out of Scope
- MITM layer changes · edge-relay deploy automation · SOCKS4 · global outbound env-var management UI (unless Gate 4 demands otherwise)

---

## Phase 4: Frame Definition (Gate 4 verdict absorbed — 2026-08-17)

### ⚔️ Tidebreaker verdict: REFUTED as stated — vision survives, statements refit

Three fatal flaws found and verified by my own re-read of the code:

| Flaw | The Falsehood | The Repair (verified) |
|-|-|-|
| **FLAW-1** | Frame said "next migration 010" | `010-usage-request-tags.js` ALREADY EXISTS; `SCHEMA_VERSION = 10`. Fitness migration is **011**, re-verified against `migrations/index.js latestVersion()` at implementation time |
| **FLAW-2** | Recon claimed freebuff rides pool rotation | **False.** freebuff registry: `category:"freeTier"`, `authType:"oauth"`, NO `noAuth` (comment: virtual noauth connection "would bypass every session/claim mechanism"). Rotation lives only in `buildVirtualNoAuthConnection`. Freebuff = per-connection single-pool pins, ZERO rotation today. Re-pick needs a NEW candidate-source mechanism + a Star-named pin-override policy |
| **FLAW-3** | Persisted fitness + per-request updates under mirror posture | Fitness is the HOTTEST write path — per-request synchronous writes would flood the outbox (5-retry poison policy degrades the very posture parity promises). Decree: in-memory EWMA + batched flush; fitness table joins `TABLES` (export completeness), mysql twin DDL, replay class classified |

**What survived the attack** (verified true): SOCKS truly cannot ride the main path (`getDispatcher` builds only HTTP-CONNECT `ProxyAgent`); undici 7.29.0 exports `Socks5ProxyAgent` and it streams SSE fine (standard Dispatcher); instant re-pick IS feasible at the claim boundary (mutex releases before re-entry, blocked claims burn no quota, executor gate-catch is the right home); rotation exists but is memoryless; block codes burn the WRONG entity (connection lockout via `checkFallbackError` default; pool never marked; `lastClaimError` consumed by nothing). **Bonus**: `socks-proxy-agent@^8.0.5` is dead weight (zero imports) — removable. `docs/STORAGE.md`'s migration count is stale debt — the plan cites `migrations/index.js`, never the doc.

### Revised Problem Statement (post-repair)

> Vela's proxy layer is static and blind: each binding pins a single URL; selection rotates naively with no memory of failures — and freebuff (keyed, OAuth, per-connection single-pool pin) has no rotation at all. SOCKS proxies cannot ride the main fetch path, and freebuff's geo-block answers (country_blocked / ip_capped) burn a connection lockout while teaching the gateway nothing — the pool is never marked, and the recorded error is consumed by nothing. The gateway cannot answer "which exit does this provider trust?", and the operator cannot see proxy fleet health, geography, or fitness at a glance.

### Revised "How Might We" (scope-honest)

> How might we turn the proxy fleet into a self-healing, observable, multi-mode system — one that learns which egress identity works, with **instant re-pick for freebuff** (the only lane with structured block codes) and **learned fitness-weighted rotation for every lane** — that speaks HTTP(S), relay, and SOCKS5 alike, persists its knowledge across restarts without flooding the mirror outbox, and surfaces every signal (fitness, geo, latency, bound connections) on the pools page and per-provider pages?

### Added Success Criteria (C10–C16, from the Tidebreaker)

- **C10** Fitness writes batched/coalesced: bounded outbox rows per minute under `mirror` (pinned test); replay class classified; fitness table in `TABLES`; export round-trip pin passes; mysql twin DDL present
- **C11** Migration number = `latestVersion()+1` (**011** as of this reading), verified at implementation
- **C12** Re-pick burns zero quota on blocked attempts, ≤1 per successful claim; explicit attempt cap + total latency budget (blocked claims fail fast, but N blocked pools × 20s claim timeout under a serialized mutex is a real hazard)
- **C13** Re-pick works for per-connection PINNED pool bindings (freebuff's actual shape), pin-override policy documented
- **C14** Fitness key granularity decided: per-pool vs per-(pool, provider) — ip_capped is provider-scoped, country_blocked is geo-scoped; one key size cannot serve both without a decision
- **C15** Backward-compat pin: existing pools/bindings resolve byte-identical until the first fitness signal; adding `socks5` changes nothing for http/vercel/cloudflare/deno pools
- **C16** Re-pick code set LOCKED to egress-IP-scoped codes only: {country_blocked, ip_capped}. `banned` is account-scoped (re-pick would churn); `model_locked` must NEVER re-pick (burns a unit on the wrong account); rate_limited/spend_limited/model_unavailable/premium_slot_taken are quota/slot-scoped — never re-pick

### Security note (non-fatal, decide in sealed plan)

Pool URLs with embedded credentials already flow into backups via the export-completeness law (not in `EXPORT_EXCLUDED_TABLES`, not covered by secret redaction). SOCKS5 `user:pass@` URLs extend that exposure — the sealed plan must make an explicit decision.

---

## Decision Log

| Date | Decision | Rationale |
|-|-|-|
| 2026-08-17 | One sealed plan over waves | Star's decree — the full upgrade in one ceremony |
| 2026-08-17 | Persisted fitness (SQLite + parity) over in-memory | Star's decree — durability across restarts chosen over simplicity |
| 2026-08-17 | Instant re-pick over degrade-only | Star's decree — fastest recovery from geo-blocks |
| 2026-08-17 | SOCKS5 only | Star's decree — covers virtually all real SOCKS proxies |
| 2026-08-17 | Migration 011 (not 010) | Tidebreaker FLAW-1 — verified `SCHEMA_VERSION = 10` |
| 2026-08-17 | Fitness write shape = in-memory EWMA + batched flush | Tidebreaker FLAW-3 — the mirror outbox must not flood |
| 2026-08-17 | Re-pick codes locked {country_blocked, ip_capped} | Tidebreaker C16 — only egress-IP-scoped codes justify re-pick |
| 2026-08-17 | Remove dead `socks-proxy-agent` dep | Tidebreaker bonus — zero imports anywhere |
| 2026-08-17 | HMW constrained: instant re-pick is freebuff's; other lanes get learned rotation | Scope honesty — freebuff is the only lane with structured block codes |
| 2026-08-17 | Pin-override policy = **block-override**: the pin is respected until a geo-block proves it unfit; re-pick then draws from ALL active fit pools with the pinned pool first whenever fit | Star's Gate 4 decree (2026-08-17) |
| 2026-08-17 | Fitness key = **per-(pool, provider)**: ip_capped marks that provider on that pool; geo-blocks also record the pool's egress country; bounded rows | Star's Gate 4 decree (2026-08-17) |

*Gate 4 opens with the frame complete: problem statement refit, HMW scope-honest, criteria C1–C16, all decrees and policies recorded. Beyond this gate: the second diamond — the development of answers.* 🪞💜

---

## Phase 5: Divergent Approaches (received — all three)

### Approach A — "Extend The Seams" (minimal machinery)

**Core thesis:** weave fitness into six existing seams + one migration/repo pair. No new service, no bus. The intelligence is local: `connectionProxy.js` (picker + EWMA), `auth.js` (outcome hooks), `freebuff.js` (re-pick loop), `proxyFetch.js` (socks5 branch). **Effort:** ~21 files, ~1,700 LOC. **Weaknesses:** diffuse ownership (no single home), implicit feedback wiring, lossy flush (≤10s), re-pick bespoke to freeburn, cold start (legacy until first signal), single-sourced geo, a fourth rotation mode.

**Verified claims:** `claimSession`'s mutex releases in `finally` before re-entry (blocked claims burn zero quota); `buildSessionProxyOptions` re-reads psd every call (re-pick can mutate credentials mid-request); chatCore snapshots proxyOptions once (executor must rebuild its local copy); undici 7.29.0 exports `Socks5ProxyAgent`; `socks-proxy-agent@^8.0.5` dead weight; `SCHEMA_VERSION = 10`, so fitness migration is **011**.

### Approach B — "The Fleet Captain" (centralized intelligence)

**Core thesis:** ALL fleet intelligence lives in ONE module — `src/lib/network/proxyFleet.js` — which owns: fitness store (in-memory EWMA + batched persistence), selection policy (fitness-weighted pick, round-robin, random, pin-aware block-override re-pick), health scheduler (bulk checks, auto-disable, IP-echo probes), API surface. Every existing module becomes a thin client. **Effort:** ~34 files touched, ~1,940 new LOC / ~170 modified. **Weaknesses:** centralization bet (one throat to choke, but one place to fix), hot-path indirection in auth/chat.js (regression risk), one more engine→src dependency (precedent exists but adds coupling), UI projection staleness (30s flush cadence), smart strategy heuristic ceiling.

**Verified claims:** `open-sse/services/freebuffSession.js` already imports `@/lib/localDb` (engine→src precedent verified); claim mutex release-before-re-entry confirmed (freebuffSession.js:315–318); `[id]/route.js:41` PUT has latent bug missing `deno` from validTypes; migration number 011 confirmed; SOCKS5 via undici Socks5ProxyAgent (7.29.0 installed, socks-proxy-agent zero imports).

### Approach C — "The Signal Bus" (event-driven fitness)

**Core thesis:** dispatch emits structured signals onto an in-process event channel (EventEmitter precedent: `consoleLogBuffer.js`), fitness CONSUMER subscribes/aggregates/batches/persists on its own clock, selection QUERIES live state. Hot path never touches fitness logic directly — only emits. **Effort:** ~25 files, ~2,100–2,400 LOC. **Weaknesses:** bus over-engineered for today's 1-producer/1-consumer topology (would collapse to direct calls if future-signals requirement dropped); sync emitter means consumer arithmetic runs in the hot-path stack (structural tension with decree 3); crash-window signal loss (≤15s); mid-stream SSE blindness (header-weighted only); emission sites unenforced convention.

**Verified claims:** attribution policy (provider HTTP errors NEVER poison proxy scores — only transport errors + block codes + probes do); synchronous emit = unfit marking instant before next query; 15s/32-keys flush = ≤4 outbox rows/min; `socks-proxy-agent@^8.0.5` dead weight at package.json line 53; migration 011 confirmed.

### Convergence map (all three agreed)

| What | All three agree |
|-|-|
| Migration 011 | PK (poolId, providerId), TTL decay (`unfitUntil`), egressCountry field |
| Replay class | `IDEMPOTENT_UPSERT` / EXEMPT classification (same divergence-sweep path as usage rows) |
| TABLES membership | export completeness + mysql twin DDL via bootstrap diff |
| Socks5 wiring | scheme branch in `getDispatcher` (undici 7.29.0 exports `Socks5ProxyAgent`) |
| Re-pick site | executor gate-catch (`freebuff.js` line 244–267 area) |
| Code set locked | {country_blocked, ip_capped} ONLY; banned/model_locked/quota/SLOT codes NEVER re-pick |
| Pin policy | block-override: pinned pool respected until geo-block proves it unfit, then drawn from ALL active fit pools with pinned first whenever fit |
| Outbound guard | batched writes, not per-request (flush timer 10–30s depending on approach) |
| Dead dep removal | `socks-proxy-agent@^8.0.5` removed from package.json (zero imports) |
| Backward-compat pin | byte-identical legacy behavior until first fitness signal (smart additive opt-in) |
| Fitness key granularity | per-(pool, provider) (+ optional wildcard row for pool-level signals) |

**The divergence:** where the intelligence lives — three seams (A), one captain (B), one bus (C). Each trades simplicity of deployment against complexity of operation. Each honors all twelve sealed decrees. None violates any criterion.

*Phase 6 begins now: score each approach against C1–C16, merge what compounds, bank the runner-up's best ideas, bring the curated selection to your word.* 🪞⚖️💜

---

## Decision Log

| Date | Decision | Rationale |
|-|-|-|-|
| 2026-08-17 | One sealed plan over waves | Star's decree — the full upgrade in one ceremony |
| 2026-08-17 | Persisted fitness (SQLite + parity) over in-memory | Star's decree — durability across restarts chosen over simplicity |
| 2026-08-17 | Instant re-pick over degrade-only | Star's decree — fastest recovery from geo-blocks |
| 2026-08-17 | SOCKS5 only | Star's decree — covers virtually all real SOCKS proxies |
| 2026-08-17 | Migration 011 (not 010) | Tidebreaker FLAW-1 — verified `SCHEMA_VERSION = 10` |
| 2026-08-17 | Fitness write shape = in-memory EWMA + batched flush | Tidebreaker FLAW-3 — the mirror outbox must not flood |
| 2026-08-17 | Re-pick codes locked {country_blocked, ip_capped} | Tidebreaker C16 — only egress-IP-scoped codes justify re-pick |
| 2026-08-17 | Remove dead `socks-proxy-agent` dep | Tidebreaker bonus — zero imports anywhere |
| 2026-08-17 | HMW constrained: instant re-pick is freebuff's; other lanes get learned rotation | Scope honesty — freebuff is the only lane with structured block codes |
| 2026-08-17 | Pin-override policy = block-override | Star's Gate 4 decree (2026-08-17) |
| 2026-08-17 | Fitness key = per-(pool, provider) | Star's Gate 4 decree (2026-08-17) |
| TBD | Architectural angle selected | Pending Gate 6 curation — scoring will reveal the strongest synthesis |

*Gate 6 awaits. Three currents converge on the same shore. The tide chooses.* 🪞💜
