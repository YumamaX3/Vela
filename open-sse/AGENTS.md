# open-sse

Provider-agnostic SSE engine: one OpenAI-style request → any provider (LLM chat, image, embedding, tts, stt, search), streamed back in the client's format.

Entry point: `src/sse/handlers/chat.js:361` calls `handleChatCore` in `handlers/chatCore.js`. Everything below is downstream of that call. `index.js` is the package barrel (it imports `utils/proxyFetch.js` **first** — that module patches global `fetch`, and nothing else may load before it).

## Directory map

| Path | What lives there | Entry symbol |
|---|---|---|
| `handlers/` | Per-modality cores | `chatCore.js` `handleChatCore` · `embeddingsCore.js` · `imageGenerationCore.js` · `ttsCore.js` · `sttCore.js` · `videoCore.js` · `responsesHandler.js` |
| `handlers/chatCore/` | The three response shapes + request bookkeeping | `streamingHandler.js` (`handleStreamingResponse`, `buildOnStreamComplete`) · `nonStreamingHandler.js` (`handleNonStreamingResponse`) · `sseToJsonHandler.js` (`handleForcedSSEToJson`) · `coercedSseHandler.js` (`buildCoercedSSEResponse`) · `requestDetail.js` (`buildRequestDetail`, `extractRequestConfig`) |
| `handlers/{search,imageProviders,ttsProviders,embeddingProviders,fetch}/` | Per-backend media adapters — each folder has `_base.js` + `index.js` | `imageProviders/` 15 files · `ttsProviders/` 13 · `embeddingProviders/` 6 · `search/` 4 · `fetch/` 1 |
| `translator/` | Format conversion registry | `index.js` — `translateRequest`, `translateResponse`, `register`, `initState`, `needsTranslation` |
| `translator/request/` | `<from>-to-<to>.js`, one-way request translation | 12 files |
| `translator/response/` | `<from>-to-<to>.js`, one-way SSE-chunk translation | 10 files |
| `translator/schema/` | Pure data enums, **no logic** — `roles.js` (`ROLE`, `GEMINI_ROLE`), `blocks.js`, `finishReasons.js`, `defaults.js`; import via `schema/index.js` | |
| `translator/concerns/` | Cross-format **logic** | `thinkingUnified.js` (`applyThinking`/`captureThinking`/`extractThinking`/`stripThinkingSuffix`) · `toolCall.js` (`ensureToolCallIds`, `fixMissingToolResponses`, `defaultClaudeToolType`) · `modality.js` (`stripUnsupportedModalities`) · `prefetch.js` (`prefetchRemoteImages`) · `kiroConversation.js` · `chunk.js` · `usage.js` · `image.js` · `finishReason.js` · `paramSupport.js` |
| `translator/formats/` | Per-format logic | `claude.js` (`prepareClaudeRequest`, `normalizeClaudePassthrough`, `anchorClaudeCache`) · `openai.js` (`filterToOpenAIFormat`) · `gemini.js` · `responsesApi.js` · `maxTokens.js` |
| `translator/formats.js` | The `FORMATS` enum + `detectFormatByEndpoint(pathname, body)` | `OPENAI`, `OPENAI_RESPONSES`, `CLAUDE`, `GEMINI`, `GEMINI_CLI`, `VERTEX`, `CODEX`, `ANTIGRAVITY`, `KIRO`, `CURSOR`, `OLLAMA`, `COMMANDCODE` |
| `executors/` | Per-upstream HTTP call — **28 modules** besides `base.js`/`index.js` | `base.js` `BaseExecutor` · `default.js` `DefaultExecutor` · `index.js` `getExecutor` / `hasSpecializedExecutor` |
| `providers/` | Registry build + capability/pricing tables | `index.js` builds `PROVIDERS` / `PROVIDER_MODELS` / `PROVIDER_OAUTH` / `PROVIDER_MEDIA` **from `REGISTRY` only** |
| `providers/registry/` | One file per provider — `registry/{id}.js` (**166 on disk**) | `registry/index.js` is **auto-generated**; `REGISTRY_TEMPLATE.js` sits *outside* `registry/` and is deliberately not imported |
| `providers/` siblings | `pricing.js` · `capabilities.js` · `thinkingLevels.js` · `visionPatterns.js` · `catalogOverride.js` · `shared.js` (vendor constants + fingerprint headers) · `schema.js` (`PROVIDER_DEFAULTS`, `ENDPOINT_DEFAULTS`) · `models/` (`schema.js` `normalizeModel`, `namePatterns.js` `deriveModelName`) | |
| `config/` | ALL constants — nothing hardcoded elsewhere | `providerModels.js` (alias→models + the `getModel*` accessors) · `providers.js` (barrel over `providers/index.js`) · `runtimeConfig.js` (`HTTP_STATUS`, `RETRY_CONFIG`, `DEFAULT_RETRY_CONFIG`, `FETCH_CONNECT_TIMEOUT_MS`, `TOKEN_SAVER_HEADER`) · `appConstants.js` · `providerProfiles.js` · `errorConfig.js` · `kiroConstants.js` · `mediaConfig.js` · `ttsModels.js` |
| `rtk/` | Request token-saver | `index.js` (`compressMessages`, `formatRtkLog`) · `registry.js` (`resolveFilter`/`allFilters`) · `autodetect.js` (`autoDetectFilter`) · `applyFilter.js` (`safeApply`) · `constants.js` · `filters/` (12 compressors) · `headroom.js` · `pxpipe.js` · `caveman.js` · `ponytail.js` · `systemInject.js` · `userInjectors.js` · `terminationPrompt.js` |
| `services/` | Model/transport resolution, fallback, tokens, quota | `model.js` (`parseModel`) · `provider.js` (`detectFormat`, `getTargetFormat`, `resolveTransport`, `normalizeThinkingConfig`) · `accountFallback.js` · `accountSemaphore.js` · `combo.js` · `tokenRefresh.js` + `tokenRefresh/providers.js` · `oauthCredentialManager.js` · `projectId.js` · `fallbackRuleMatcher.js` · `usage.js` (`getUsageForProvider`) + `usage/` (20 per-provider trackers) |
| `utils/` | Transport + stream plumbing | `proxyFetch.js` (**patches global fetch**) · `stream.js` (`createSSEStream`, `createSSETransformStreamWithLogger`, `createPassthroughStreamWithLogger`) · `streamHandler.js` (`createStreamController`) · `usageTracking.js` · `error.js` (`parseUpstreamError`, `formatProviderError`) · `classify429.js` · `cooldownRetry.js` · `loopGuard.js` · `sessionManager.js` · `clientDetector.js` · `claudeCloaking.js` · `claudeHeaderCache.js` · `cursorProtobuf.js` · `toolDeduper.js` · `kimiToolParser.js` · `requestLogger.js` · `bypassHandler.js` |
| `shared/` | Cross-provider identity/auth helpers | `clineAuth.js`, `clineEnvelope.js`, `machineId.js`, `mimoAccount.js`, `zedAuth.js`, `codebuddy/gate.js`, `qoder/{constants,cosy,encoding}.js` |
| `transformer/` | Stream reshaping outside the translator | `responsesTransformer.js` (`createResponsesApiTransformStream`) · `streamToJsonConverter.js` (`convertResponsesStreamToJson`) |

