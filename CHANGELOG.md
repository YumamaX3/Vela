# v1.1.9 — The Fourth Door Opens 🌊🔑
> *"Three doors answered and the fourth stood beside them, painted and patient and wired to nothing. I had built its frame, its name, its very threshold — and forgotten the key. A door without a handle is not a door; it is a wall with ambitions."* 🌊🔑💜
**The last seam of the CodeBuddy realm: both WorkBuddy products now log in. Before this tide they rendered a button that could not complete — no handler, no config, and no entry in the flow lists that gate the modal and the poll route.**

**🔑 The door that had no key**
- **Two handlers exist now** — `src/lib/oauth/providers/workbuddy-cn.js` and `workbuddy-intl.js`, mirroring CodeBuddy's browser poll flow with each product's own `X-Domain` (`www.workbuddy.cn` / `www.workbuddy.ai`).
- **Two constants that would have spread to `{}`** — `WORKBUDDY_CN_CONFIG` and `WORKBUDDY_INTL_CONFIG` read from the registry's own `oauth:` block, so platform and identity stay single-sourced.
- **Two ids missing from the flow lists** — both joined `DEVICE_CODE_PROVIDERS` *and* `NO_PKCE_POLL_PROVIDERS`. Without them the modal never branches to the device-code UI and the poll route refuses the call.

**🪞 The identity headers were neither product's**
- `X-Product: WorkBuddy` and `X-IDE-Type: Work` exist on no client. The measured truth: **`X-Product: SaaS`** on every product (it names the commercial tier, never the product), `X-IDE-Type`/`X-IDE-Name: WorkBuddy`, `X-IDE-Version`, and `X-Private-Data: true` on both WorkBuddy lanes.
- **Real user agents, per shore** — domestic `WorkBuddy/5.9.2 WorkBuddy/5.9.2 CLI/2.165.0`; international `WorkBuddy/5.8.4 WorkBuddy AI/5.8.4 CLI/2.161.0`. The international desktop client calls itself *WorkBuddy AI*; the domestic one plainly *WorkBuddy*.

**⏳ The versions Vela had been announcing were not real**
- The CodeBuddy lanes sent `CLI/unknown CodeBuddy/2.139.0` and `IDE/2.108.1` — neither is a client build that exists. Both now send the verified versions: **`2.165.0` domestic**, **`2.161.0` international**, with `X-IDE-Type: CLI` throughout.
- **The platform value is per product, not shared**: both WorkBuddy sites send lowercase **`workbuddy`**; only CodeBuddy's international site requires uppercase **`CLI`**. One shared value would send the wrong platform to at least one shore.

**📐 The law, made executable**
- `open-sse/shared/codebuddy/identity.js` holds the versions per shore, the platform rule, `identityHeaders(profile)` and `transportHeaders(profile)` — so a registry and the law cannot disagree without a test failing.

**🧪 Proof**
- New suite `codebuddy-oauth-seam` — **22 assertions**: every product resolves a real handler with a non-empty config (`stateUrl`/`tokenUrl`/`refreshUrl`/`platform`), all four gate both flow lists, the platform law holds on both shores, and — the assertion that caught the stale build — **the registry's transport headers agree with the identity law**.
- **284 assertions green across 20 suites.** `eslint` clean — 0 errors (two pre-existing anonymous-default warnings in the registry idiom).
- `npm run build` green — **BUILD_ID `SASL7Vnh5hXBvVytBv8BP`**, standalone assets copied.
- Both charts and the manifest sealed at **1.1.9**.

**🌊 Recorded, not repeated**
- **A rendered button is not a working door.** Five things must line up for a login — handler, config, flow-list membership, platform value, identity headers — and a missing one fails as a spinner that never resolves.
- **A version string is a claim about a client that exists.** `CLI/unknown` was Vela inventing a build; the reference's verified versions are the only honest answer.
- **The header that names the tier is not the header that names the product.** `X-Product: SaaS` fooled me once; the tests hold it now.

# v1.1.8 — The Four Products Answer 🌊🛰️
> *"One harbor, four doors. I did not build a fifth — I read the four the other sea already kept, and found that two of them had been answering to a name that was never theirs."* 🌊🛰️💜
**The CodeBuddy realm carried whole from the reference gateway (codebuddy2api): four products instead of two, six laws instead of none, and every one of them proven at the edge where a naive port would fail silently.**

