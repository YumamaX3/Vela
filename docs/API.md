# 🔌 Vela API

> *"Two doors open onto this harbor — one for the fleet that speaks in tokens,
> one for the console that steers the ship. Both answer to the same tide, and
> both keep honest books. This is the chart of every door, every key, and every
> word the harbor will refuse."*

**Covers:** the OpenAI-compatible gateway surface · the rewrite map · model
addressing · API-key authentication and the gate pipeline · the dashboard REST
surface (**255 routes, 38 groups**, measured 2026-10-28, at **v1.2.5**) · the
settings write door · error shapes.

---

## Table of Contents

- [The Two Doors](#-the-two-doors)
- [The Rewrite Map](#-the-rewrite-map)
- [Model Addressing](#-model-addressing)
- [Authentication](#-authentication)
- [Chat, Messages & Responses](#-chat-messages--responses)
- [Models](#-models)
- [Media, Search & Fetch](#-media-search--fetch)
- [The Dashboard REST Surface](#-the-dashboard-rest-surface)
- [The Settings Write Door](#-the-settings-write-door)
- [Error Shapes](#-error-shapes)
- [Status Codes](#-status-codes)
- [CORS & Headers](#-cors--headers)

---

## 🚪 The Two Doors

Vela speaks two protocols from one port (`32060` by default). They are not the
same surface, and they do not share an authentication posture.

| Door | Prefix | Who calls it | Credential |
|-|-|-|-|
| **The gateway** | `/v1/*`, `/v1beta/*`, `/codex/*`, `/responses` | LLM clients — Claude Code, Codex, Cursor, curl, any OpenAI-compatible SDK | a per-request API key (`Authorization: Bearer vela-…`) |
| **The dashboard REST** | `/api/*` (not `/api/v1`, `/api/v1beta`) | the dashboard UI, the `vela` CLI, operator scripts | a JWT cookie (`vela_auth_token`) or the local CLI token |

Three things worth holding before the first call.

**`/v1` is a rewrite, not a directory.** Nothing lives at `/v1` on disk;
`next.config.mjs` maps it onto `/api/v1/*`, and both spellings reach the same
handler.

**There is no default password and no `sk-` key.** The old `123456` was retired
(v0.9.41), the `sk-` format is rejected everywhere, and a fresh install mints
keys shaped `vela-v1-<32 hex>-<8 hex>`.

**The guard runs before the rewrite.** `proxy()` sees the pre-rewrite path —
which is why `/responses` must be named in `PUBLIC_PREFIXES`: a root-level
Responses call has to meet API-key validation at the guard, or it would sail
through as an unknown path and be refused for the wrong reason.

---

## 🔀 The Rewrite Map

The full list, in evaluation order (`next.config.mjs`, `rewrites()`):

| Client path | Lands on | Note |
|-|-|-|
| `/v1/v1/:path*` | `/api/v1/:path*` | legacy double-prefix clients |
| `/v1/v1` | `/api/v1` | — |
| `/codex/:path*` | `/api/v1/responses` | Codex CLI's route, translated to the Responses API |
| `/responses` | `/api/v1/responses` | root-level Responses |
| `/v1beta/:path*` | `/api/v1beta/:path*` | Gemini-native surface |
| `/v1beta` | `/api/v1beta` | — |
| `/v1/:path*` | `/api/v1/:path*` | the ordinary fleet path |
| `/v1` | `/api/v1` | root — re-exports the models list |

Order is the rule: `/v1/v1/…` matches before the generic `/v1/:path*` rule, and
both precede the bare `/v1`. The `/api/v1/…` and `/api/v1beta/…` spellings work
directly with no rewrite at all.

---

## 🧭 Model Addressing

Every gateway request names its model in the OpenAI shape (`{"model": "…"}`).
`parseModel()` (`open-sse/services/model.js`) understands exactly four forms:

| Form | Example | What happens |
|-|-|-|
| `provider/model` | `kr/claude-sonnet-4.5` | `kr` is the Kiro alias → provider `kiro`, model `claude-sonnet-4.5` |
| `alias/model` | `xai/grok-imagine-video` | aliases resolve through the registry |
| `combo/<name>` | `combo/flagship` | combo resolution — fallback / round-robin over its members |
| bare id | `claude-sonnet-4.5` | alias lookup first, then prefix inference |

`ALIAS_TO_PROVIDER_ID` is **derived from the registry, never transcribed**: each
entry contributes its `id`, its `alias`, and every member of `aliases[]`. On top
of that map sit five hand-seeded `MEDIA_ONLY_ALIASES` — `el` → `elevenlabs` ·
`jina` / `jina-ai` → `jina-ai` · `polly` / `aws-polly` → `aws-polly` — kept there
because those lanes carry no `transport` and so are not part of the dialable
set's addressing.

**Prefix inference** — the last resort, first match wins, fallback `openai`
(`MODEL_PREFIX_PROVIDERS`):

| Pattern | Provider |
|-|-|
| `codex-auto-review` (exact) | `codex` — Codex CLI's bare virtual auto-review model, kept on OAuth |
| `claude-` | `anthropic` |
| `gemini-` | `gemini` |
| `gpt-` | `openai` |
| `o1` / `o3` / `o4` | `openai` |
| `deepseek-` | `openrouter` |

**The combo namespace is reserved.** A combo may not be *named* with a leading
`combo/` (`src/shared/constants/comboValidation.js` refuses it), because that
prefix is how addressing tells a combo from a provider — though combo names may
themselves carry slashes (`vela/cc/opus`, v0.9.39).

> 📌 **No alias is claimed twice today.** `gcli` once pointed at both
> `gemini-cli` and `grok-cli`; `gemini-cli` now declares *no* alias and carries a
> comment saying why. Registry order still decides a collision, so prefer the
> full id in anything durable.

---

## 🔑 Authentication

**The key format.** A key is `vela-v1-<keyId>-<crc>` — a 32-hex (128-bit
CSPRNG) `keyId` that is the row's primary key and a non-secret attribution id,
and an 8-hex HMAC-SHA256 of `"v1."+keyId` under `API_KEY_SECRET` that serves as
a typo filter and stateless pre-reject, never as the authentication decision.
A key carries **no machineId**; the `sk-` format is rejected before any database
read; and the full key is returned **once** (`201`), stored **only** as a
SHA-256 hash, and never retrievable again.

`extractApiKey()` accepts `Authorization: Bearer <key>`, `x-api-key: <key>`, or
`x-goog-api-key: <key>`. A key in the query string is refused at the guard,
before any handler runs, with **400** `query_param_key_rejected`:

```json
{ "error": { "code": "query_param_key_rejected", "message": "API keys in query parameters are not accepted. Use the Authorization: Bearer header." } }
```

**When a key is required.** The switch is the stored **`requireApiKey`
setting** (dashboard → Endpoint → Security, or the Keys masthead), **default
`true`**.

> ⚠️ **`.env.example` line 20 documents `REQUIRE_API_KEY=false`, and nothing
> reads it.** Measured across `src/`, `open-sse/`, `custom-server.js` and
> `cli/`, there is no live reader: an operator who sets that env var to `true`
> believes the endpoint is protected and has changed nothing. Recorded in
> [`CHANGELOG.md`](../CHANGELOG.md) (v0.9.87) as a known falsity in the
> template, not silently corrected.

With `requireApiKey === false`, `authorizeApiRequest()` skips the identity and
ACL stages and returns `{ ok: true, key: null, skipped: true }` — but the
gateway/model budget stages still bind, because a cap keyless traffic can walk
around is not a cap.

**The gate pipeline** (`src/sse/services/keyGate.js`). `authorizeApiRequest(
request, { requestModel, comboModels, settings, kind })` runs stages
cheapest-denial-first and returns the first refusal:

| # | Stage | What it enforces |
|-:|-|-|
| 1 | `lifetimeStage` · `ipStage` | `expiresAt`; then the CIDR allowlist against the socket-stamped client IP |
| 2 | `rateStage` · `spendStage` | a sliding 60 s window per keyId; then the token and spend caps over `daily`/`weekly`/`monthly`/`yearly` |
| 3 | `kindStage` · `providerStage` · `comboStage` | the three tri-state ACL dimensions |
| 4 | `modelScopeStage` | `allowedModels` — a combo passes only if **every** member is in scope |
| 5 | `budgetStage` | the Observatory hierarchy (`gateway`/`key`/`model`), with distinct 429 codes |

Every ACL column is **tri-state**: `null` = unrestricted · `[]` = deny
everything · `["x","y"]` = whitelist. The kinds a key can be scoped to
(`SERVICE_KINDS`): `llm`, `embedding`, `image`, `imageToText`, `tts`, `stt`,
`webSearch`, `webFetch`, `video`, `music`, `web`.

**The machine token — `x-vela-cli-token`.** The `vela` CLI authenticates
without a password using a token derived from the machine id plus a per-install
salt (`vela-cli-auth`). It is honoured **only from a local origin** — locality
before credential. A loopback caller with a valid token is admitted; a **remote**
caller with one is refused **403** (`Forbidden: CLI token is only accepted from
local origins`); a remote caller with no credential gets **401** (`API key
required for remote API access`). Localness is `isLocalRequest()`: the
socket-derived IP, proven by the per-process `x-9r-peer-token`, plus a loopback
Host/Origin — and any request stamped `x-9r-via-proxy` is *not* local, because
the loopback socket is then the proxy hop, not the end user. Client-supplied
`x-forwarded-for` is stripped at the helm unless the peer is a loopback proxy, so
the IP stages cannot be spoofed by a header.

**The CSRF second lock.** A request the browser labels `sec-fetch-site:
cross-site` carrying a mutating method (`POST`/`PUT`/`PATCH`/`DELETE`) is
refused **403** at the top of `proxy()`, above every auth branch. Exempt by
name, never positionally (`CROSS_SITE_EXEMPT_PREFIXES`): `/api/auth/saml`,
`/api/auth/oidc` (an IdP posts a signed assertion cross-site *by protocol* — the
assertion is the credential), the LLM prefixes, every safe method, and any
caller sending **no** `Sec-Fetch-Site` at all (curl, the CLI, another agent).

**Public paths** need no credential. `PUBLIC_API_PATHS`: `/api/health`,
`/api/init`, `/api/locale`, `/api/auth/login`, `/api/auth/logout`,
`/api/auth/status`, `/api/auth/oidc`, `/api/auth/saml`, `/api/version`,
`/api/settings/require-login`. `PUBLIC_PREFIXES` (the LLM surface, which keys
itself inside the handler): `/v1`, `/v1beta`, `/api/v1`, `/api/v1beta`,
`/codex`, `/responses`.

---

## 💬 Chat, Messages & Responses

Every gateway route lives under `src/app/api/v1/` (or `v1beta/`) and answers
`OPTIONS` with permissive CORS. Examples assume:

```bash
export VELA="http://localhost:32060"
export VELA_KEY="vela-v1-…"     # Dashboard → Keys → Create
```

| Method | Path | Handler | Purpose |
|-|-|-|-|
| `POST` | `/v1/chat/completions` | `handleChat` | the canonical OpenAI chat surface |
| `POST` | `/v1/messages` | `handleChat` | **Claude-native** body — auto-translated |
| `POST` | `/v1/messages/count_tokens` | inline estimate | Anthropic-shaped count (`ceil(chars / 4)`) |
| `POST` | `/v1/responses` | `handleChat` | OpenAI Responses API (format auto-detected) |
| `POST` | `/v1/responses/compact` | `handleChat` + `_compact` | context compaction over the same pipeline |
| `POST` | `/v1/api/chat` | `handleChat` + Ollama transform | Ollama-compatible wrapper (default `llama3.2`) |
| `POST` | `/v1beta/models/{model}:generateContent` | via `[...path]` | Gemini-native; `:streamGenerateContent` for SSE |

```bash
# Chat completions
curl -sS "$VELA/v1/chat/completions" \
  -H "Authorization: Bearer $VELA_KEY" -H "Content-Type: application/json" \
  -d '{"model":"kr/claude-sonnet-4.5","messages":[{"role":"user","content":"hi"}],"stream":true}'

# Claude-native messages — the same handler, a different body dialect
curl -sS "$VELA/v1/messages" \
  -H "Authorization: Bearer $VELA_KEY" -H "Content-Type: application/json" \
  -d '{"model":"kr/claude-sonnet-4.5","max_tokens":256,"messages":[{"role":"user","content":"hi"}]}'

# Responses API — also reachable as /responses and /codex/*
curl -sS "$VELA/responses" \
  -H "Authorization: Bearer $VELA_KEY" -H "Content-Type: application/json" \
  -d '{"model":"kr/claude-sonnet-4.5","input":"hi"}'
```

`/v1/messages/count_tokens` takes the same Claude body and answers
`{"input_tokens": n}` locally, with no upstream call.

> 📌 **Streaming is SSE** (`text/event-stream`). An upstream error arriving after
> HTTP 200 is reported in-band, not by a second status line. The Gemini route
> decides streaming from the URL action suffix — never from a body field.

---

## 📚 Models

| Method | Path | Purpose |
|-|-|-|
| `GET` | `/v1/models` | OpenAI-compatible list — **LLM/chat models only** |
| `GET` | `/v1/models/{kind}` | filtered by capability |
| `GET` | `/v1/models/[...model]` | registry-shaped model path (per-provider catalogs) |
| `GET` | `/v1/models/info?id={alias}/{modelId}` | metadata for one model |
| `GET` | `/v1beta/models` | the same catalog in Gemini format |

Supported `{kind}` slugs (`KIND_SLUG_MAP`): `image`, `tts`, `stt`,
`embedding`, `image-to-text`, `web` — where `web` covers both `webSearch` and
`webFetch`. An unknown slug answers **404** naming the supported list; it never
invents an empty one.

```bash
curl -sS "$VELA/v1/models" -H "Authorization: Bearer $VELA_KEY"
curl -sS "$VELA/v1/models/image" -H "Authorization: Bearer $VELA_KEY"
curl -sS "$VELA/v1/models/info?id=kr/claude-sonnet-4.5" -H "Authorization: Bearer $VELA_KEY"
```

**Scope narrowing, not a 403.** A key restricted by provider/combo/model ACLs
sees a *shortened* list: `scopeModelsForRequest()` filters fail-open because
visibility is not authorization, while the dispatch-time gate stays fail-closed
— a client that lists and then calls still meets the real wall. Cross-instance
recursion is guarded by `x-9r-internal-models-fetch: 1`, which tells the route
to skip its own dynamic catalog fetch.

---

## 🎨 Media, Search & Fetch

| Method | Path | Kind | Required |
|-|-|-|-|
| `POST` | `/v1/embeddings` | `embedding` | `model`, `input` |
| `POST` | `/v1/images/generations` | `image` | `model`, `prompt` |
| `POST` | `/v1/audio/speech` | `tts` | `model`, `input` (+ `?response_format=mp3\|json`) |
| `POST` | `/v1/audio/transcriptions` | `stt` | **multipart** — `model`, `file` |
| `GET` | `/v1/audio/voices` | — | `?provider=elevenlabs\|deepgram\|inworld\|edge-tts\|local-device` |
| `POST` | `/v1/videos/{generations\|edits\|extensions}` | `video` | `model` + prompt fields |
| `GET` | `/v1/videos/{id}` | `video` | poll an async job |
| `POST` | `/v1/search` | `webSearch` | `provider` (or `model`), `query` |
| `POST` | `/v1/scrape` | `webFetch` | `url` (+ the scrape options the target accepts) |
| `POST` | `/v1/web/fetch` | `webFetch` | `provider` (or `model`), `url` |
| `POST` | `/v1/systemone` | `llm` | provider-side structured-evaluation passthrough |

```bash
# Images — openai/gpt-image-1, gemini/gemini-2.5-flash-image
curl -sS "$VELA/v1/images/generations" \
  -H "Authorization: Bearer $VELA_KEY" -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-image-1","prompt":"a lighthouse in fog","size":"1024x1024"}'

# Voices first, then speech — the list returns each voice's full model id
curl -sS "$VELA/v1/audio/voices?provider=elevenlabs" -H "Authorization: Bearer $VELA_KEY"
#   → {"object":"list","data":[{"id":"…","lang":"…","model":"el/…"}]}
curl -sS "$VELA/v1/audio/speech?response_format=mp3" \
  -H "Authorization: Bearer $VELA_KEY" -H "Content-Type: application/json" \
  -d '{"model":"el/<voiceId>","input":"the harbor is quiet"}' --output voice.mp3

# Transcription is multipart — never JSON
curl -sS "$VELA/v1/audio/transcriptions" -H "Authorization: Bearer $VELA_KEY" \
  -F "model=deepgram/nova-3" -F "file=@recording.mp3"

# Web search / fetch — the provider IS the model: searxng/search, jina-reader/fetch
curl -sS "$VELA/v1/search" \
  -H "Authorization: Bearer $VELA_KEY" -H "Content-Type: application/json" \
  -d '{"model":"searxng/search","query":"harbor charts","max_results":5}'
curl -sS "$VELA/v1/web/fetch" \
  -H "Authorization: Bearer $VELA_KEY" -H "Content-Type: application/json" \
  -d '{"model":"jina-reader/fetch","url":"https://example.com","max_characters":8000}'

# Video is asynchronous and account-bound: the create sets x-vela-connection-id,
# and the poll echoes it as x-connection-id so the SAME upstream account answers.
curl -sS "$VELA/v1/videos/generations" \
  -H "Authorization: Bearer $VELA_KEY" -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-video","prompt":"a lantern on the water","duration":6}'
curl -sS "$VELA/v1/videos/<request_id>" \
  -H "Authorization: Bearer $VELA_KEY" -H "x-connection-id: <id from create>"
```

An explicit `x-connection-id` on the create pins the preferred account. Combos
are refused for video (**400**); a prefix-less model id falls back to `xai`.

---

## 🗄️ The Dashboard REST Surface

**255 route files** under `src/app/`, across **38 top-level groups** under
`src/app/api/` (measured **2026-10-28, at v1.2.5**). Every `/api/*` route is
covered by `dashboardGuard.proxy()`; the counts below sum to **255**.

Two notes before the table. The 255 is taken from the **tracked** files
(`git ls-files`), so an uncommitted route does not inflate the count; and every
one of them already lives under `src/app/api/` — the `/v1` that clients call is a
rewrite onto `/api/v1`, not a second tree. The table's 38 rows therefore sum to
the total exactly, with no remainder to explain.

| Group | Routes | What it covers | Example path |
|-|-:|-|-|
| `usage` | 27 | per-connection usage (with the `claude-reset` / `codex-reset-credits` pair), budgets & alerts, digests, request logs, the Observatory metrics family (kpis, timeseries, percentiles, ledger, breakdown, insights, health-timeline, stacked, export), saved `views`, and the live `stream` | `GET /api/usage/stats` |
| `cli-tools` | 27 | per-CLI settings writers (the `-settings` shape plus `codex-profiles`, `hermes-profiles`, and the `cowork-mcp-*` pair), the Antigravity MITM pair, and `all-statuses` | `GET /api/cli-tools/all-statuses` |
| `v1` | 24 | the gateway surface itself — see the tables above | `POST /api/v1/chat/completions` |
| `oauth` | 20 | provider OAuth flows and token imports — a generic `[provider]/[action]` plus named Codex, Cursor, GitLab, Grok CLI, iFlow, Kiro, xiaomi-mimo and Zed routes | `POST /api/oauth/kiro/auto-import` |
| `proxy-pools` | 14 | the proxy fleet — CRUD, per-pool and bulk health, fitness blocks, egress probe, export, routing ledger, and deploy routes (Cloudflare, Deno, Netlify, Vercel) | `GET /api/proxy-pools` |
| `auth` | 14 | login/logout, the session ledger (`sessions`, `[id]`, `revoke-all`), password reset, both SSO paths (OIDC ×3, SAML ×4) | `POST /api/auth/login` |
| `providers` | 13 | provider connections, model catalogs, overrides, single and batch tests, suggested models, validation, Kilo free-models, web login | `GET /api/providers` |
| `combos` | 10 | model combos — CRUD, `stats`, `bulk`, `export`, `import`, `usage`, presets, `auto-family`, `auto-free` | `GET /api/combos` |
| `settings` | 9 | settings read/write, the database export/import pair plus its maintenance, prune, prune-usage, stats and vacuum doors, `require-login`, and the proxy-test probe | `GET /api/settings` |
| `models` | 9 | aliases, custom models, availability, the disabled list, caps, deprecations, catalog sync, test ping | `GET /api/models/alias` |
| `backup` | 9 | the Storage Covenant's backup surface — `run`, `status`, `list`, `restore`, `drill`, plus artifacts, inventory, prune, purge | `POST /api/backup/run` |
| `pxpipe` | 8 | the pxpipe sidecar — health, install, start/stop/restart, logs, stats, status | `GET /api/pxpipe/status` |
| `tunnel` | 7 | the Cloudflare tunnel and the Tailscale tailnet — enable/disable, status, and the tailscale check/enable/disable/install quartet | `GET /api/tunnel/status` |
| `keys` | 7 | the API-key fleet — CRUD, `stats`, `export`, `import`, `bulk`, per-key `usage` | `GET /api/keys` |
| `translator` | 6 | the translation console — load/save, send, translate, the console-log pair (`…/stream` is SSE) | `POST /api/translator/translate` |
| `headroom` | 6 | the Headroom sidecar — status, start/stop/restart, `extras`, `proxy/[...path]` | `GET /api/headroom/status` |
| `media-providers` | 5 | TTS voice catalogs — ElevenLabs, Deepgram, Inworld, MiniMax, and the generic edge/local-device list | `GET /api/media-providers/tts/voices` |
| `logs` | 5 | the Log Pipeline — events, `events/stream` (SSE), `stats`, `export` (the richest reconnaissance surface), `clear` | `GET /api/logs/events` |
| `version` | 3 | the update horizon plus `update` and `shutdown` | `GET /api/version` |
| `provider-nodes` | 3 | logical provider nodes — CRUD plus `validate` | `GET /api/provider-nodes` |
| `pricing` | 3 | the Pricing Covenant — the effective table, static defaults, vendor `sync` | `GET /api/pricing` |
| `guardrails` | 3 | policy CRUD and the guardrail log | `GET /api/guardrails/policies` |
| `cache` | 3 | the response cache — stats, entries, `entries/[id]` | `GET /api/cache` |
| `vault` | 2 | the vault's rotation and posture reads — password-confirmed by the handler itself | `GET /api/vault/status` |
| `v1beta` | 2 | the Gemini-native surface — the model list and the `[...path]` generate/stream handler | `GET /api/v1beta/models` |
| `network` | 2 | the Network Cockpit — `status` (live enforcement state) and `diagnose` (dials operator-typed targets) | `GET /api/network/status` |
| `mcp` | 2 | MCP plugin transport — `[plugin]/sse` and `[plugin]/message` | `GET /api/mcp/[plugin]/sse` |
| `fallback-rules` | 2 | operator combo fallback rules — collection and `[id]` | `GET /api/fallback-rules` |
| `tags` | 1 | the usage ledger's tag vocabulary | `GET /api/tags` |
| `shutdown` | 1 | dev-only app shutdown (**403 in production**) | `POST /api/shutdown` |
| `nav` | 1 | the navigation pulse | `GET /api/nav/pulse` |
| `metrics` | 1 | the process metrics read | `GET /api/metrics` |
| `locale` | 1 | set the dashboard UI locale cookie | `POST /api/locale` |
| `init` | 1 | boot ping — `"Initialized"` | `GET /api/init` |
| `health` | 1 | liveness — `{"ok":true}`, the Docker `HEALTHCHECK` target | `GET /api/health` |
| `debug` | 1 | trace inspection | `GET /api/debug/traces` |
| `changelog` | 1 | the changelog the UI renders | `GET /api/changelog` |
| `analytics` | 1 | compression analytics | `GET /api/analytics/compression` |

### What moved since the last stamp

The previous stamp read **198 routes across 28 groups** (v0.9.93, 2026-09-24).
The delta is **+57 routes and +10 groups**, and it arrives two ways — ten groups
that did not exist, and ten that grew:

| Group | Then | Now |
|-|-:|-:|
| `cli-tools` | 19 | **27** |
| `oauth` | 14 | **20** |
| `v1` | 21 | **24** |
| `proxy-pools` | 12 | **14** |
| `providers` | 10 | **13** |
| `combos` | 7 | **10** |
| `backup` | 5 | **9** |
| `settings` | 4 | **9** |
| `models` | 7 | **9** |
| `usage` | 26 | **27** |

New since then: `logs` (5) · `guardrails` (3) · `cache` (3) · `vault` (2) ·
`network` (2) · `analytics` (1) · `debug` (1) · `changelog` (1) · `nav` (1) ·
`metrics` (1) = **20 routes across 10 groups**. The recasts add the other **37**.
`198 + 37 + 20 = 255`, and `28 + 10 = 38`.

Re-derive whenever a chart and a command disagree — **the command wins**:

```bash
# 255 — every tracked route file under src/app/ (measured 2026-10-28, v1.2.5)
git ls-files | grep -E '^src/app/.*route\.js$' | wc -l

# 38 — the top-level groups under src/app/api/, with their route counts
git ls-files | grep -E '^src/app/api/.*route\.js$' \
  | sed 's|^src/app/api/||; s|/route.js||' \
  | cut -d/ -f1 | sort | uniq -c | sort -rn
git ls-files | grep -E '^src/app/api/.*route\.js$' \
  | sed 's|^src/app/api/||; s|/route.js||' \
  | cut -d/ -f1 | sort -u | wc -l
```

### The auth posture — three tiers

**1 · Always protected — `ALWAYS_PROTECTED`.** A JWT (or a *local* CLI token)
is required **even when `requireLogin === false`**. Prefix match, so each entry
covers its subtree:

| Prefix | Why it escalates |
|-|-|
| `/api/shutdown` · `/api/version/shutdown` · `/api/version/update` | kills or replaces the process |
| `/api/settings/database` | exports/imports the whole store |
| `/api/backup` | `status`, `run`, `list`, `restore`, `drill`, artifacts, inventory, prune, purge — restore must never ride the open branch |
| `/api/usage/metrics/export` · `/api/usage/views` | an unbounded CSV export; saved-view writes (method-agnostic, so the GET list escalates too) |
| `/api/pricing/sync` | mutating, with server-side outbound fetches |
| `/api/oauth/cursor/auto-import` · `/api/oauth/kiro/auto-import` | touch the CLI's own credentials |
| `/api/auth/sessions` | covers `sessions`, `sessions/[id]`, `sessions/revoke-all` — a session list is reconnaissance, a revocation is a kill switch |
| `/api/network` | the Doctor dials operator-typed targets; `status` exposes live enforcement state (rate windows, IP allowlists, breaker states) |
| `/api/logs` | redacted-but-sensitive rows, `/export` as the richest reconnaissance surface, and an irreversible `/clear` |

**2 · Local-only — `LOCAL_ONLY_PATHS` + `CLI_TOOL_WRITER_RE`.** Routes that
spawn a host child process or write the operator's own `$HOME` config demand a
loopback origin **and** a JWT (or `requireLogin=false`), refusing a remote
caller with **403** `Local only: CLI token required`. Named entries:
`/api/cli-tools/cowork-settings`, `/api/cli-tools/antigravity-mitm`, `/api/mcp/`,
the **five** mutators and one probe of `/api/tunnel` — `enable`, `disable`,
`tailscale-install`, `tailscale-enable`, `tailscale-disable`, `tailscale-check`
(all but the `status` read), `/api/auth/reset-password`,
`/api/headroom/{start,stop,proxy,restart,extras}`, and
`/api/pxpipe/{install,start,stop,restart}` — plus a **shape** rule,
`CLI_TOOL_WRITER_RE = /^\/api\/cli-tools\/[a-z0-9-]+-settings$/`, because a list
of names guarantees the fourteenth is forgotten. That shape now covers far more
than fourteen: `claude`, `cline`, `codewhale`, `codex`, `copilot`, `crush`,
`deepseek-tui`, `devin`, `droid`, `forge`, `grok-build`, `hermes`, `jcode`,
`kilo`, `omp`, `openclaw`, `opencode`, `pi`, `smelt` — and the next one is
covered the day it ships. `all-statuses`, `codex-profiles`, `hermes-profiles`,
`cowork-mcp-tools` and `cowork-mcp-registry` do not end in `-settings` and stay
open to a logged-in dashboard.

**3 · Deny by default — everything else under `/api/`.** A JWT **or**
`requireLogin === false` admits it (or a local CLI token). Anything not public,
not `ALWAYS_PROTECTED`, and not local-only lands here — `cache`, `guardrails`,
`vault` (whose handler additionally demands the vault password), `analytics`,
`debug`, `changelog` and the rest.

> ⚠️ **Mutations are fail-closed by class (C1, 2026-10-11).** Tier 3's
> posture-consistent pass is a **READ** pass. Any mutating method
> (`POST`/`PUT`/`PATCH`/`DELETE`) on a tier-3 route requires a JWT, the local
> CLI token, or the box's own console (loopback stamp + posture) — even when
> `requireLogin === false`. A credential-less **remote** mutation is refused
> with **401** (`Unauthorized: mutating /api routes require a session or the local
> console`); a remote caller presenting only the machine CLI token is refused
> with **403** (the token is locality-bound). This is what keeps a first-password
> mint (`PATCH /api/settings` with `newPassword`, no `currentPassword`) out of
> an attacker's reach on an exposed no-login deployment.
>
> ⚠️ **`/api/proxy-pools` is fail-closed and method-aware.** The deny-by-default
> branch would otherwise pass the whole prefix when `requireLogin === false` —
> including the deploy routes that mint open forward proxies — so the guard
> carries a read allow-list (`PROXY_POOLS_POSTURE_READS`): only
> `/api/proxy-pools`, `/api/proxy-pools/fitness`, `/api/proxy-pools/export` and
> `/api/proxy-pools/stats`, and only on `GET`. Every mutation — and every
> **unlisted** read — needs a JWT, a local CLI token, or a loopback browser
> (`isLocalRequest` + posture). `OPTIONS` passes unconditionally (no body, no
> action). The locality escape is load-bearing: without it, the documented
> no-password first run would 401 every pool mutation.

### Dashboard session

| Item | Value |
|-|-|
| Cookie | `vela_auth_token` (HttpOnly; `AUTH_COOKIE_SECURE` sets the Secure flag) |
| Minted by | `POST /api/auth/login` (`password`, optional `label`), or an SSO callback |
| Ledger | migration `016` — `authSessions` keyed by the JWT's `jti`, so a stateless token can still be listed and revoked |
| Lockout | `authFailures` — a durable ladder, one row per caller, surviving a restart |
| SSO | `POST /api/auth/oidc/start` → `/api/auth/oidc/callback`; `POST /api/auth/saml/start` → `/api/auth/saml/acs` |
| Posture read | `GET /api/auth/status` — presence flags only (`hasPassword`, `oidcConfigured`, `samlConfigured`, `authenticated`) |

```bash
curl -sS -c jar.txt -X POST "$VELA/api/auth/login" \
  -H "Content-Type: application/json" -d '{"password":"…","label":"cli"}'
curl -sS -b jar.txt "$VELA/api/auth/sessions"
```

---

## 🩹 The Settings Write Door

`PATCH /api/settings` is the **single** write surface for stored settings, and
it is deliberately narrow — the hardening is CWE-915 (mass assignment). The
order below is load-bearing:

| # | Step | Detail |
|-:|-|-|
| 1 | **Delete the protected keys** | `PROTECTED_SETTING_KEYS = ["password", "mitmSudoEncrypted"]` leave the body before any branch can honour them |
| 2 | Password path | `newPassword` + `currentPassword` → bcrypt; a first-time set needs no current password, a wrong one afterwards answers **401**, and the retired `123456` is never accepted as the current one |
| 3 | `oidcClientSecret` normalization | an empty or whitespace value is dropped, so a blank field cannot erase the stored secret |
| 4 | `budgetAlerts` deep-merge | merged field-by-field, because a shallow merge would clobber stored webhook URLs; an empty URL means *keep the stored one* |
| 5 | **The allow-list filter** | `ALLOWED_SETTING_KEYS = new Set(WRITABLE_SETTING_KEYS)`; anything undeclared is **dropped loudly** (`console.warn("[settings] ignoring non-settings keys: …")`), never silently written |
| 6 | Write | `updateSettings(body)`, then side effects (outbound-proxy env, combo rotation reset) |

```bash
curl -sS -b jar.txt -X PATCH "$VELA/api/settings" \
  -H "Content-Type: application/json" \
  -d '{"requireApiKey":true,"comboStrategy":"fallback"}'
```

`WRITABLE_SETTING_KEYS` is **derived, not transcribed**: the **62** keys of
`DEFAULT_SETTINGS` (`src/lib/db/repos/settingsDefaults.js`) plus **10** located
extras — `password`, `ccFilterNaming`, `providerThinking`, `poolGeoProbeEnabled`,
`fallbackStrategy`, `userInjectors`, `claudeAutoPing`, `codexAutoPing`,
`headroomCodeAware`, `headroomKompress` — for **72** writable keys in all. A
setting the dashboard persists with no default must be declared here or the route
will drop it.

```bash
node --input-type=module -e "import('./src/lib/db/repos/settingsDefaults.js').then(m=>console.log(Object.keys(m.DEFAULT_SETTINGS).length, m.WRITABLE_SETTING_KEYS.length))"  # 62 72
```

> 🔒 **The read side redacts too.** `GET /api/settings` strips `password` and
> `oidcClientSecret` and replaces `budgetAlerts`' URLs with presence flags
> (`hasDiscordWebhook`, `hasN8nWebhook`) — a Discord webhook URL *is* a token.
> It answers `Cache-Control: no-store`. Sibling doors: `GET|POST
> /api/settings/database` (the export/import pair, behind the `x-9r-password`
> header or a CLI token), its `maintenance`, `prune`, `prune-usage`, `stats` and
> `vacuum` companions, `GET /api/settings/require-login`, and
> `GET /api/settings/proxy-test`.

---

## 🧨 Error Shapes

**Gateway errors** are OpenAI-compatible (`buildErrorBody()`,
`open-sse/utils/error.js`), and the key gate appends its own code in
parentheses to the message, so a client can match on `error.code` or read the
trailing token:

```json
{ "error": { "message": "Invalid API key (invalid_api_key)",
             "type": "authentication_error", "code": "invalid_api_key" } }
```

| Code | Status | Meaning |
|-|-:|-|
| `invalid_api_key` | 401 | missing, malformed, unknown — or an internal key on an external path |
| `key_paused` | 403 | the key row is inactive |
| `key_expired` | 401 | past `expiresAt` |
| `ip_not_allowed` | 403 | outside the key's CIDR allowlist, or the address could not be proven |
| `rate_limited` | 429 | the sliding 60 s window is full |
| `budget_exceeded` | 429 | a token or spend cap is crossed |
| `model_not_allowed` | 403 | kind, provider, combo, or model outside the key's ACL |
| `query_param_key_rejected` | 400 | `?key=` was used |

The Observatory budgets add distinct 429 codes above `budget_exceeded`:
`gateway_budget_exceeded`, `key_budget_exceeded`, `model_budget_exceeded`.

**Guard errors** are plain strings: `{"error":"Unauthorized"}` ·
`{"error":"API key required for remote API access"}` ·
`{"error":"Forbidden: CLI token is only accepted from local origins"}` ·
`{"error":"Forbidden: cross-site mutation refused"}` ·
`{"error":"Local only: CLI token required"}` ·
`{"error":"Unauthorized: mutating /api routes require a session or the local console"}`.

**Dashboard handler errors** are `{ "error": "<message>" }` with a
route-specific status — `400` for a bad payload, `401` for a bad password, `403`
for a blocked route, `429` with `Retry-After` for the login ladder, `500` for an
internal failure. Login and reset-password deliberately do **not** echo an
internal message; the detail goes to the server log. `POST /api/keys` answers
**201** with the one-time key — the only response that ever carries one.

**Upstream failures** arrive in the same OpenAI shape, carrying the provider's
status where one exists. A fully rate-limited fleet answers **503**
(`unavailableResponse`) with `Retry-After`; `classify429` splits the three
meanings of an upstream 429 into short-transient (60 s), quota-exhausted (1 h),
and daily (until the next 00:00 UTC) cooldowns.

---

## 📊 Status Codes

| Code | Where it comes from |
|-:|-|
| `200` | success; streaming replies begin as `text/event-stream` |
| `201` | `POST /api/keys` — the only response carrying a full key |
| `204` | `OPTIONS` preflight on `/api/health` |
| `400` | malformed JSON, missing required field, `?key=` used, unknown `{kind}` |
| `401` | no credential, unknown or expired key, bad dashboard password, a remote mutation on a tier-3 route |
| `403` | paused key, ACL denial, IP not allowed, local-only route from remote, cross-site mutation, remote machine token, password login disabled |
| `404` | unknown service kind on `/v1/models/{kind}`; unknown route |
| `405` | the route exists but not for that method (Next's own refusal) |
| `429` | key rate window, token/spend cap, login lockout ladder |
| `500` | internal error |
| `502` | upstream provider error passed through |
| `503` | the fleet is rate-limited (`unavailableResponse`) or a provider is unreachable |
| `504` | upstream timeout |

The canonical table is `HTTP_STATUS` in `open-sse/config/runtimeConfig.js`, with
its client-facing type map in `open-sse/config/errorConfig.js`.

---

## 🌐 CORS & Headers

| Header | Value | Set by |
|-|-|-|
| `Access-Control-Allow-Origin` | `*` | every gateway route and the health check |
| `Access-Control-Allow-Methods` | per route — e.g. `GET, POST, OPTIONS` | each `OPTIONS` handler |
| `Access-Control-Allow-Headers` | `*` | each `OPTIONS` handler |
| `Cache-Control` | `no-store` | `/api/settings` |
| `x-vela-connection-id` | the account that created a video job | video `POST` responses |
| `x-9r-real-ip`, `x-9r-peer-token` | the socket-derived client IP and its proof | `custom-server.js`, read by the key gate |
| `x-9r-via-proxy` | "this request arrived through a reverse proxy" — forces `isLocalRequest()` false | `custom-server.js` |
| `x-9r-password` | re-confirmation for database export/import | caller-supplied |
| `x-9r-internal-models-fetch: 1` | "this `/models` fetch is another Vela" | caller-supplied |
| `poweredByHeader` | `false` | `next.config.mjs` |

Client-supplied `x-forwarded-for` / `x-real-ip` are **stripped** at the helm
unless the peer is a loopback proxy, so the gate's IP stages cannot be spoofed.

---

## 🔗 See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) — the request lifecycle behind every route
- [PROVIDERS.md](./PROVIDERS.md) — which providers a model name can reach
- [ENVIRONMENT.md](./ENVIRONMENT.md) — the env contract, and which vars are live
- [STORAGE.md](./STORAGE.md) — what the backup and database doors touch
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — 401s, 403s, and empty streams

— *Vela · The Sail of the Ship* ⛵