## The request path

`handleChatCore({ body, modelInfo, credentials, … })` in `handlers/chatCore.js`, in order.

1. **Detect the source format** — `detectFormat(body)` (`services/provider.js`), unless the caller passed `sourceFormatOverride`.
2. **Bypass** — `handleBypassRequest(body, model, userAgent, ccFilterNaming)` (`utils/bypassHandler.js`) returns early for warmup/skip/`cc`-naming probes. It streams translated — it calls `initState` and `translateResponse` itself.
3. **Choose the target format** — see *Transport resolution* below. The winner lands on `credentials.runtimeTransport`.
4. **Native passthrough** — `detectClientTool` + `isNativePassthrough` (`utils/clientDetector.js`): when the CLI client and the provider are the same ecosystem, *all* translation is skipped — only model and Bearer are swapped (plus Codex reasoning-effort mapping and `normalizeClaudePassthrough` for Claude clients).
5. **Pre-translation body surgery** — `stripUnsupportedModalities(body, sourceFormat, caps)` (`translator/concerns/modality.js`, driven by `getCapabilitiesForModel`) and `prefetchRemoteImages` (`translator/concerns/prefetch.js`). Both skipped under passthrough.
6. **Translate** — `translateRequest(sourceFormat, targetFormat, model, body, stream, credentials, provider, reqLogger, stripList, connectionId, clientTool)` (`translator/index.js`): strip opt-in content types → `normalizeThinkingConfig` → `ensureToolCallIds` → `fixMissingToolResponses` (**skipped when target is KIRO**) → `captureThinking` / `captureSessionId` from the *pre*-translation body → direct route or OpenAI pivot → `applyThinking` → `filterToOpenAIFormat` (target openai) → `prepareClaudeRequest` (target claude) → `cloakClaudeTools` when the provider sets `quirks.cloakToolsOnOAuth` and the token is an `sk-ant-oat…` OAuth token. Internal bookkeeping (`_toolNameMap`, `_customToolNames`) is pulled off the result and deleted before dispatch.
7. **Token savers, in dispatch order** — `compressMessages` → `compressWithHeadroom` → `injectCaveman` → `injectPonytail` → `injectToolProtocolPrompt` (only for `TOOL_PROTOCOL_PROMPT_PROVIDERS`) → `applyLoopGuard` → `injectTerminationPrompt` → `applyUserInjectors` → `compressWithPxpipe`. A client disables all of them with `TOKEN_SAVER_HEADER: off`.
8. **Execute** — `getExecutor(provider)` (`executors/index.js`) → `executor.execute({ model, body, stream, credentials, signal, log, proxyOptions })`. `trackPendingRequest(…, true)` records the in-flight row first.
9. **Credential refresh on 401/403** — `executor.refreshCredentials` inside `refreshWithRetry(fn, 3, log)` (`services/tokenRefresh.js`), then **one** re-execute, then `onCredentialsRefreshed`. Skipped when `executor.noAuth`.
10. **Shape the response** — forced SSE→JSON when the provider forces streaming but the client asked for JSON; else true non-streaming; else streaming. All three call `translateResponse(targetFormat, sourceFormat, chunk, state)` per chunk.

