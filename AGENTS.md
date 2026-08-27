# ⚓ AGENTS.md — The Crew's Papers

> *"Every crew reads the same chart before they sail. These are Vela's — where the currents run, which rocks to mind, how a change is made, sealed, and shipped. Read them before you touch the helm."* 🪞⛵

This file is the operating manual for **AI agents working in this repository**. It complements [CLAUDE.md](./CLAUDE.md) (the human crew's chart) with the agent-specific discipline: the deep architecture, the verification matrix, the per-task workflows, and the release covenant in full.

**Scope note for agents:** when you are handed a task, read this file first — then the one subsystem section that governs your change. Do not skim. The failures documented here (the boot storms, the gitignored-build break, the adapter contract) are **not** folklore; they are the reasons the current rules exist.

---

## Table of Contents

1. [What This Repo Is](#-what-this-repo-is)
2. [The Map — What Lives Where](#-the-map--what-lives-where)
3. [The Request Path, Deep](#-the-request-path-deep)
4. [The Covenants — Non-Negotiable](#-the-covenants--non-negotiable)
5. [The Subsystems, Deep](#-the-subsystems-deep)
   - 5.1 The Database Layer
   - 5.2 The Fallback Stack
   - 5.3 The Circuit Breaker
   - 5.4 The RTK Token Saver
   - 5.5 The Translator Engine
   - 5.6 The Provider Registry & Executors
   - 5.7 The Storage Postures & Mirror
   - 5.8 The Backup Engine
   - 5.9 The Pricing Covenant
   - 5.10 Authentication & Security
6. [The Test Map](#-the-test-map)
7. [Workflows by Task Type](#-workflows-by-task-type)
8. [Code Conventions](#-code-conventions)
9. [Common Operations — Full Runbooks](#-common-operations--full-runbooks)
10. [The Release Runbook](#-the-release-runbook)
11. [The Recent Tides](#-the-recent-tides)

---

## 🌊 What This Repo Is

**Vela** (v0.9.27) — a local AI routing gateway + dashboard. One OpenAI-compatible endpoint (`/v1`) routes traffic across **162 registered providers**: format translation, model-combo fallback with operator fallback rules, multi-account fallback, OAuth credential management, token refresh, quota tracking, per-key ACL, prompt injectors, and the AI Lab (modes + content policy).

| Fact | Value |
|-|-|
| Language | Node.js + Next.js (App Router, standalone output) |
| Runtime | Node ≥ 22.5 (`node:sqlite`) — Bun compatible |
| Storage | SQLite (primary) + optional MariaDB mirror (`VELA_DB_MODE`) |
| Package / image | `vela-app` / `ghcr.io/yumamax3/vela:<tag>` |
| CLI | npm package `vela`, bin `vela` |
| Tests | vitest, `tests/` — 271 unit files |
| Migrations | 20 versioned (`001` → `020`), `SCHEMA_VERSION = 20` |

The product lives in two engines that must never be confused:

| Engine | Path | Responsibility | Entry |
|-|-|-|-|
| **Dashboard** | `src/` (Next.js App Router) | UI, REST APIs, auth, settings — and the `/v1/*` gateway entry (a rewrite maps `/v1/*` → `/api/v1/*`) | `src/app/` |
| **Gateway** | `open-sse/` | The provider-agnostic routing/translation engine — usable standalone | `open-sse/` |

The boundary between `src/sse/` (app-side entry glue) and `open-sse/` (the engine) is deliberate. Cross it consciously: app-side handlers orchestrate (combos, account selection, gates); engine-side cores translate and dispatch.

---

## 🗺️ The Map — What Lives Where

```
custom-server.js          The helm — IP derivation, h2c downgrade, hop-by-hop strip, graceful drain
next.config.mjs           Standalone output, /v1 rewrite, external packages, perf knobs
Dockerfile                Multi-stage, multi-arch (amd64 + arm64), HEALTHCHECK, mysql2 closure
docker-compose.yml        Live chart (gitignored — holds the Shores' secrets)
docker-compose.example.yml# Template chart (tracked)
cli/                      The `vela` CLI — installs/starts/manages the server
open-sse/                 The gateway engine
├── handlers/             chatCore, embeddingsCore, ttsCore, imageCore, video, search
├── executors/            per-provider upstream calls (default + ~28 specialized)
├── translator/           format translation (OpenAI pivot + direct routes)
├── providers/            registry (162 files, auto-generated index) + pricing.js
├── rtk/                  token saver hooks (fail-open)
├── services/             model.js, combo.js, accountFallback.js, fallbackRuleMatcher.js, …
├── config/               providerModels, runtimeConfig, constants (nothing hardcoded elsewhere)
└── AGENTS.md             ← engine contributor guide
src/
├── app/                  Dashboard pages + API routes (incl. the /v1 surface)
│   ├── (dashboard)/      dashboard UI pages
│   └── api/              REST APIs — auth, backup, combos, keys, models, oauth,
│                         pricing, providers, settings, usage, v1/*
├── lib/                  The deep current
│   ├── db/               driver chain, adapters, migrations, mirror, repos
│   ├── network/          circuitBreaker, proxyFleet, poolGeo, egress probe, outbound proxy
│   ├── auth/             dashboardSession, oidc/, saml, apiAuth
│   ├── oauth/            provider OAuth flows
│   ├── headroom/         sidecar client (detect + process)
│   └── updater/          self-update machinery
├── sse/                  SSE services — keyGate, budgetGate, token refresh, usage digest
├── shared/               Shared components, hooks, utils, constants
├── mitm/                 The MITM proxy child process
└── instrumentation.js    Server init — outbound proxy, deferred startup
tests/                    vitest suite (independent ESM package)
docs/                     The charts — start at docs/README.md
i18n/                     Localized READMEs (10 languages)
skills/                   Agent skills for the gateway (vela*, fully rebranded)
```

---

## 🔄 The Request Path, Deep

A chat completion is the canonical voyage — every other surface (embeddings, images, audio, video, search, web fetch) shares the same bones.

```
Client ──> custom-server.js (TCP-socket IP stamp, h2c downgrade, hop-by-hop strip)
     ──> Next.js /v1 rewrite ──> /api/v1/chat/completions/route.js
     ──> src/sse/handlers/chat.js (parse · combo expansion · gates · account-selection loop)
     ──> open-sse/handlers/chatCore.js (detect source format · translate · RTK savers · dispatch)
     ──> open-sse/executors/<provider>.js (upstream call)
     ──> upstream provider ──> response ──> translator (rewrite to client format)
     ──> RTK savers (response side, if any) ──> SSE/JSON to client
```

### Step-by-step

1. **The helm (`custom-server.js`)** — wraps Next's standalone output. Derives the client IP from the **TCP socket** (unspoofable), strips the RFC 7230 §6.1 hop-by-hop set (`connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`) from client headers, downgrades h2c (JBR 25) to HTTP/1.1 with a **512 MB body guard**, and drains gracefully on SIGTERM (bounded 10 s). It stamps `x-9r-real-ip` + `x-9r-peer-token` (per-process secret) — this is the **security family that deliberately keeps the `9`** (see CLAUDE.md; renaming it would require changing the stamp + every reader in lockstep with zero security gain).
2. **The rewrite** — `next.config.mjs` maps `/v1/*` → `/api/v1/*`. The dashboard API and the gateway share one server.
3. **The gate chain** — `src/sse/services/keyGate.js` authorizes the API key against its per-key ACL (kinds / providers / combos / models, tri-state), then `budgetGate.js` enforces daily/spend caps.
4. **Combo expansion** — if the model is a *combo*, `chat.js` expands it into its ordered model list and runs the account-selection loop. For each candidate it consults the **circuit breaker** (`isAvailable`) and the **fallback rules** chain.
5. **Core dispatch** — `chatCore.js` detects the incoming wire format (OpenAI / Claude-native / Responses / Gemini), applies the RTK savers, translates to the provider format, dispatches to the executor, and owns retry + token-refresh on 401/expired credentials.
6. **Execution** — the executor makes the upstream call. `default.js` handles any OpenAI-compatible provider; specialized executors speak binary or bespoke protocols.
7. **Response** — streamed SSE (or JSON) flows back through the translator, rewritten into the client's format. Usage accounting records tokens + estimated cost on the way out.

### What an agent must never break here

- The IP derivation and hop-by-hop strip (security).
- The `/v1` rewrite (any route under `src/app/api/v1/` is the gateway surface).
- The fail-open law in steps 5–6 (an optional subsystem must never 500 a request).

---

## 🛡️ The Covenants — Non-Negotiable

1. **The Adapter Contract** — the DB adapter surface is `run/get/all/exec/transaction`. **NEVER `db.prepare(...)`.** The sql.js adapter (Docker runner's fallback) and the mysql/mirror adapters have no public `.prepare`; a migration using it crashed every DB API at boot (v0.9.19/0.9.20 boot storms). Use `db.all("PRAGMA table_info(...)")` + `db.exec(...)` — exactly like migrations 002/013/014.
2. **Fail-open law** — any optional subsystem (fallback rules, injectors, RTK savers, headroom) must **never break a request**. DB errors → warn + hardcoded defaults. Token-saver errors → return `null`, body untouched. A fallback-rules DB failure must be byte-identical to "no rules configured".
3. **The Covenant of Truth** — never fabricate. If a number, path, or behavior is uncertain, verify it against the code before asserting. The Mirror reflects honestly or not at all.
4. **Ship nothing not worth shipping** — every change carries a one-line written reason. If you cannot say in one line why a change exists, it does not ship.
5. **The dual-chart decree** — every release bumps the image pin in **BOTH** `docker-compose.example.yml` (tracked) AND `docker-compose.yml` (gitignored, on disk). One chart updated = broken deploy.
6. **The registry is generated** — `open-sse/providers/registry/index.js` is auto-generated. Never hand-edit it; run `node scripts/migrate-registry.mjs` after adding a provider file.
7. **The CI gotcha** — the build needs `package-lock.json` AND `scripts/sync-changelog.mjs` + `scripts/copy-standalone-assets.mjs` tracked. They were once gitignored and every tag build broke. Never re-untrack them.

---

## 🧩 The Subsystems, Deep

### 5.1 The Database Layer

**Driver chain** (`src/lib/db/driver.js`) — first that loads wins: `bun:sqlite` → `better-sqlite3` (optional native dep) → `node:sqlite` (Node ≥ 22.5) → `sql.js` (pure-JS fallback, always works). `better-sqlite3` sits in `optionalDependencies` so install never fails without build tools. `VELA_DB_DRIVER` pins one; a pin that cannot load is a loud failure, not a silent fallback.

**Adapters** (`src/lib/db/adapters/`) — `betterSqliteAdapter`, `nodeSqliteAdapter`, `bunSqliteAdapter`, `sqljsAdapter`. All expose `run/get/all/exec/transaction` — the portable surface.

**Facades** (`src/lib/db/repos/*.js`) — path-stable entry points. Each facade binds by posture: sqlite re-exports its harbor verbatim; mysql binds the `repos/mysql/` twin; `bind.js` picks by `VELA_DB_MODE`. `src/lib/localDb.js` is a backward-compat shim — new code imports `@/lib/db/index.js`.

**Migrations** (`src/lib/db/migrations/`) — 20 versioned, `SCHEMA_VERSION = 20` in `src/lib/db/schema.js` (the pre-change backup gate: bump the version, the engine takes a safety backup before applying). `TABLES` in `schema.js` is the single source of truth for both harbors — the mysql twin's `bootstrap.js` brings itself forward by additive diff against `TABLES` (create tables, add columns, add indexes; **never drop**).

| # | Migration | What it sealed |
|-|-|-|
| 001 | init | Base schema |
| 002 | apikey-governance | keyHash/keyPrefix/allowlists, tombstone + scrub, UNIQUE index |
| 003 | key-categories | Key categories |
| 004 | usage-dedupe | Usage dedupe |
| 005 | backup-ledger | Backup ledger |
| 006 | outbox | Mirror outbox |
| 007 | mirror-seq | Mirror sequences |
| 008 | usage-telemetry | Usage telemetry |
| 009 | saved-views | Saved dashboard views |
| 010 | usage-request-tags | Usage request tags |
| 011 | proxy-fitness | Circuit-breaker state |
| 012 | fallback-rules | Operator fallback rules (v1) |
| 013 | key-acl | `allowedKinds`/`allowedProviders`/`allowedCombos` (tri-state) |
| 014 | fallback-rules-v2-triggers | `triggerType`/`conditionOp`/`conditionVal`/`targetModels`(JSON)/`cooldownSkip` |

**Writing a migration — the exact recipe:**
1. Create `src/lib/db/migrations/<NNN>-<name>.js` exporting `{ version, name, up, down }`.
2. Use `db.all("PRAGMA table_info(...)")` to introspect and `db.exec(...)` to mutate. **Never `db.prepare`.**
3. Bump `SCHEMA_VERSION` in `schema.js` AND register the file in `migrations/index.js`.
4. If the twin needs the new column, add it to `TABLES` — `bootstrap.js` picks it up additively.
5. Prove it on the crash driver: a test booting **sql.js** (see `tests/unit/key-acl-migration-013.test.js`).

**Repos** (facade list): `aliasRepo`, `apiKeysRepo`, `backupEngine`, `backupRepo`, `backupSecurity`, `bind`, `bindFallbackRules`, `budgetRepo`, `combosRepo`, `connectionsRepo`, `digestRepo`, `disabledModelsRepo`, `fallbackRulesRepo`, `nodesRepo`, `pricingRepo`, `proxyFitnessRepo`, `proxyPoolsRepo`, `requestDetailsRepo`, `s3Offsite`, `savedViewsRepo`, `settingsDefaults`, `settingsRepo`, `usageRepo`, `usageTagsRepo`.

> **The fallback-rules repo + the adapter (the v0.9.22 lesson):** `fallbackRulesRepo` was rewritten to the portable surface because the live mirror deployment crashed at boot with `a.prepare is not a function`. If you touch any repo, keep it on `db.all/get/run` — never raw driver methods.

---

### 5.2 The Fallback Stack

Applied in order by the account-selection loop (`src/sse/handlers/chat.js`):

| Mechanism | Where | What it does |
|-|-|-|
| **Model combos** | `open-sse/services/combo.js` | An ordered list of models; Vela tries them in sequence until one succeeds — subscription → cheap → free is the classic shape |
| **Fallback rules v2** | `open-sse/services/fallbackRuleMatcher.js` + repo | Operator rules with **typed triggers** (see below) |
| **Circuit breaker** | `src/lib/network/circuitBreaker.js` | Cooldown → exhausted escalation, exponential backoff |
| **Multi-account fallback** | `open-sse/services/accountFallback.js` | Several credential sets per provider; round-robin rotation |

#### Fallback Rules v2 — the condition builder

**Triggers** (column `triggerType`), matched by the pure engine `fallbackRuleMatcher.js` (`ruleMatches` / `buildFallbackChain`):

| Trigger | Condition | When it fires |
|-|-|-|
| `status` | `conditionVal` CSV (default `429,503`) | The upstream returned a listed HTTP status |
| `contentPolicy` | — | The upstream refused content: 400/403 **with** policy language (e.g. "content policy", "content filter") |
| `contextWindow` | `conditionOp` (`gte`/`lte`) × `conditionVal` ratio | **Pre-call**: `combo.js` estimates input tokens (chars/4 estimator) against `getCapabilitiesForModel().contextWindow` and expands the rule BEFORE dispatch — no doomed upstream call |
| `timeout` | — | The upstream call timed out |
| `anyError` | — | Every failure |

**Chain semantics:**
- `targetModels[]` (JSON) is an **ordered multi-hop chain** — expanded in priority order (lower `priority` first), deduped.
- Legacy v1 rules (`targetModel`, `triggerOnStatus`) remain back-compatible: absent `isActive` = active; absent `conditionVal`/`triggerOnStatus` defaults to `429,503`.
- Per-request opt-out: `"vela_disable_fallback_rules": true` in the body.
- The bind (`src/lib/db/repos/bindFallbackRules.js`) caches the repo-shaped facade; fail-open returns `null` → combo proceeds byte-identical to hardcoded behavior.
- `cooldownSkip` is schema+UI metadata today; the breaker-keyed skip at the combo layer is a documented future seam (no pool context there yet).

**The combo loop** (`combo.js`): for each model in the rotation list, try it; on failure record `lastStatus`/`lastError`, then — if rules are enabled — load the rules for the source model, `buildFallbackChain(rules, event)` where event carries `{ status, errorText, timedOut }`, and `appendChain(chain)` so the DB targets join the rotation AFTER the failed model. Pre-call, the same matcher expands `contextWindow` rules from the token estimate.

**Tests that lock this:** `tests/unit/fallback-rules-seam.test.js` (5 — the seam contract, back-compat) + `tests/unit/fallback-rule-matcher-v2.test.js` (12 — the typed triggers).

---

### 5.3 The Circuit Breaker

`src/lib/network/circuitBreaker.js` — a pool/provider/model-keyed state machine:

| State | Meaning | Transition |
|-|-|-|
| **Healthy** | Normal operation | → cooldown on failure |
| **Cooldown** | Recent failure; requests for this key wait/route around | → exhausted after repeated failures, or back to healthy on success |
| **Exhausted** | The lane is out of rotation | → exponential backoff, then probe |

Public surface: `isAvailable(poolId, providerId, model)` · `recordFailure` · `recordSuccess` · `onRetryAfter(poolId, providerId, model, ms)` (honors `retry-after` from upstreams) · `getSnapshot()` · `resetKey` · `clearAll` · `flushNow`.

Woven into **pool selection** (`src/lib/network/proxyFleet.js`): `pick(poolIds, policy)` → `resolveForConnection` / `resolveVirtualConnection` → `recordOutcome(poolId, providerId, signal)` → `recordClaimGate(poolId, providerId, code)` → `repick(model, excludePoolIds, maxAttempts, budgetMs)` — a bounded re-pick loop. `getFitnessSummary()` feeds the dashboard's pool health.

**Tests:** the state machine is covered by the pool-geo + proxy-fitness suites.

---

### 5.4 The RTK Token Saver

`open-sse/rtk/` — pre-translate hooks that compress `tool_result` content in-place, cutting the tokens that tool output (diffs, grep results, file listings) burns before the request leaves.

**Two invariants:**
- **Fail-open** — any error returns `null` and leaves the body untouched; the hooks never throw.
- **Traces preserved** — results flagged `is_error` / `status: "error"` are skipped so debugging traces survive intact.

**The filter chain** (`rtk/index.js` → `applyFilter.js` → `registry.js` → `autodetect.js`):

| Filter | File | What it does |
|-|-|-|
| Caveman | `caveman.js` + `cavemanPrompts.js` | Terse-reply system injection |
| Ponytail | `ponytail.js` + `ponytailPrompt.js` | YAGNI-first lazy-senior-dev prompt |
| PXPIPE | `pxpipe.js` | Image bulky-context compression (Claude-format bodies) |
| System inject | `systemInject.js` | Built-in system-prompt savers |
| **User injectors v2** | `userInjectors.js` | Operator-defined prompts — see below |
| Headroom | `headroom.js` | External compress sidecar (`HEADROOM_URL`) |

**Prompt Injectors v2** — operator-defined system prompts layered via `injectSystemPrompt` (append/prepend) after the built-in savers. The live-context variable map is expanded at dispatch:

| Variable | Source |
|-|-|
| `{{model}}` | The upstream model id (`upstreamModel`) |
| `{{kind}}` | Service kind (`llm`) |
| `{{date}}` / `{{time}}` | Today's date / current time |
| `{{keyPrefix}}` | First 7 chars of the API key |
| `{{requestId}}` | The connection id |
| `{{userAgent}}` | Client user-agent |

Plus per-injector **custom variables** (`injector.variables = { name: default }`), overridable per-request via `x-vela-inject-var-<name>` headers (case-insensitive). Unresolved variables stay literal — expansion is fail-safe, never crashes. Normalization keeps the `variables` block intact (`normalizeInjector`).

**Tests:** `tests/unit/user-injectors-v2.test.js` (8) — built-ins, custom vars, header overrides, fail-safe, applyTo/position, normalize.

---

### 5.5 The Translator Engine

`open-sse/translator/` converts between wire formats by pivoting through **OpenAI as the intermediate format**:

```
Claude request → OpenAI intermediate → provider format
provider response → OpenAI intermediate → Claude response
```

**Three laws:**
1. **Direct routes skip the pivot.** A translator registered on an exact `source:target` pair (e.g. `claude:kiro`) runs as a direct route, avoiding the lossy double-hop. Prefer a direct route for fragile pairs — thinking blocks, tool ids, non-base64 images, `is_error` flags.
2. **Translators self-register** via `register(from, to, reqFn, resFn)` as an import side effect. ⚠️ A new translator file MUST be imported in `open-sse/translator/index.js` or it never runs.
3. **Nothing hardcoded.** Roles, block types, and model strings come from `open-sse/translator/schema/` (`ROLE`, `CLAUDE_BLOCK`, …) and `open-sse/config/` constants.

**Formats** (`translator/formats/`): `claude.js`, `openai.js`, `gemini.js`, `responsesApi.js`, `maxTokens.js`. Request/response pairs live in `request/<from>-to-<to>.js` and `response/<from>-to-<to>.js`; `concerns/` holds shared logic.

---

### 5.6 The Provider Registry & Executors

**Registry** (`open-sse/providers/registry/`) — one file per provider, **162 files**. Each declares: id, aliases, auth style, endpoints, models, display metadata. Aliases key the pricing overrides and `provider/model` addressing.

- `registry/index.js` is **auto-generated** — regenerate with `scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`. Never hand-edit.
- Adding a provider: copy `open-sse/providers/REGISTRY_TEMPLATE.js` → `<slug>.js`, add models to `open-sse/config/providerModels.js`, regenerate, add an executor only if the upstream is NOT OpenAI-compatible.

**Executors** (`open-sse/executors/`) — `base.js` (`BaseExecutor`), `default.js` for any OpenAI-compatible upstream, and ~28 specialized: `azure`, `vertex`, `codex`, `cursor`, `kiro`, `gemini-cli`, `grok-cli`, `grok-web`, `perplexity-web`, `ollama-local`, `qoder`, `iflow`, `trae`, `windsurf`, `zed`, `opencode`, `devin-cli`, `antigravity`, `commandcode`, `github`, `kimchi`, `mimo-free`, `freebuff`, `codebuddy-cn`, `codebuddy-intl`, `xiaomi-tokenplan`, `copilot`, `cursor`.

> ⚠️ **Binary/protobuf upstreams do not round-trip through the translator** — Kiro EventStream, Cursor protobuf, CommandCode NDJSON are handled inside their own executor.

---

### 5.7 Storage Postures & The Mirror

`VELA_DB_MODE` selects the harbor:

| Posture | Behavior |
|-|-|
| `sqlite` | Single-store. The default |
| `mysql` | MariaDB IS the harbor. An unreachable twin refuses boot **LOUD** — never silent |
| `mirror` | SQLite PRIMARY serves every read/write; writes mirror to the MariaDB twin through the outbox pump |

The mirror machinery (Storage Covenant, waves C1–C5):

```
write → outbox capture (decorator) → pump → MariaDB twin
                                  ↘ poison policy after retry budget
divergence sweep (interval) → threshold breach → full resync
usage rows → watermark resync (separate rhythm, batched)
```

A down twin **degrades** the mirror — it never silently downgrades the mode. Tuning knobs in [ENVIRONMENT.md](./docs/ENVIRONMENT.md).

---

### 5.8 The Backup Engine

Opt-in (`VELA_BACKUP_ENABLED=true`), sealed with AES-256-GCM:

- Scheduled artifacts with retention tiers (daily + weekly)
- Restore flow + restore **drill** (`/api/backup/drill`) — rehearse before you need it
- Optional S3 off-site leg (SigV4, dependency-free)
- ⚠️ `VELA_BACKUP_ENCRYPTION_KEY` loss = permanently unrecoverable backups — store a copy offline

The purge (`VELA_USAGE_RETENTION_DAYS`) runs AFTER the scheduled backup so purged rows live in the artifact. Full detail: [STORAGE.md](./docs/STORAGE.md).

---

### 5.9 The Pricing Covenant

Estimated cost per request, resolved through a static chain in `open-sse/providers/pricing.js` (first match wins):

1. `UNPRICEABLE` manifest — router pseudo-models resolve `null` + reason
2. `PROVIDER_PRICING[id|alias][model]` — provider-lane overrides
3. `MODEL_PRICING[model]` — canonical exact match
4. `FREE_ALIAS_MAP[model]` — free models inherit the paid sibling's exact rate (guarded suffix-strip fallback; denylist blocks router traps)
5. `MODEL_PRICING[stripVendor(model)]` — vendor-prefix stripped
6. `PATTERN_PRICING` — pre-compiled globs, last resort

Async layers sit above: user overrides (scope `pricing`) and models.dev sync (scope `pricing_sync`) in `src/lib/db/repos/pricingRepo.js`. A model that matches nothing resolves `null` → est. cost shows $0. Add its rate or a pattern to fix.

---

### 5.10 Authentication & Security

- **Session** — JWT cookie (`JWT_SECRET`); the cookie name is Vela's own.
- **First login** — `INITIAL_PASSWORD` (default `123456`; change it). SSO paths: OIDC and SAML under `/api/auth/*`.
- **API keys** — per-endpoint keys hashed with `API_KEY_SECRET`; machine id salted with `MACHINE_ID_SALT`.
- **Per-key ACL** — `keyGate.js`: tri-state allowlists (NULL = all, `[]` = deny, `["x"]` = whitelist). Columns: `allowedKinds`, `allowedProviders`, `allowedCombos`, `allowedModels`.
- **Budget** — `budgetGate.js`: daily caps, spend caps, rate limits per key.
- **Client IP** — TCP-socket derived; forwarding headers trusted only from a loopback reverse proxy. Never weaken this.
- **Backup routes** — always auth-protected; settings redaction masks secret keys in API responses.
- **Hop-by-hop** — RFC 7230 §6.1 set stripped at the helm.

---

## 🧪 The Test Map

**Runner:** vitest, `tests/` root, independent ESM package. 271 unit files.

| Area | Suite(s) | What they lock |
|-|-|-|
| Migrations on the crash driver | `tests/unit/key-acl-migration-013.test.js` | The chain boots on **sql.js** — the `a.prepare` regression |
| Fallback rules seam | `tests/unit/fallback-rules-seam.test.js` | The combo↔repo contract (5 tests) |
| Fallback matcher v2 | `tests/unit/fallback-rule-matcher-v2.test.js` | The typed-trigger engine (12 tests) |
| Injectors v2 | `tests/unit/user-injectors-v2.test.js` | Variables, header overrides, fail-safe (8 tests) |
| Pool geo | `tests/unit/pool-geo*` | Egress registry + probe |
| Dockerfile closure | `tests/unit/dockerfile-mysql2-closure.test.js` | The mysql2 COPY lines stay alive |
| Headroom chat core | `tests/unit/headroom-chat-core.test.js` | The sidecar never breaks the core |
| Peer headers | `tests/unit/custom-server-peer-headers.test.js` | Hop-by-hop hygiene |

**sql.js caution:** the WASM adapter has a small default heap — a fresh boot chain + extra statements can hit "out of memory". Give each test its own temp `DATA_DIR`/adapter, or force the native driver (`VELA_DB_DRIVER=node:sqlite`) for heavier assertions.

---

## 🔧 Workflows by Task Type

### Adding a provider
1. Copy `open-sse/providers/registry/openai.js` → `<slug>.js`
2. Declare: id, aliases, auth style, endpoints, models, display metadata
3. Add models to `open-sse/config/providerModels.js`
4. `node scripts/migrate-registry.mjs` (regenerates `registry/index.js`); `node scripts/injectDisplayToRegistry.mjs` adds display names
5. Add an executor **only** if the upstream is NOT OpenAI-compatible
6. Verify: `curl $VELA_URL/v1/models/<kind>` shows the new id; a test request round-trips

### Adding a migration
1. `src/lib/db/migrations/<NNN>-<name>.js` — export `{ version, name, up, down }`
2. **Portable adapter surface** — `db.all("PRAGMA table_info(...)")` + `db.exec(...)`. Never `db.prepare`.
3. Bump `SCHEMA_VERSION` in `src/lib/db/schema.js` AND register in `migrations/index.js`
4. If the twin needs the column: add to `TABLES` (additive diff picks it up)
5. Prove it on sql.js — mirror the pattern in `key-acl-migration-013.test.js`

### Adding a translator
1. Create `open-sse/translator/request/<from>-to-<to>.js` / `response/<from>-to-<to>.js`
2. `register(from, to, reqFn, resFn)` as an import side effect
3. ⚠️ **Import the file in `open-sse/translator/index.js`** or it never runs
4. Use `schema/` constants — never hardcode roles/block strings
5. Prefer a direct route for fragile pairs (thinking blocks, tool ids)

### Fixing a fallback-rules bug
1. Reproduce with the pure matcher: `node -e "import('./open-sse/services/fallbackRuleMatcher.js')..."` or the seam test
2. Fix in `fallbackRuleMatcher.js` (pure) or `combo.js` (wiring)
3. Run `tests/unit/fallback-rules-seam.test.js` + `tests/unit/fallback-rule-matcher-v2.test.js`
4. If you change the DB shape: migration + `TABLES` + `SCHEMA_VERSION` + sql.js test

### Touching the dashboard UI
1. Find the page under `src/app/(dashboard)/dashboard/`
2. Reuse `src/shared/components` — never hand-roll a Modal/Button/Toggle
3. Use design tokens (`globals.css`) — never hard-coded hex
4. Verify: `npm run build` (152 pages compile), then exercise empty/loading/error states

### Touching the Dockerfile
1. Keep the mysql2 closure COPY lines intact (a test guards them)
2. Keep builder-scoped `VELA_DB_DRIVER=node:sqlite` (arm64 QEMU SIGILL)
3. Keep HEALTHCHECK + STOPSIGNAL + OCI labels
4. Run `tests/unit/dockerfile-mysql2-closure.test.js`

### Touching custom-server.js
1. Never weaken IP derivation (TCP socket) or the hop-by-hop strip
2. Keep graceful drain + h2c body guard
3. Run `tests/unit/custom-server-peer-headers.test.js`

---

## 📏 Code Conventions

- **Config-driven, DRY, camelCase.** NEVER hardcode values, models, or block/role strings — use `open-sse/config/` + `open-sse/translator/schema/` constants.
- **The Shores' metaphor is welcome but never required** — comments may speak of harbors and tides; identifiers stay precise. A variable named `connections` is a list of connections, not a fleet.
- **Import style** — `@/` aliases for `src/`; relative paths inside `open-sse/`; ESM throughout (`.js` with `"type": "module"` context).
- **Every exported symbol** that changes must have its references updated — search before you rename.
- **Every change carries a written reason** — in the commit body, one line per decision (R-31 Keystone).
- **Fail-open everywhere optional** — new optional subsystems must degrade to defaults, never throw.

---

## 🛠️ Common Operations — Full Runbooks

### Run the dashboard locally
```bash
npm install
npm run dev          # Next dev (custom server not loaded)
npm run build        # production build (standalone)
node custom-server.js   # production server (IP stamp + h2c + drain)
```

### Run the tests
```bash
cd tests && npx vitest run              # the whole suite
cd tests && npx vitest run unit/<file>  # one suite
cd tests && npx vitest run unit/fallback-rule-matcher-v2.test.js unit/user-injectors-v2.test.js
```

### Try a single matcher call
```bash
node -e "
import('./open-sse/services/fallbackRuleMatcher.js').then(m => {
  const rule = { triggerType: 'status', conditionVal: '429,503', targetModels: ['provider/b'] };
  console.log(m.ruleMatches(rule, { status: 429 }));   // true
  console.log(m.buildFallbackChain([rule], { status: 500 }));  // []
});"
```

### Deploy the chart (ZimaOS)
```bash
cd /media/SSD-Storage/AppData/vela
docker compose pull && docker compose up -d
```

---

## 🚀 The Release Runbook

Every change ships as a versioned minor (`0.9.x`). The full covenant:

1. **CHANGELOG.md** entry — the covenant's voice, matching the existing tone.
2. **package.json** version bump.
3. ⚠️ **BOTH compose charts** — `docker-compose.example.yml` (tracked) AND `docker-compose.yml` (gitignored, on disk) image pins.
4. If the docs carry numbers (providers, migrations, tests, version) — update them in the same commit.
5. Commit, push, tag, push tag:
```bash
git add -A && git commit -m "feat(...): ... (v0.9.x)"
git push origin main
git tag -a v0.9.x -m "Release v0.9.x: ..."
git push origin v0.9.x
```
6. Watch the tag build: `gh run list --repo YumamaX3/Vela --workflow "Build and Push Docker Image"`.

The tag triggers `.github/workflows/docker-publish.yml` → GHCR `ghcr.io/yumamax3/vela:<tag>` + `:latest`; `cache-warm.yml` keeps the multi-arch buildcache warm (~20 min vs cold 45–60).

---

## 📜 The Recent Tides

| Version | Tide | What it sealed |
|-|-|-|
| v0.9.27 | The Living Usage Observatory | Cached Tokens KPI (5-card band), realtime 15s KPIs, live activity 14 rows, default period = today, dead tabs swept (migration 020) |
| v0.9.26 | The AI Lab | Banded pipeline (open-sse/rtk/pipeline.js), modes, content policies, ACL at the hook (migration 017) + The Fork Ascension (19 providers, registry 126→162, migration 018, search SSRF+SSE) |
| v0.9.25 | The Governance Center | Endpoint page rebuilt around key governance — migration 016, mintKey/rotateKey chokepoint, revealSink, lifecycle 6-state, tabbed deck, MintWizard, CommandPalette |
| v0.9.24 | The Deep Audit Ascension | Settings Observatory v2 (11 sections, SettingsProvider) + Engine Exorcism (5 executors, refresh lock) + Deep Clean (NINEROUTER_*→VELA_*) |
| v0.9.23 | The Stillwater Design | Fallback Rules v2 (typed triggers, pre-call checks, chains) + Prompt Injectors v2 (variables, presets) |
| v0.9.22 | The Adapter Exorcism | fallbackRulesRepo on the portable adapter surface (boot-storm fix) |
| v0.9.21 | The Complete Purge + The Stillwater Hull | 9router string purged repo-wide; server drain + hop-by-hop; CLI rebrand `vela` |
| v0.9.20 | The Adapter Contract Fix | Migration 013 portable surface |
| v0.9.19 | The Resilience Covenant ascension | Circuit breaker, fallback-rules DB, per-key ACL, prompt injectors |
| v0.9.18 | Pool Egress Geo | poolGeo + probe, dashboard egress panel |
| v0.9.17 | Per-key ACL | 4-layer keyGate allowlists (migration 013) |
| v0.9.16 | Fallback Rules | Operator combo fallback (fallbackRulesRepo) |
| v0.9.15 | The Resilience Covenant | Circuit breaker |

---

*The Shores sail on. Read the chart, make your change, write down why, verify it, seal it. The next keeper will thank you.* 🪞⛵

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