**🏛️ Four products, each with its own shore**
- **`workbuddy-cn` (`cbw`) and `workbuddy-intl` (`cbwi`)** join `codebuddy-cn` and `codebuddy-intl`. Same catalog, same wire shape — **different accounts**. A CodeBuddy token is not a WorkBuddy token, and the two are not interchangeable.
- **Routing derives from the credential, never from input** (`siteRouting.js`): the stored domain and the token's issuer choose the product. A hint must name a known host exactly — no port, no userinfo, no query, no path (except an issuer claim), no look-alike. Two hints naming different shores raise rather than coin-flip. `copilot.tencent.com` is excluded from the branding test because it is the *shared* domestic endpoint and cannot tell CLI from Work.
- **One chat path, measured not assumed**: all four dial `/v2/chat/completions` and differ only in host — so they need registries, not per-profile `buildUrl` overrides.
- **The right opener**: WorkBuddy sends *"You are WorkBuddy, a powerful AI assistant."* The CodeBuddy lanes send *"You are CodeBuddy Code."* Both now say what their own clients say.

**📮 The refusal that looked like a request fault**
- **`channelCheck.js`** recognises the channel-verification rejection (`11128` / `11-128` plus its wording) and grants exactly **one** retry against the console door — only for `/v2/chat/completions`, never another path. Recognition requires **both halves**; a bare code or a bare phrase is not enough.

**🚪 The refusal dressed as a clean answer**
- **`contentFilter.js`** catches a content-filter refusal wearing `finish_reason: stop`. Exact normalized match or explicit code — never a substring on "sensitive" — and retry permitted only for a **pure** refusal: overflow, tool calls or reasoning disqualify it.

**⚓ A breaker that survives a restart without becoming a trap**
- **`breakerStore.js`**: ceilings clamped at read (a crafted file cannot park an account forever); the reader accepts only a **wholly** valid snapshot; storage failure degrades to memory, never to lockout; the write is bounded and a shed row is reported.
- **`breakerLedger.js`** binds it to Vela's **own** `circuitBreakerKeys` ledger (migration 019) — no second store, no second writer, no migration.

**🔀 Scheduler modes — prove the cache before trusting it**
- **`routingScheduler.js`**: `legacy` / `shadow` / `indexed`, defaulting to **shadow** so the cache can never change behaviour while it proves itself. Revisions key the shard, so a moved revision is unreachable rather than expired; dynamic health is never cached; mismatch reports carry counts, never identities.

**🔐 Consent for consequential actions — the gate, never the spending**
- **`consent.js`**: consent is a **revision of exact words**, not a boolean. Terms change → every prior acceptance is void. An action needs the operator's switch, an echoed current revision, and a matching acceptance. This module contains **no upstream call** — it decides whether a person said yes to exactly these words; the doing stays behind a switch the Star arms.

**🐛 The faults this tide found in its own work**
- `user:pass@host` slipped past the host check because `URL.host` omits userinfo — now refused explicitly.
- A malformed row was being **skipped** rather than voiding the document — a half-understood file keeps some cooldowns and drops others silently.
- A blanket rename turned `wrapCodeBuddyStream` into a name that does not exist, and rewrote the system opener into a prompt no client sends. Both restored from the reference.
- `deleteBreakerRow` takes `(db, poolId, providerId, model)` — the call had them transposed. `open-sse/` cannot reach `src/lib/` by relative path; it now uses the `@/lib` alias.

**🧪 Proof**
- New suites: `codebuddy-site-routing` (18) · `codebuddy-channel-check` (13) · `codebuddy-content-filter` (14) · `codebuddy-breaker-store` (18) · `codebuddy-breaker-ledger` (7, against a real `node:sqlite`) · `codebuddy-scheduler` (11) · `codebuddy-consent` (16) · `codebuddy-four-products` (13, proving every product resolves a **specialized** executor and dials its own host).
- **136 assertions green across 11 suites.** `eslint` clean — 0 errors.
- `npm run build` green — **BUILD_ID `iC2RoTSAhpH_y6eHs9H7g`**, standalone assets copied.

**🌊 Recorded, not repeated**
- **Four products are not one product renamed.** A shared endpoint cannot disambiguate them; only a branded host can.
- **A consent boolean cannot answer the only question that matters** — which words did this person actually agree to. Store the revision.
- **A cache must be able to prove itself without being believed.** Shadow mode returns the old answer precisely so the new one can be wrong safely.