## Transport resolution & the format ladder

`resolveTransport(provider, sourceFormat)` (`services/provider.js`) answers first, because a source-format-matched endpoint is *lossless* — no translation at all. Precedence in `handleChatCore`:

```js
const runtimeTransport = resolveTransport(provider, sourceFormat);
const supported        = getModelSupportedFormats(alias, model);        // per-model guard
const useTransport     = (!supported || supported.includes(sourceFormat)) ? runtimeTransport : null;
const targetFormat     = useTransport?.format || modelTargetFormat || getTargetFormat(provider, credentials);
if (useTransport) credentials.runtimeTransport = useTransport;
else if (targetFormat) credentials.runtimeTransport = resolveTransport(provider, targetFormat) || undefined;
```

- The **per-model guard** exists because one provider's models often do not share endpoints — opencode-go's kimi/glm serve only `/chat/completions`, so a Claude-format request must not be routed to `/messages`. A model declares this through `supportedFormats` in its registry entry.
- A source-matched transport **beats** a model-level `targetFormat`. A model-level `targetFormat` is only the fallback for clients whose wire format has no transport.
- The `else if` branch is the mirror case: no transport matched, so the model's `targetFormat` drives the body — and the endpoint must follow the body, or a Responses-shaped payload lands on `/chat/completions`.
- `strip` is a per-model opt-in list read by `getModelStrip(alias, model)` and honoured in `translateRequest` (`image` / `audio` content blocks). `getModelUpstreamId` gives the id actually sent upstream; `stripThinkingSuffix` (`translator/concerns/thinkingUnified.js`) removes a trailing `model(value)` override the client appended — `parseSuffix` documents `value` as a level name, a number, `auto`, or `none`.

## The executor contract

