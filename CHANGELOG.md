# ⛵ Vela — The Ship's Log

> *Every tide leaves its mark on the log. Features set sail ✨, storms are
> weathered 🐛, the ship is refitted 🔧, and the charts are drawn 📖.*

**The Versioning Covenant** — the harbor never ships without a version. Every
change, great or small, bumps `package.json` and earns an entry in this log,
sealed together in the same commit:

| Tide | Bump | When |
|-|-|-|
| **Patch** (`0.6.x`) | the third number | fixes and small refinements |
| **Minor** (`0.x.0`) | the middle number | features — like this Harbor release |
| **Major** (`x.0.0`) | the first number | breaking tides |

**Legend**: ✨ Features · 🐛 Fixes · 🔧 Changes & Improvements · 📖 Documentation · ⚠️ Breaking · ⚙️ Internal

> *Releases below v0.6.0 were sealed under the upstream name **9Router** —
> this harbor is a pristine clone, rebranded Vela on 2026-08-13. The log
> keeps their names as they were.*

---

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