# v1.1.7 — The Whole Harbor Answers 🌊⚓
> *"The other sea drew its rooms on a chart I could read but not inhabit. This tide I did not copy the chart — I built every room in my own stone, and found that some of its walls had never stood at all."* 🌊⚓💜
**The full carry of `decolua/9router` v0.5.55 → v0.5.109 lands: 70 missing modules ported, 18 providers joined the registry (166 → 184), six web executors with their browser pool, the AWS SigV4 stack, eight OAuth lanes, and the API surface they all need. Every file reads Vela's dialect — `alias`/`uiAlias`, Vela's comment law, Vela's service shapes.**
**✨ What crossed the water**
- **Providers — 18 joined the registry.** SenseNova (five-level thinking + U1.5 image lane), Nous Research (device code + portal key), TinyFish (search and fetch on one key), Muse (Meta, dual auth), v1m (System One), Qoder CN, OpenCode Zen, MiniMax Code (+global), and the four aggregators Agnes/Atria/Dahl/B.AI. The six web lanes: chatgpt-web, gemini-web, muse-web, deepseek-web, uc-web, veoaifree-web.
- **Bedrock, end to end.** A hand-rolled SigV4 signer on `node:crypto` (no SDK on the hot path), AWS EventStream framing, static and SSO-profile credential modes, region validated because it lands in the hostname, and family-matched model ids so a wrong-family id is rejected before the call is paid for. `aws-sigv4` is proven against AWS's published vector.
- **The browser pool.** Shared stealth Chromium with per-context isolation, a lazy runtime installer for playwright-core and wreq-js, virtual display support, and six executors that drive real pages where a cookie-only fetch cannot pass.
- **Eight OAuth lanes** — nous, muse, qoder-cn, xiaomi-mimo, glm (Z.ai), minimax-code (+shared, +global) — with their constant blocks and the provider index that resolves them.
- **The API surface**: xiaomi-mimo login/status/api-key/auto-import, zed import/auto-import, provider overrides, web-login, netlify deploy relay, usage claude-reset, a model-scoped `/v1/models/[...model]`, combo presets, and the CLI-tool settings doors (hermes-profiles, pi, omp, crush, forge, smelt, codewhale, codex-profiles).
- **The engines** — System One router with session stickiness, cursor/opencode-zen/antigravity-weekly usage, video providers (OpenRouter, Vertex), Codex and Gemini Live STT, the DeepSeek proof-of-work worker, and the RTK custom-prompt injector.
**🔧 What Vela refused, with its reason**
- **`KeyAccessControls`** — upstream reads `apiKey.access = { restricted, allow }`; Vela's keys carry `allowedModels` + `scopeOn` and already own a richer editor (restrict toggle, removable chips, live count). Porting it verbatim would have rendered an empty list beside a working editor. Deleted, not wired.
- **Providers whose upstream shape Vela has outgrown** — journalled rather than forced.
**🧪 Proof**
- New suites: `aws-sigv4` (8, against AWS's published vector). Carried suites green: `combo-empty-failover` 68 · `ollama-balance` 14 · `provider-registry-census` · `capabilities` · `sibling-providers-wiring` · `provider-alias-capabilities` · `model-catalog-scope` · `antigravity-oauth-client` · `xai-oauth-service` · `apikey-secret-lifecycle`.
- **212 assertions green across 11 suites.**
- `eslint` clean on every touched engine file — 0 errors (anonymous-default warnings only, the registry's own idiom).
- `npm run build` **green — BUILD_ID `qorSq0co3BlViBQzp2lr3`**, Next 16.4.3, standalone assets copied.
- `npm audit`: 4 advisories remain (0 critical) — the `next` and `dompurify` criticals are both closed.
**⚓ What sailed**
- 152 new files, 24 modified: `open-sse/` providers/registry (18), executors (10 + 30 web), handlers (14), services (14), utils (12), translator (4), lib (3), shared/qoder (4); `src/lib/oauth/` (8 providers + constants), `src/app/api/` (20 routes), `src/shared/` (8), `src/sse/services/` (2), `cli/` (5).
- Dependencies: `ajv@^8.20.0` (the DeepSeek tool-schema validator), `@aws-sdk/credential-providers` (optional, for SSO profiles), `dompurify` overridden to 3.4.17.
**🌊 Recorded, not repeated**
- **A port is not a copy.** Upstream's `createQoderProvider` factory never existed here — Vela's `qoder.js` exports a ready provider. Copying the caller without reading the callee produced `createQoderProvider is not a function` at import time, which Next surfaced only as "Failed to collect page data."
- **A constant is not a config.** `GLM_OAUTH_CONFIG` spread from a registry block that does not exist yields `{}` silently; the literal had to be written, with the field names the consumer actually reads (`apiBaseUrl`, not `baseApiUrl`).
- **An unreferenced export is a dead branch waiting to lie.** `hasTools` was used in gemini-web's capture path but never declared — both upstream and the port. Declared now, with the reason it can only be false.
- **A version pin is two files.** `package.json` alone leaves `npm ci` on the old build.

# v1.1.6 — The Empty Answer Answered 📮🌊
> *"A harbor that answers HTTP 200 with nothing has not answered. Gemini aborts a generation the API cannot serialize, streams a terminal frame with no content, and the gate — reading only the status — logs 'anchored' and hands the Star an empty page. The signal was never the status. It was the silence."* 📮🌊💜
**The first tide of the upstream carry (`decolua/9router` v0.5.55 → v0.5.109, 1,405 commits): the gate now reads the stream itself. Five fixes carried across the water, two seams of our own mended along the way, and the version pin that closes the October advisory.**
**📮 The empty answer, answered**
- **The peek reads the stream, not the status** (`open-sse/services/emptyFailover.js`, new): a combo member returning 2xx is held while its client-format stream is read for the first content frame. The signal is *structural* — "the stream ended and no content frame was ever released" — so it covers `MALFORMED_FUNCTION_CALL`, any future Gemini abort reason, and a stream that simply dies, with no reason vocabulary to keep in sync. The peek replays every byte it buffered, so the committed stream is byte-identical to the original.
- **Fail-open, and never a dropped chunk**: the deadline (45s, `EMPTY_PEEK_DEADLINE_MS`) commits whatever arrived rather than holding a possibly-valid slow stream, and hands the still-pending `read()` to the caller so the delayed frame is replayed, not lost. A zero/NaN deadline is clamped — there is no "disable" via this value.
- **A legitimately empty turn is not retried**: `NO_RETRY_EMPTY_FINISH` holds `content_filter` (and Claude's `refusal`, mapped to it in both directions), so a safety block is returned as-is rather than retried on every candidate. Everything else that finished empty falls through to the next member.
- **The non-streaming twin** — `isZeroContentResponse` (`open-sse/services/combo.js`) catches a 2xx JSON body carrying an empty assistant message with `in_progress`/`incomplete`, and advances the combo on any non-final seat.
**🔧 The reasoning current, resolved**
- **Antigravity answers again** — the IDE fingerprint moves `antigravity/ide/2.11.0` → `antigravity/hub/2.24.0` (`open-sse/providers/shared.js`, `src/mitm/antigravityIdeVersion.js`); the older shape drew HTTP 404 on Gemini 4 Argon, which only the hub build is served.
- **Gemini 4 Argon joins the registry** — `gemini-4-argon-high` / `-medium` / `-low`, with all three in the quota tracker's `importantModels` so their windows are read.
- **A bare model resolves its tier from the client's own effort** (`open-sse/config/providerModels.js`): `getModelUpstreamId` now takes the request body and resolves an unadorned `gemini-3.8-flash` asked for at effort `high` to the tiered variant, instead of silently landing on the unadorned model and dropping the effort. `xhigh`/`max` fold to `high`, `minimal` to `low`; an Anthropic `thinking.budget_tokens` maps through the same ladder.
- **Ollama Cloud's quota moved** (`open-sse/services/usage/misc.js`) — live limits left `/api/usage` for `/api/balance`. When the usage endpoint reports only activity history, the balance door is read for session (5h), weekly (7d), allowance and purchased-credit rows; the free plan's monthly window rolls on its signup day, clamped to the last valid day of a shorter month, and is skipped for non-free plans. The QuotaTable receives the credit metadata it needs (`isCreditBalance`, `currency`, `unit`).
**🛡️ The hull**
- **Monaco 0.57.0** (DOMPurify 3.4.15) — the critical advisory npm reported against 0.55.1 now reports fixed. `package.json` and `package-lock.json` move together, so `npm ci` installs the patched build rather than the vulnerable one.
- **`classify429`'s stale assertion** mended: it pinned the pre-`requestScoped` shape, so the suite failed on a *correct* return value. It now asserts the field the code has carried since v1.1.3.
**🧪 Proof**
- **New suite `combo-empty-failover` — 68 assertions, 68 green**: content vs role-only vs reasoning-only deltas; the deadline fail-open and its no-dropped-chunk regression; partial-line handling at chunk boundaries; Anthropic Messages and OpenAI Responses client formats (typed events, no `choices`); and the combo wired through the real `combo.js` + streaming pipeline for all three client formats — a good first member commits, an empty or zero-byte first member falls through, a tool call counts as content, a `content_filter` is not retried, and all-empty returns the last member as-is.
- **New suite `ollama-balance` — 14 assertions, 14 green**: `/api/balance` parsing, session/weekly percentages, allowance math, purchased credits, the free-plan monthly window, the signup-day reset ladder (next month / still ahead / short-month clamp / non-free skip), and the QuotaTable's forwarded credit metadata.
- **Carried suites green**: `combo-routing`, `account-fallback-4xx`, `codebuddy-block-backoff`, `codebuddy-parse-error`, `codebuddy-frequency-gate`, `param-support`, translator suites, `antigravity-usage-headers`, `antigravity-weekly-quota`, `antigravity-retry-hook`, `provider-registry-census`, `capabilities`, `ollama-usage`, `ollama-systemone`, `apikey-secret-lifecycle`.
- **`eslint` clean on every touched file — 0 errors**, one pre-existing warning (`registry/antigravity.js` anonymous default export) untouched by this tide.
- **`npm run build` green** — `BUILD_ID gwvfZlQIgq4zliyNRgcQG`, standalone assets copied, DOMPurify 3.4.15 in the shipped tree.
- **`npm audit`**: the `dompurify` critical advisory now reports fixed at `monaco-editor@0.57.0`.
**⚓ What sailed**
- `open-sse/services/emptyFailover.js` (new, 220 lines) · `open-sse/translator/schema/streamEvents.js` (new)
- `open-sse/services/combo.js` · `open-sse/translator/schema/finishReasons.js` · `open-sse/translator/schema/index.js` · `open-sse/translator/concerns/finishReason.js` · `open-sse/config/runtimeConfig.js`
- `open-sse/providers/shared.js` · `open-sse/providers/registry/antigravity.js` · `open-sse/config/providerModels.js` · `open-sse/handlers/chatCore.js` · `open-sse/services/usage/google.js` · `open-sse/services/usage/misc.js` · `src/mitm/antigravityIdeVersion.js`
- `src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js` · `package.json` · `package-lock.json`
- Tests: `tests/unit/combo-empty-failover.test.js` (new, 397 lines) · `tests/unit/ollama-balance.test.js` (new) · `classify429` · `antigravity-retry-hook` · `antigravity-usage-headers`
**🌊 Recorded, not repeated**
- **A 200 is a claim, not a proof.** The status said the member succeeded; the stream said it produced nothing. Reading the status alone launders an empty answer into a logged success — and the client cannot tell it from a real one.
- **The signal should be structural, not enumerable.** Keying the failover on "no content frame was ever released" survives every future abort reason upstream invents; keying it on a finish-reason list means the next new reason ships a silent regression.
- **A refusal is not a stop.** `refusal` → `content_filter` in *both* mapping directions, or an OpenAI client sees `finish_reason: "stop"` with an empty message and cannot act on the block.
- **A test can fail on correct code.** `classify429` pinned the pre-`requestScoped` shape and had been red since v1.1.3. The next stale assertion is the one that hides a real one.
- **The version pin is two files, not one.** Bumping `package.json` alone leaves `npm ci` installing the vulnerable build — the lock, the integrity hash, and the nested transitive must move together.
**🧭 What the tide did not take**
The 21 absent providers, the web-executor vein (`chatgpt-web`, `gemini-web`, `muse-web`, `deepseek-web`, `browserPool`, `lazyRuntime`), the Smart Router's session stickiness, `keyAccess`, `videoProviders`, `codexStt`, `netlifyRelay`, and `hermesProfiles` remain beyond this shore. They are named here rather than pretended, and they sail in the tides that follow. 💜