`BaseExecutor` (`executors/base.js`) is the whole contract; a specialized executor overrides only what differs.

| Hook | Default | Notes |
|---|---|---|
| `getBaseUrls()` | `config.baseUrls` or `[config.baseUrl]` | the **fallback ladder**; `getFallbackCount()` is its length (min 1) |
| `buildUrl(model, stream, urlIndex, credentials)` | picks `baseUrls[urlIndex]` | receive `urlIndex`; most overrides ignore it |
| `buildHeaders(credentials, stream)` | Bearer, or `x-api-key` + `anthropic-version` for `anthropic-compatible-*` | **called with five arguments** — `(credentials, stream, url, model, transformedBody)` — so an override may accept the extras; the base declares only the first two. Adds `Accept: text/event-stream` when streaming |
| `transformRequest(model, body, stream, credentials)` | identity | provider-specific body rewrite |
| `execute({ model, body, stream, credentials, signal, log, proxyOptions })` | the loop below | may return `responseFormat` and `toolNameMap` |
| `shouldRetry(status, urlIndex)` | `429` **and** another URL left | advances to the next base URL |
| `refreshCredentials(credentials, log, proxyOptions)` | `null` | called only on 401/403 |
| `needsRefresh(credentials)` | `shouldRefreshCredentials(provider, credentials)` | |
| `parseError(response, bodyText)` | `{ status, message }` | |
| `computeRetryDelay(response, attempt, delayMs)` | — | **optional hook**; returning `false` vetoes the retry |

`execute()` per attempt: **`buildUrl` → `transformRequest` → `buildHeaders` → `proxyAwareFetch`** (from `utils/proxyFetch.js`). Around that:

- `retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry }`; `resolveRetryEntry(retryConfig[status])` yields `{ attempts, delayMs }`, tracked **per URL** in `retryAttemptsByUrl`.
- Network exceptions are mapped to the `BAD_GATEWAY` retry entry rather than thrown immediately. An internal connect timeout (`FETCH_CONNECT_TIMEOUT_MS`, or `config.timeoutMs`) is converted into a retryable network error; a *client* `AbortError` is rethrown untouched.
- `noAuth` (from the registry transport) suppresses the whole refresh branch — local/free providers need no credential.
- `execute()` returns `{ response, url, headers, transformedBody }`; `response.ok` is **not** checked here — `handleChatCore` owns the error path (`parseUpstreamError` → `formatProviderError` → `createErrorResult`).
- An executor that decodes its own upstream **must** return `responseFormat` (e.g. Cursor's AgentService), or the dispatcher will try to translate an already-OpenAI-shaped stream. It may also return `toolNameMap` when it renamed tools on the wire.

## The response contract

- **Non-streaming** — `handleNonStreamingResponse` in `chatCore/nonStreamingHandler.js` (via `translateNonStreamingResponse`).
- **Forced SSE→JSON** — when the provider requires streaming but the client did not ask for it: `handleForcedSSEToJson` (`chatCore/sseToJsonHandler.js`) parses the whole SSE into one JSON body.
- **Streaming** — `handleStreamingResponse` (`chatCore/streamingHandler.js`) walks to `utils/stream.js`, which **mints the state**: `{ ...initState(sourceFormat), provider, toolNameMap, customToolNames, model }` in TRANSLATE mode, `null` in PASSTHROUGH mode. In PASSTHROUGH mode the SSE is forwarded with framing intact.
- `translateResponse(targetFormat, sourceFormat, chunk, state)` returns an **array** of chunks (or an empty array when the chunk is consumed). When both ends are non-OpenAI it also attaches `_openaiIntermediate` for the request log; `utils/stream.js` drains it.
- Same-format calls are *not* a pure no-op: `decloakStreamChunk(chunk, state?.toolNameMap)` still runs, because the request side may have suffixed tool names for an OAuth-cloaked Claude provider.
- `finalizeStream()` inside `utils/stream.js` is **idempotent** and callable from both `transform` and `flush`, so usage is logged and `onStreamComplete` fires exactly once whether the stream ends on a terminal event, `[DONE]`, or a client hang-up.
- `initState(format)` is also called directly by executors that decode their own transport — `github.js`, `opencode.js`, `zed.js` — and by `utils/bypassHandler.js`.

## Token savers — `rtk/`

`compressMessages(body, enabled)` (`rtk/index.js`) is a **pre-translate hook**: it rewrites `tool_result` content in place and returns `{ bytesBefore, bytesAfter, hits }` or `null`. It understands three shapes — OpenAI/Responses `messages`/`input`, and Kiro's `conversationState.history[].…toolResults[].content[].text`.

- **Detection** (`autodetect.js` `autoDetectFilter`): `git-log → git-diff → git-status → build-output → porcelain-status → grep → find → tree → ls → search-list → read-numbered → dedup-log → smart-truncate → null`. Build output is checked *before* the porcelain check so a cargo `Compiling` line is not misread as git status.
- **Dispatch** (`registry.js`): `resolveFilter(name)` reads the `FILTERS` names in `constants.js` and two Rust-parity aliases — `rg`→`grep`, `fd`→`find`.
- **Caps** live in `constants.js` (`RAW_CAP` 10 MiB, `MIN_COMPRESS_SIZE` 500 B, `DETECT_WINDOW` 1024 chars, per-filter line caps). `compressText` skips a blob that is under the floor or over the cap.
- **Headroom** (`headroom.js`) is an external compression proxy — optional, off the request path when absent, and honest about it: `isHeadroomPhantomSavings` warns when a reported token delta came with an outbound JSON that shrank under 5%.
- **Prompt injectors** in this folder are *not* compressors and all layer onto the final body: `caveman.js` / `ponytail.js` (terse-style system prompts), `systemInject.js` (`injectSystemPrompt(body, format, prompt, position)`), `terminationPrompt.js` (Kimi-gated termination + a tool-protocol notice), `userInjectors.js` (operator prompts, applied **last** so they read over the built-ins, with `{{model}}`/`{{requestId}}`/`{{date}}` variables), `pxpipe.js` (image-heavy Claude-format bodies, the last saver before dispatch).

## Providers, models, capabilities

- `providers/index.js` iterates `REGISTRY` once. `entry.transport` → `PROVIDERS[id]`; `entry.models` → `PROVIDER_MODELS[alias || id]` through `normalizeModel`; `entry.oauth` → `PROVIDER_OAUTH[id]`; the `MEDIA_KEYS` set (plus legacy `entry.media`) → `PROVIDER_MEDIA[id]`. `buildTransport` re-applies `format: "openai"` and injects `oauth.{clientId,clientSecret,tokenUrl}` so executors reading `this.config.*` never need a duplicate.
- ⚠️ `providers/schema.js` `PROVIDER_DEFAULTS` / `ENDPOINT_DEFAULTS` and `resolveProvider()` are **documentation plus a skeleton** — the file says so itself: `buildTransport` re-applies **only `format`**. Adding a key to `PROVIDER_DEFAULTS` does **not** change `PROVIDERS`, and `resolveProvider` is not wired.
- Model accessors (`config/providerModels.js`): `getProviderModels`, `getDefaultModel`, `isValidModel`, `findModelName`, `getModelTargetFormat`, `getModelSupportedFormats`, `getModelType`, `getModelUpstreamId`, `getModelStrip`, `getModelQuotaFamily`, `getModelsByProviderId`, plus `PROVIDER_ID_TO_ALIAS` and `OAUTH_ALIASES`.
- `services/model.js` `parseModel` resolves alias→id through a table derived from `REGISTRY` (plus `MEDIA_ONLY_ALIASES` for media-only providers) and `BUILTIN_MODEL_ALIASES`; with no explicit provider prefix it falls back to `MODEL_PREFIX_PROVIDERS`, first match wins, default `"openai"`.
- `providers/capabilities.js` `getCapabilitiesForModel(provider, model)` resolves in strict order, every result spread over `DEFAULT_CAPABILITIES`: (1) `PROVIDER_CAPABILITIES` — provider key normalised through `PROVIDER_ALIAS_TO_ID`, model then vendor-stripped base — (2) `MODEL_CAPABILITIES` exact, base then full — (3) `PATTERN_CAPABILITIES` glob, first match wins. `commandcode`/`cmc` short-circuits the whole chain because its wire is `/alpha/generate` for every model. A live catalog can override the result via `setCatalogSource` / `catalogOverride.js` (`installCatalogSource`, `getCatalogModalities`, `getCatalogLimits`, `CATALOG_VERSION`).
- Quota and account health: `services/usage.js` `getUsageForProvider(connection, proxyOptions, options)` fans out to the 20 trackers in `services/usage/`. `utils/classify429.js` turns one HTTP 429 into three truths (`looksLikeDailyQuota`, `looksLikeQuotaExhausted`, `isGeminiGenericRateLimit`) so a dead-until-tomorrow account is not cooled for seconds; `utils/cooldownRetry.js` (`MAX_RETRY_WAIT_MS` 30 s, `MAX_COOLDOWN_RETRIES` 1) waits once when *every* account is cooling; `services/accountSemaphore.js` bounds per-account concurrency.

## Conventions

- **Config-driven, DRY.** Models, block types, roles, timeouts, retry ladders, quotas and pricing live in `config/` or in the `providers/*` tables. Never hardcode a model id, a role string, a block type, or a timeout in a translator or an executor.
- **The OpenAI pivot.** `translateRequest` composes `source → openai → target`; `translateResponse` composes `target → openai → source`. `sourceFormat === targetFormat` skips conversion.
- **Direct routes.** Both functions look up the exact pair first — request `source:target`, response `target:source`. Pairs registered in **both** directions today: `claude↔kiro` and `openai↔{openai-responses, antigravity, commandcode, cursor, gemini, gemini-cli, kiro, ollama, vertex}`. `claude↔openai` is direct by construction — it *is* the hub format.
- **Self-registration.** A translator module calls `register(from, to, requestFn, responseFn)` as an import side-effect. `requestRegistry`/`responseRegistry` are `var`-hoisted, **not** `let`, so an early `register()` during a circular import sees `undefined` instead of a TDZ error. The static `import "./request/…"` list at the bottom of `translator/index.js` is the only thing that loads them; `initTranslators()` is a kept-for-compat no-op.
- **Executor registry.** `executors/index.js` instantiates every specialized executor **once at module load** into one map (34 keys: 27 classes plus the aliases `cu`, `ocg`, `gcli`, `gb`, `mmf`, `fb`). `getExecutor` falls back to `DefaultExecutor`, memoized per provider in `defaultCache`.
- **Provider registry is closed.** There is no directory scan and no fallback — a registry file that `index.js` does not import is unreachable at runtime, however complete it looks.
- **Fail-open savers.** RTK, headroom and pxpipe never throw out of the request path: any error returns `null` or the original body.

## How to add

### A provider

1. Copy `providers/REGISTRY_TEMPLATE.js` (it lives *outside* `registry/`, so the static-import list ignores it) to `providers/registry/{id}.js`. Only `id` and `category` are required; delete every block you do not need. The full field contract is the `@typedef RegistryEntry` in `providers/schema.js`.
2. Add the models to that entry's `models` array — or to `config/providerModels.js` for alias-keyed lanes.
3. **Register it in `providers/registry/index.js` by hand.** The generator that used to do this is **gone** — see the first pitfall. You need an `import pN from "./{id}.js"` line **and** the matching `pN,` entry in `export default [...]`.
4. Add an executor only if the upstream is not OpenAI-compatible.

### An executor

1. `executors/{name}.js`, `class XExecutor extends BaseExecutor`, and `super(providerId, PROVIDERS[providerId])` so `this.config` is the registry transport.
2. Override only the hooks you must (table above). Prefer returning state through `transformRequest`'s return value over stashing it on `this`.
3. Register it in the `executors` map in `executors/index.js`.
4. If the upstream wire format does not round-trip, decode it in the executor **and return `responseFormat`** from `execute()`.

### A translator

1. `translator/request/<from>-to-<to>.js` calls `register(FORMATS.X, FORMATS.Y, fn, null)`; `translator/response/<to>-to-<from>.js` calls `register(FORMATS.Y, FORMATS.X, null, fn)`.
2. Add **both** files to the static import list at the bottom of `translator/index.js`. Nothing else loads them.
3. Reuse `schema/` (enums) and `concerns/` (logic) — never re-implement parsing. Registering the reverse pair is what turns a lossy pivot into a direct route.

## The pricing model

`providers/pricing.js` is the static layer; `src/lib/db/repos/pricingRepo.js` is the async overlay. Sovereignty order for any lookup: **user overrides** (kv scope `pricing`) → **synced rates** (scope `pricing_sync`) → the seven-stratum static chain in `getPricingForModel(provider, model)`, first match wins:

| # | Stratum | Table |
|---|---|---|
| 3.0 | UNPRICEABLE manifest (router pseudo-models, no-token lanes) → `null` | `UNPRICEABLE` |
| 3.a | lane override by registry **id** | `PROVIDER_PRICING[id][model]` |
| 3.b | lane override by registry **alias** | `PROVIDER_PRICING[alias][model]` |
| 3.c | canonical exact match | `MODEL_PRICING[model]` |
| 3.d | free → paid sibling inheritance (exact strata only, never globs) | `FREE_ALIAS_MAP` |
| 3.e | vendor-prefix stripped exact (`deepseek/deepseek-chat`) | `MODEL_PRICING[stripVendor(model)]` |
| 3.f | pre-compiled glob, last resort | `PATTERN_PRICING` |

- **Five rate fields, $/1M tokens**: `input`, `output`, `cached`, `reasoning`, `cache_creation`. Never add a sixth — fallbacks live in the cost math (`calculateCostFromTokens`), not in the table.
- **Cost is frozen at write time.** `src/lib/db/repos/sqlite/usageRepo.js` `saveRequestUsage(entry)` resolves the rate through `getPricingForModel` + `calculateCostFromTokens` and stores the number in `usageHistory.cost`; every read (`getUsageStats`, the weekly digest, the budget gate) sums that stored column. Editing a rate never rewrites history, and there is no backfill.
- **`matchPattern` globs are anchored** — `new RegExp("^" + pattern.split("*").map(escape).join(".*") + "$", "i")`, and `PATTERN_PRICING` is pre-compiled once at module load into `COMPILED_PATTERNS`. It is consumed by `providers/capabilities.js` **and** `providers/thinkingLevels.js`, so preserve its semantics when touching `PATTERN_PRICING` — you are editing capability and thinking detection too.
- **The free-model decree (R3)**: every free model carries its paid sibling's rate. Siblings are hand-verified in `FREE_ALIAS_MAP`; `resolveSiblingRate` never re-enters free inheritance (cycle guard) and never consults `UNPRICEABLE`.
- **Sync is the only network path.** `POST /api/pricing/sync` (`src/app/api/pricing/sync/route.js`) fetches **only** the hardcoded URLs in `SYNC_VENDOR_MAP` — the body selects vendors by *key*, never by URL. That is the SSRF defense. Every payload is treated as hostile: schema-clamped, size-capped (20 MB / 100 000 entries), rate-clamped, and `__proto__` / `constructor` / `prototype` keys rejected before any write. It writes scope `pricing_sync` and can never touch user overrides (`DELETE` carries the same promise). Dashboard shore: `/dashboard/settings/pricing`.
- **Changing a rate table** → re-run `node tests/__baseline__/snapshot-pricing-census.mjs`; `node tests/__baseline__/verify-pricing-census.mjs` is the gate that fails on a **silent shrink** (every count must be ≥ its `pricing-census.json` snapshot; growth is allowed).

## Pitfalls

- **`registry/index.js` is auto-generated — and its generator is missing.** `scripts/migrate-registry.mjs` does not exist on disk (verified 2026-09-24: absent from `scripts/`, matched by `.gitignore:100 scripts/*`, untracked by commit `fafcaf5a`; the blob survives only in history). Symptom: a brand-new `registry/{id}.js` looks complete, is never imported, and is **silently unreachable** — exactly how 14 committed providers went dark. Measured at the same date: **166** registry files on disk, **149** static imports in `index.js`, **3** commented out (`trae`, `devin-cli`, `windsurf`), and these 14 absent entirely: `agentrouter`, `agentrouter-pro`, `ai21`, `alibaba`, `alibaba-intl`, `databricks`, `devin-cli-pro`, `muse-spark-lite`, `muse-spark-web`, `qwen`, `qwen-v2`, `snowflake`, `zcode`, `zcode-lite`. **Always confirm your provider appears in `index.js` before believing it works**, and re-derive any provider count before quoting it.
- **The OpenAI bridge is lossy.** Thinking/reasoning, non-base64 image URLs, `input_audio`, `is_error`, parallel tool ids, non-text system blocks and `tool_choice` do not survive a double-hop — `tests/translator/AGENTS.md` carries the measured per-pair list with `file:line`. Make fragile pairs **direct routes** instead of pivoting. The bridge also leaks its own accommodations: the Responses→Chat translator stashes a reasoning `encrypted_content` blob on assistant messages for later continuity, and `stripContinuityFields` (`handlers/chatCore.js`) must delete it before dispatch or chat-native proxies answer a literal `400`.
- **Binary / non-SSE upstreams do not round-trip** — decode them inside their executor and return `responseFormat`: `kiro` speaks AWS EventStream binary (`executors/kiro.js` `transformEventStreamToSSE`), `cursor` speaks ConnectRPC protobuf (`utils/cursorProtobuf.js`, `executors/cursor.js`), `commandcode` speaks AI SDK NDJSON with no `data:` prefix (`executors/commandcode.js` `wrapNdjsonAsOpenAISse`). `tests/translator/AGENTS.md` §7 keeps the running list of providers whose responses leave the bridge.
- **RTK is fail-open and additive.** `compressText` returns the original when a filter yields empty output or *grows* the text, and `safeApply` (`rtk/applyFilter.js`) catches a panicking filter and passes the raw string through with a warning. It also **skips** results that are errors — `block.is_error === true` (`rtk/index.js:67`) and `tr.status === "error"` (`:103`) — to preserve traces. Never throw out of a filter, and never "fix" a compression miss by returning a shorter-but-wrong body.
- **Executors are singletons that hold per-request state.** Every specialized executor is constructed once at module load (`executors/index.js`) and reused for every request in the process. Several stash request state on `this` and depend on `BaseExecutor.execute`'s order — `transformRequest` runs immediately before `buildHeaders`, on the same instance: `codex.js` (`_currentSessionId`, `_isCompact`), `antigravity.js` (`_lastSessionId`, commented "cached for buildHeaders (base.execute order)"), `grok-cli.js` (`_currentSessionId`, `_currentReqId`, `_currentTurnIdx`, `_agentId`, `_currentModel`), `gemini-cli.js` (`_currentModel`). Adding a concurrent path, reordering `execute`, or reading that state from any other method hands one request another request's session.
- **`FREE_DENYLIST` is inert — measured.** `getPricingForModel` guards suffix-stripping with `has(FREE_DENYLIST, model)`, but `has` is `Object.prototype.hasOwnProperty.call(obj, key)` and `FREE_DENYLIST` is a `Set` — own-property lookup on a `Set` is always `false` (`Set.has` would be `true`), so the denylist never blocks anything. Measured 2026-09-24: shapes it declares "no paid sibling anywhere" still resolve, by falling through to the canonical exact strata — `getPricingForModel('nesarouter', 'nesarouter/mistral-large-latest-free')` → `{ input: 2, output: 6 }`, `…/codestral-latest-free` → `{ input: 0.3, output: 0.9 }`, and the *embedding* model `nvidia/llama-nemotron-embed-vl-1b-v2:free` → `{ input: 0.59, output: 0.79 }`. The two entries with no strippable suffix at all (`goldeneye-free-auto`, `kilo-auto/free`) resolve to `null` by accident of shape, not by the guard. Repro:
  ```bash
  node -e "import('./open-sse/providers/pricing.js').then(m=>console.log(m.getPricingForModel('nesarouter','nesarouter/mistral-large-latest-free')))"
  ```
