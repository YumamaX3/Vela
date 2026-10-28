# 🌐 Providers

> *"Every upstream is a distant port, and the registry is the harbor's ledger of
> which ones the fleet may call. The ledger is honest: it names what sits in the
> drawer, what the index actually carries, and what can truly be dialed — three
> different numbers, because they are three different things."*

**Covers:** the three counts · the registry entry · the roster by lane · wire
formats · executors · adding a provider · where pricing lives. Measured
**2026-10-28, at v1.2.5** — every figure below carries the command that produced
it.

---

## Table of Contents

- [The Three Counts](#-the-three-counts)
- [The Registry](#-the-registry)
- [The Roster](#-the-roster)
- [Wire Formats](#-wire-formats)
- [Executors](#-executors)
- [Adding a Provider](#-adding-a-provider)
- [Pricing](#-pricing)

---

## 🔢 The Three Counts

At **v1.2.5**, measured **2026-10-28**:

| # | Count | What it means |
|-|-|-|
| **189** | files on disk in `open-sse/providers/registry/` | every provider entry anyone has written (`index.js` excluded) |
| **186** | modules the generated index imports | the ones the app can even see |
| **145** | dialable chat transports | entries with a `transport` block — the ones a request can reach |

Re-derive all three — never quote them from memory:

```bash
# 189 — files on disk (registry list, index.js excluded)
ls open-sse/providers/registry/*.js | grep -v index.js | wc -l

# 186 imported / 145 transport-bearing — the runtime's own answer
node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log('imported',m.default.length,'transport-bearing',m.default.filter(e=>e.transport).length))"

# 145 — the dialable map agrees (PROVIDERS is built only from entries with a transport)
node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"
```

The index carries its own census on line 2 — read it as a cross-check, never as
the measurement:

```js
// Census: 186 imported providers (+ 3 hidden: devin-cli, trae, windsurf).
```

### Why the three differ

**189 → 186: three files never made it into the index, and all three are
deliberate.** The generated `registry/index.js` is a *static import list*, not a
directory scan — a file it does not name is genuinely unreachable, however
complete it looks. The three are held out by `HIDDEN` in the emitter and
committed, commented, in the array literal:

| File | Why it is hidden |
|-|-|
| `trae` | no tool-calling support (the SOLO agent) |
| `windsurf` | gRPC skip on `ToolCallChunk` |
| `devin-cli` | spawns a local agent with shell/fs access |

**189 − 3 = 186.** `tests/unit/provider-registry-census.test.js` asserts both
halves — the three keep their files on disk *and* stay out of the index — so a
half-hidden provider fails the suite rather than drifting.

> 📜 **This gap was once debt, not design.** At v0.9.93 the chart counted 166 on
> disk and 149 imported, and fourteen of the seventeen absent files
> (`agentrouter`, `agentrouter-pro`, `ai21`, `alibaba`, `alibaba-intl`,
> `databricks`, `devin-cli-pro`, `muse-spark-lite`, `muse-spark-web`, `qwen`,
> `qwen-v2`, `snowflake`, `zcode`, `zcode-lite`) had no marker at all — the
> 2026-09-04 drift. The emitter (`scripts/generate-registry-index.mjs`) was
> written to seal it, and every one of those fourteen imported normally. The
> difference between then and now is not arithmetic; it is that *every*
> unimported file is now named and has a reason.

**186 → 145: forty-one entries legitimately carry no chat transport.** These are
the media, search, embedding, image, video and speech services. They are not
broken; they simply do not speak `/chat/completions`. Every one declares
`serviceKinds` instead, lands in `PROVIDER_MEDIA`, and is dispatched by its own
handlers:

```bash
# 41 — imported entries with no transport (every one carries serviceKinds)
node -e "import('./open-sse/providers/index.js').then(m=>{const M=m.PROVIDER_MEDIA,P=m.PROVIDERS;console.log(Object.keys(M).filter(k=>!P[k]).length)})"

# 103 keys in the built media map (one per provider carrying media fields) / 41 of them media-only
node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDER_MEDIA).length))"
```

**186 − 41 = 145.** The arithmetic closes.

And the 145 closes a second way — by wire dialect, with `format` unset meaning
`PROVIDER_DEFAULTS` supplies `"openai"`:

| `transport.format` | Count |
|-|-:|
| *(unset → `openai`)* | 97 |
| `openai` — declared on the entry | 26 |
| `claude` | 9 |
| `openai-responses` | 3 |
| `ollama` | 2 |
| `antigravity` · `commandcode` · `cursor` · `gemini` · `grok-web` · `kiro` · `perplexity-web` · `vertex` (one each) | 8 |
| **Total** | **145** |

> ⚠️ **The Count Discipline.** When someone asks "how many providers", the honest
> answer is *which number do you mean*. 189 is what the drawer holds, 186 is what
> the index admits, 145 is what a request can dial, 82 is how many distinct
> providers own a non-`llm` media service, and 103 is how many providers the media
> map carries.
> One figure collapses five facts into one and matches no measurement —
> `CLAUDE.md` once wore "143 upstream providers", a number that matched nothing.
> Name the count.

⚠️ Unreachable in the runtime means unreachable in the dashboard too —
`src/shared/constants/providers.js` builds the UI's provider list from the same
generated index, so the three hidden lanes appear nowhere.

---

## 🗂️ The Registry

`open-sse/providers/registry/` holds **one file per provider**, and that file is
the single source for everything about it — transport, models, OAuth flow, media
config, display metadata.

### Where an entry lands

The directory is flat — `registry/` holds the 189 provider files plus the
generated `index.js`, and nothing else. Its siblings one level up are `schema.js`
(the `RegistryEntry` contract and `PROVIDER_DEFAULTS`), `REGISTRY_TEMPLATE.js`
(copy this when adding one), `capabilities.js`, `catalogOverride.js`,
`thinkingLevels.js`, `visionPatterns.js`, `pricing.js`, `shared.js`
(cross-provider header helpers such as the Claude fingerprint), and the `models/`
directory.

(`REGISTRY_TEMPLATE.js` lives *outside* `registry/` deliberately — the emitter
scans `registry/*.js` and would otherwise import the template as a provider.)

`open-sse/providers/index.js` walks `REGISTRY` once and builds four maps:

| Built map | Source in the entry | Keyed by |
|-|-|-|
| `PROVIDERS` | `transport` — **only if present** | `id` — this is the dialable set |
| `PROVIDER_MODELS` | `models` | `alias \|\| id` |
| `PROVIDER_OAUTH` | `oauth` | `id` |
| `PROVIDER_MEDIA` | the media keys (`serviceKinds`, `ttsConfig`, `searchConfig`, …) | `id` |

At v1.2.5 the maps stand at **145** dialable · **1,978 models across 165 keys** ·
**26** OAuth · **103** media keys. The model count includes the TTS voice
tables, keyed by synthetic names (`openai-tts-models`, `openai-tts-voices`,
`gemini-tts-voices`, `elevenlabs-tts-models`, …) rather than provider ids.

```bash
node -e "import('./open-sse/providers/index.js').then(m=>console.log('PROVIDERS',Object.keys(m.PROVIDERS).length,'MEDIA',Object.keys(m.PROVIDER_MEDIA).length,'MODELS-KEYS',Object.keys(m.PROVIDER_MODELS).length,'OAUTH',Object.keys(m.PROVIDER_OAUTH).length))"
```

### The entry contract

Only `id` and `category` are strictly required; everything else is optional and
derived. Full contract: `open-sse/providers/schema.js`. Worked example:
`REGISTRY_TEMPLATE.js`.

| Field | Purpose |
|-|-|
| `id` | **required** — kebab-case, unique. The key into `PROVIDERS` |
| `category` | **required** — `apikey` · `oauth` · `freeTier` · `free` · `webCookie` |
| `alias` · `aliases[]` · `uiAlias` | short key for `PROVIDER_MODELS` and `provider/model` addressing; further lookup tokens; UI badge |
| `authType` · `authModes[]` · `hasOAuth` · `noAuth` | how the provider is authorized |
| `display` | `{ name, icon, color, textIcon, website, notice, deprecated, kindNotice, mediaPriority }` |
| `transport` | **the chat transport** — `{ baseUrl, format, headers, auth, forceStream, urlSuffix, quirks, retry, regions, validateUrl, … }` |
| `oauth` | the OAuth flow — `clientId`, `authorizeUrl`, `tokenUrl`, `deviceCodeUrl`, `refreshLeadMs`, … |
| `media` / kind fields | `serviceKinds[]`, `ttsConfig`, `sttConfig`, `embeddingConfig`, `imageConfig`, `searchConfig`, `fetchConfig` |
| `models[]` | the model list; omit the key for "no models", `[]` for an explicit empty |
| `priority` · `hasFree` · `features` · `thinkingConfig` · `passthroughModels` | ordering hint (lower first) · free-tier marker · `{ usage: true }` · reasoning UI · forward the client's model id untouched |

**`oauth` is canonical for shared fields** — `clientId` / `clientSecret` /
`tokenUrl` are injected into `transport` at build time. Declare them in `oauth`
only, never in both.

### A minimal entry, in full

`open-sse/providers/registry/groq.js` — an API-key provider that is
OpenAI-compatible, so it declares no executor at all:

```js
export default {
  id: "groq",
  priority: 60,
  hasFree: true,
  alias: "groq",
  display: { name: "Groq", icon: "speed", color: "#F55036", textIcon: "GQ",
             website: "https://groq.com", notice: { apiKeyUrl: "https://console.groq.com/keys" } },
  category: "apikey",
  transport: {
    baseUrl: "https://api.groq.com/openai/v1/chat/completions",
    validateUrl: "https://api.groq.com/openai/v1/models",
  },
  models: [{ id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" }],
};
```

`format` is omitted because `PROVIDER_DEFAULTS.format` is `"openai"` and the
runtime re-applies it. Declare only what differs — which is why 97 of the 145
transports declare no format at all.

### Aliases

**60 of the 186** imported entries carry an `alias` differing from their `id` —
it is what a client types before the slash (`kr/claude-sonnet-4.5`), what keys
`PROVIDER_MODELS`, and what the second `PROVIDER_PRICING` stratum falls back to
when the registry id misses, so it is a pricing key rather than a cosmetic one.
Three entries declare no `alias` at all (`gemini-cli`, `gitlab`, `mmf`) and are
reached by id only; `aliases[]` adds further tokens for 100+ entries
(`grok-cli: grok-build, gb` · `bedrock: aws-bedrock` · `kimi: kimi-coding, kmc` ·
`nous: nous-portal, nous-research, ns` · …).

```bash
# 60 — aliases differing from their id
node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.filter(e=>e.alias&&e.alias!==e.id).length))"
```

Notable mappings: `cc`→`claude` · `kr`→`kiro` · `ag`→`antigravity` · `cx`→`codex` ·
`cu`→`cursor` · `qd`→`qoder` · `gcli`→`grok-cli` · `fb`→`freebuff` ·
`mimofree`→`mimo-free` · `oc`→`opencode` · `je`→`jerouter` · `gh`→`github` ·
`hunyuan`→`tencent` · `if`→`iflow` · `mtr`→`mytraceroute` · `zd`→`zed` ·
`ja`→`jembatanai` · `el`→`elevenlabs` · `polly`→`aws-polly` · `qianfan`→`baidu` ·
`brx`→`bedrock-xai`.

✅ **No alias is claimed twice today.** `gcli` once pointed at both
`gemini-cli` and `grok-cli`; `gemini-cli` now declares no alias and carries a
comment saying why. Resolution is still last-write-wins in
`ALIAS_TO_PROVIDER_ID`, so prefer the full id in anything durable. Five
**media-only** aliases remain hand-seeded there (`MEDIA_ONLY_ALIASES`) because
those lanes carry no `transport`: `el` → `elevenlabs`, `jina` / `jina-ai` →
`jina-ai`, `polly` / `aws-polly` → `aws-polly`.

---

## 🚢 The Roster

The registry's own `category` field is the lane authority — it drives the
dashboard's grouping, and the resilience profiles key their thresholds on it. Of
the **145 dialable chat transports**:

| Lane (`category`) | Chat transports | What it means |
|-|-|-|
| `apikey` | **96** | pay-per-use API keys |
| `oauth` | **23** | subscription / session-based sign-in |
| `freeTier` | **16** | a metered or genuinely free allowance |
| `webCookie` | **7** | driven through a web session cookie |
| `free` | **3** | no cost, no key |

Across *all* 186 imported entries the histogram reads **apikey 131 · oauth 23 ·
freeTier 22 · webCookie 7 · free 3** = 186. The jumps between the two
histograms are the media-only lanes: they are overwhelmingly keyed API services,
so `apikey` swells by 35 when they are counted, and `freeTier` by 6.

```bash
node -e "import('./open-sse/providers/registry/index.js').then(m=>{const c={};m.default.filter(e=>e.transport).forEach(e=>c[e.category]=(c[e.category]||0)+1);console.log(c)})"
```

### The 96 `apikey` lanes

```
a6api · agentrouter · agentrouter-pro · ai21 · alibaba · alibaba-intl · alicode · alicode-intl · alims-intl · alitp-intl
anthropic · assemblyai · atria · azure · bai · baidu · bandelbanget · baseten · bedrock · bedrock-xai
blackbox · bluesminds · bytez · cerebras · chutes · codecrafters · codestral · cohere · commandcode · dahl
databricks · deepgram · deepinfra · deepseek · featherless · fireworks · friendliai · galadriel · gemini-cli · gigachat
glm · glm-cn · groq · heroku · hyperbolic · jembatanai · jerouter · llamagate · llm7 · madefaka
minimax · minimax-cn · mistral · mmf · morph · muse-spark-lite · muse-spark-web · mytraceroute · nanobanana · nanogpt
nebius · nesarouter · nscale · ollama-local · openai · opencode-go · opencode-zen · ovhcloud · perplexity · perplexity-agent
predibase · publicai · qwen · qwen-v2 · qzz · sambanova · sensenova · siliconflow · snowflake · tencent
together · tokenharbor · tokenrouter · upstage · venice · vercel-ai-gateway · vertex-partner · volcengine · volcengine-ark · wandb
weizerouter · xiaomi-mimo · xiaomi-tokenplan · zcode · zcode-lite · zenmux
```

### The 23 `oauth` lanes

```
antigravity · claude · cline · clinepass · codebuddy-cn · codebuddy-intl · codex · cursor · github · gitlab
grok-cli · iflow · kilocode · kimi · minimax-code · minimax-code-global · muse · qoder · qoder-cn · workbuddy-cn
workbuddy-intl · xai · zed
```

These are the lanes where a *subscription* answers instead of a per-token bill —
the classic combo shape puts them first. Four are the CodeBuddy / WorkBuddy
family (`codebuddy-cn`, `codebuddy-intl`, `workbuddy-cn`, `workbuddy-intl`),
alongside two Qoder shores (`qoder`, `qoder-cn`) and two MiniMax-code shores
(`minimax-code`, `minimax-code-global`).

### The 16 `freeTier` lanes

```
agnes · api-airforce · bazaarlink · byteplus · cloudflare-ai · freebuff · gemini · kilo-gateway
kimchi · nous · nvidia · ollama · opencode · openrouter · poolside · vertex
```

### The 7 `webCookie` lanes and the 3 `free` lanes

```
chatgpt-web · deepseek-web · gemini-web · grok-web · muse-web · perplexity-web · uc-web   # session cookie, not an API key
devin-cli-pro · kiro · mimo-free                                                          # no cost, no key
```

### The 41 media, search, and embedding providers

No chat transport, therefore never in `PROVIDERS` — and note the arithmetic: they
are **41 of the 186**, closing the dialable gap exactly. Each declares
`serviceKinds`, and nearly all add a matching `*Config` block (only `topaz` and
`v1m` declare kinds alone), and is dispatched by its own handlers (TTS voices through `/api/media-providers/tts/*`, the rest through the
`/v1` media routes in [API.md](./API.md#-media-search--fetch)).

| Kind | Count | Providers |
|-|-|-|
| `webSearch` | 22 | `antigravity` · `brave-search` · `exa` · `gemini` · `glm` · `google-pse` · `kimi` · `linkup` · `minimax` · `ollama-search` · `openai` · `perplexity` · `perplexity-agent` · `searchapi` · `searxng` · `serper` · `tavily` · `tinyfish` · `vercel-ai-gateway` · `xai` · `xquik` · `youcom` |
| `image` | 28 | `a6api` · `antigravity` · `black-forest-labs` · `chatgpt-web` · `cloudflare-ai` · `codex` · `comfyui` · `fal-ai` · `gemini` · `gemini-web` · `huggingface` · `minimax` · `muse-web` · `nanobanana` · `openai` · `recraft` · `runwayml` · `sdwebui` · `sensenova` · `stability-ai` · `tokenrouter` · `topaz` · `uc-web` · `venice` · `veoaifree-web` · `vercel-ai-gateway` · `xai` · `zenmux` |
| `tts` | 19 | `aws-polly` · `cartesia` · `coqui` · `edge-tts` · `elevenlabs` · `fish-audio` · `gemini` · `google-tts` · `inworld` · `local-device` · `minimax` · `minimax-cn` · `nvidia` · `openai` · `openrouter` · `playht` · `selfhosted-tts` · `tortoise` · `xiaomi-mimo` |
| `embedding` | 18 | `a6api` · `fireworks` · `gemini` · `github` · `jina-ai` · `madefaka` · `mistral` · `nebius` · `nvidia` · `openai` · `openrouter` · `selfhosted-embedding` · `together` · `tokenrouter` · `venice` · `vercel-ai-gateway` · `voyage-ai` · `zenmux` |
| `imageToText` | 13 | `anthropic` · `gemini` · `groq` · `kimchi` · `minimax` · `mistral` · `nous` · `openai` · `openrouter` · `sensenova` · `vercel-ai-gateway` · `vertex` · `xai` |
| `stt` | 7 | `assemblyai` · `deepgram` · `gemini` · `groq` · `huggingface` · `openai` · `selfhosted-stt` |
| `webFetch` | 6 | `exa` · `firecrawl` · `jina-reader` · `ollama` · `tavily` · `tinyfish` |
| `video` | 4 | `muse-web` · `uc-web` · `veoaifree-web` · `xai` |
| `systemone` | 2 | `opencode-zen` · `v1m` |

That is **119 non-`llm` kind-memberships** across **82 distinct providers**,
because a provider that speaks several media kinds appears in several rows —
`gemini` and `openai` are each in six, `exa` and `tavily` each carry search and
fetch, `huggingface` carries image and STT.

The 41 with no transport is a *smaller* set than those 82: the other 41 of the
82 also chat. And the built `PROVIDER_MEDIA` map carries **103 keys** — the 41
media-only providers plus **62** that also hold a transport — which is why a
media key is not the same thing as a media-only provider. The `selfhosted-*` three are the "point it at your own
box" lanes.

```bash
# the kind histogram, from the built map
node -e "import('./open-sse/providers/index.js').then(m=>{const k={};Object.values(m.PROVIDER_MEDIA).forEach(e=>(e.serviceKinds||[]).forEach(s=>k[s]=(k[s]||0)+1));console.log(k)})"
```

> ⚠️ **`serviceKinds` includes `llm`** on 51 visual/provider keys — its presence
> means "this lane also chats", not "this is a media lane". The media-only set is
> defined by the absence of `transport`, which is the measurement the census test
> enforces.

### The 3 on disk but not dialable

The hidden three are commented in the generated index, each with its reason
inline — each still has an executor written, with the wiring withheld:

```js
// Temporarily hidden — no tool calling support (trae SOLO agent / windsurf gRPC skip ToolCallChunk).
// Files stay on disk; re-enable by removing the name from HIDDEN in this script and
// tests/unit/provider-registry-census.test.js, then re-running the emitter.
// hidden (not imported): ./devin-cli.js
// hidden (not imported): ./trae.js
// hidden (not imported): ./windsurf.js
```

---

## 🧵 Wire Formats

`transport.format` names the dialect an upstream speaks. Of the **145 dialable
transports** (histogram above — summed by command, never transcribed):

| `format` | Count | Providers |
|-|-|-|
| *(unset — `PROVIDER_DEFAULTS` supplies `"openai"`)* | 97 | everything not listed below |
| `openai` — declared on the entry | 26 | `ai21` · `alibaba` · `alibaba-intl` · `agentrouter` · `agentrouter-pro` · `chatgpt-web` · `databricks` · `deepseek-web` · `devin-cli-pro` · `freebuff` · `gemini-cli` · `gemini-web` · `jerouter` · `kimchi` · `mimo-free` · `muse-spark-web` · `muse-spark-lite` · `muse-web` · `nous` · `qwen` · `qwen-v2` · `snowflake` · `uc-web` · `zcode` · `zcode-lite` · `zed` |
| `claude` | 9 | `anthropic` · `bedrock` · `claude` · `glm` · `kimi` · `minimax` · `minimax-cn` · `minimax-code` · `minimax-code-global` |
| `openai-responses` | 3 | `codex` · `grok-cli` · `perplexity-agent` |
| `ollama` | 2 | `ollama` · `ollama-local` |
| one each | 8 | `antigravity` · `commandcode` · `cursor` · `gemini` · `grok-web` · `kiro` · `perplexity-web` · `vertex` |

`ENDPOINT_DEFAULTS` in `open-sse/providers/schema.js` names each format's default
endpoint (`/chat/completions` for openai, `/messages` for claude,
`/{model}:streamGenerateContent` for gemini); a provider overrides only what
differs. Two more fields, both measured on the 145:

- **`validateUrl`** — declared on **66**. This is the door the dashboard's provider
  test probes; without one, the chat path itself is the test.
- **`quirks`** — declared on **14**: `alicode` · `alicode-intl` · `alims-intl` ·
  `alitp-intl` · `cerebras` · `claude` · `cline` · `clinepass` · `codestral` ·
  `deepseek` · `minimax` · `minimax-cn` · `mistral` · `opencode`.

> 📌 **`transport.executor` is not how routing happens.** The field exists in the
> schema and `PROVIDER_DEFAULTS` pins it to `"default"` — but **no registry entry
> sets it** (0 of 186 at v1.2.5), and `getExecutor(provider)` keys on the
> **provider id**. Leave it alone; reach for `executors/index.js` instead.

---

## ⚙️ Executors

`open-sse/executors/` is the per-provider upstream call layer: **43 files** at the
top level — **42 besides `index.js`** — plus **four** subdirectories that hold the
bespoke browser-session transports:

| Location | Files | What |
|-|-:|-|
| `open-sse/executors/*.js` | 43 | 42 besides `index.js`: **36 executor modules** + 6 machinery (2 classes, 4 helpers) |
| `chatgpt-web/` | 10 | the ChatGPT web-session transport |
| `gemini-web/` | 5 | the Gemini web-session transport |
| `muse-web/` | 3 | the Muse web-session transport |
| `deepseek-web/` | 2 | the DeepSeek web-session transport |

```bash
ls open-sse/executors/*.js | wc -l          # 43  (42 excluding index.js)
ls -d open-sse/executors/*/                 # the four subdirs
find open-sse/executors -mindepth 2 -type f | wc -l   # 20 files inside them
```

The 42 are not 42 executors. **36 are dialed by the map** (36 distinct classes,
49 keys — see below). The other six are machinery: `base.js` (`BaseExecutor`) and
`default.js` (`DefaultExecutor`) are classes but carry no provider id of their own,
and four are helpers shared between transports — `chatgptWebTools.js` and
`browserExecutableCheck.js` (used by the web-session executors),
`deepseek-web-done-terminator.js`, and `grok-web-tools.js`, which no other file
imports today — a bridge written but not yet wired, worth a look before it rots.

**`default.js` handles any OpenAI-compatible provider.** `getExecutor` looks the
provider id up in its map; on a miss it memoizes a `DefaultExecutor` for that id
and returns it. Most of the 145 never need anything else.

```js
const executors = { azure: new AzureExecutor(), kiro: new KiroExecutor(), /* … */ };

export function getExecutor(provider) {
  if (executors[provider]) return executors[provider];
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}
```

The map holds **49 keys against 36 distinct executor classes** — the extra keys
are aliases onto the same instance, plus one parameterized class serving several
ids:

| Class | Keys |
|-|-|
| `CodeBuddyFamilyExecutor` | `codebuddy-cn` · `codebuddy-intl` · `workbuddy-cn` · `workbuddy-intl` (one profile each) |
| `GrokCliExecutor` | `grok-cli` · `gcli` · `gb` |
| `BedrockExecutor` | `bedrock` · `bedrock-xai` |
| `VertexExecutor` | `vertex` · `vertex-partner` (parameterized by id) |
| `OpenCodeZenExecutor` | `opencode-zen` · `ocz` |
| `OpenCodeGoExecutor` | `opencode-go` · `ocg` |
| `MinimaxCodeExecutor` | `minimax-code` · `minimax-code-global` |
| `CursorExecutor` | `cursor` · `cu` |
| `MimoFreeExecutor` | `mimo-free` · `mmf` |
| `FreebuffExecutor` | `freebuff` · `fb` |
| one each (26 classes) | `antigravity` · `azure` · `chatgpt-web` · `codex` · `commandcode` · `deepseek-web` · `devin-cli` · `gemini-cli` · `gemini-web` · `github` · `grok-web` · `iflow` · `kimchi` · `kiro` · `muse-web` · `ollama-local` · `opencode` · `perplexity-web` · `qoder` · `trae` · `uc-web` · `veoaifree-web` · `windsurf` · `xiaomi-mimo` · `xiaomi-tokenplan` · `zed` |

49 = 4 + 3 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 26. `hasSpecializedExecutor()`
answers the question directly. The runtime import of this module pulls
`@/lib` through `src/lib/db/paths.js`, so it resolves inside Next, not under a
bare `node -e` — count the map from source, or through the census suite.

```bash
sed -n '40,90p' open-sse/executors/index.js | grep -cE '^\s+("?[a-z0-9-]+"?:)'   # 49
```

### The specialized, by why

| Executor | Registry id(s) | Why it is not `default` |
|-|-|-|
| `azure.js` | `azure` | Azure deployment paths + `api-version` |
| `bedrock.js` | `bedrock` · `bedrock-xai` | AWS Bedrock signing and event framing |
| `vertex.js` | `vertex` · `vertex-partner` | GCP Vertex REST + service-account auth |
| `codex.js` | `codex` | ChatGPT backend Responses API under OAuth |
| `gemini-cli.js` | `gemini-cli` | Code Assist request framing |
| `cursor.js` | `cursor` (`cu`) | **protobuf** — ConnectRPC framing (`utils/cursorProtobuf.js`) |
| `kiro.js` | `kiro` | **binary EventStream** — AWS event framing, 24 MB/message ceiling |
| `commandcode.js` | `commandcode` | **NDJSON** — one AI-SDK-v5 event per line, no `data:` prefix |
| `zed.js` | `zed` | NDJSON framing |
| `minimax-code.js` | `minimax-code` · `minimax-code-global` | Anthropic-dialect under a MiniMax subscription |
| `codebuddy-family.js` | `codebuddy-cn` · `codebuddy-intl` · `workbuddy-cn` · `workbuddy-intl` | one class, four profiles (v1.2.4 — the Four Shores) |
| `grok-cli.js` | `grok-cli` (`gcli`, `gb`) | `openai-responses` dialect + CLI identity |
| `grok-web.js` | `grok-web` | browser session cookie, not an API key |
| `perplexity-web.js` | `perplexity-web` | browser session cookie, not an API key |
| `chatgpt-web.js` · `gemini-web.js` · `deepseek-web.js` · `muse-web.js` · `uc-web.js` · `veoaifree-web.js` | their own ids | bespoke web-session transports — the first four ship their parsing helpers in a subdirectory |
| `ollama-local.js` | `ollama-local` | the Ollama wire (`utils/ollamaTransform.js`) |
| `antigravity.js` · `github.js` · `iflow.js` · `qoder.js` · `kimchi.js` · `opencode.js` · `opencode-go.js` · `opencode-zen.js` · `freebuff.js` · `mimo-free.js` · `xiaomi-mimo.js` · `xiaomi-tokenplan.js` | their own ids | a bespoke session transport for one lane each |
| `trae.js` · `windsurf.js` · `devin-cli.js` | hidden ids | written, wired out — see the roster above |

### ⚠️ The binary rule

**Binary and protobuf upstreams do not round-trip through the translator.** Kiro's
EventStream, Cursor's protobuf, CommandCode's NDJSON, and Windsurf's gRPC-web
frames are parsed *inside their own executor*, which then emits ordinary OpenAI
chunks so the rest of the pipeline sees a normal stream.

> *"Special binary/protobuf formats (kiro EventStream, cursor protobuf, commandcode
> NDJSON) don't round-trip through OpenAI — handle in their executor."* —
> `open-sse/AGENTS.md`, Pitfalls

Do not add such a provider as a registry entry plus a request/response translator
pair. If the framing is not HTTP + JSON, the executor owns it.

### The base class

`BaseExecutor` (`base.js`) supplies the overridable surface: `getBaseUrls()`
(region / deployment URL selection), `buildHeaders()` (auth + fingerprint),
`buildUrl()` (path assembly, query suffixes), and `execute()` (the whole upstream
call, for bespoke transports). Register a new executor in the `executors` map in
`open-sse/executors/index.js`; the `DefaultExecutor` fallback covers everything
else.

---

## 🛠️ Adding a Provider

### The plain case — an OpenAI-compatible API

1. **Copy the template.** `open-sse/providers/REGISTRY_TEMPLATE.js` →
   `open-sse/providers/registry/{id}.js`. Delete every block you do not need.
2. **Declare the minimum.** `id` and `category` are required; add `display`,
   `transport.baseUrl`, and `models`. `format` defaults to `"openai"`.
3. **Add models to `open-sse/config/providerModels.js`** if the provider needs the
   alias→models matrix beyond the co-located `models[]` array.
4. **Add an executor — only if the upstream is NOT OpenAI-compatible.** Most
   providers never need one. If you do, subclass `BaseExecutor` and register it in
   the `executors` map in `open-sse/executors/index.js`.
5. **⚠️ Regenerate the index, then verify it landed.** This is the step that
   fails silently — see below.

### ✅ The index is generated — and the emitter is here

`registry/index.js` is an **auto-generated static import list** — 186
`import pN from "./{id}.js"` lines followed by an array literal — **not** a
directory scan. Its first line says so:

```js
// GENERATED by scripts/generate-registry-index.mjs — do not hand-edit.
```

```js
import p0 from "./a6api.js";
import p1 from "./agentrouter.js";
…
export default [ p0, p1, p2, /* … */ p185 ];
```

**The law:** run the emitter, never hand-edit. **The state of the harbor:** the
emitter is tracked and live.

```bash
node scripts/generate-registry-index.mjs          # emits registry/index.js
node scripts/generate-registry-index.mjs --dry    # shows the census, writes nothing
```

> 📜 **This was once the chart's largest ⚠️, and it is healed.** The two scripts
> that previously touched the index (`migrate-registry.mjs`,
> `injectDisplayToRegistry.mjs`) were untracked and then lost — and *neither
> emitted the index*, so the 2026-09-04 drift had no repair path. What is
> tracked in `scripts/` today is `copy-standalone-assets.mjs`,
> **`generate-registry-index.mjs`**, `icon-ligatures.txt`,
> `icon-subset-manifest.json`, `subset-icons.py`, and `sync-changelog.mjs`. The
> emitter scans `registry/*.js` in `LC_ALL=C` byte order, holds `HIDDEN` in
> lockstep with `tests/unit/provider-registry-census.test.js`, and is
> deterministic — same directory, same bytes.

**Therefore, today, the honest path is:**

1. Write `registry/{id}.js`.
2. Run `node scripts/generate-registry-index.mjs` — it appends the import and the
   array entry for you, in byte order.
3. **Verify it landed** — the imported count must move by exactly one, and the
   dialable count by exactly one *only if* you declared a `transport`:

```bash
node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"                    # 186 → 187
node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"               # 145 → 146 (chat transport)
node -e "import('./open-sse/providers/index.js').then(m=>console.log(!!m.PROVIDERS['{id}']))"                         # true
```

> ⚠️ **This is precisely how the old 17-file gap happened** — provider files were
> committed while the index went stale. Adding a provider without confirming the
> counts move is how a "supported" lane ships dead. The census suite now fails
> loudly if a disk file is neither imported nor named in `HIDDEN`.

### The media case — no chat transport

A TTS, STT, embedding, image, or search provider declares no `transport` at all;
it declares service kinds instead:

```js
export default {
  id: "tavily",
  alias: "tavily",
  category: "apikey",
  authType: "apikey",
  serviceKinds: ["webSearch", "webFetch"],
  searchConfig: { baseUrl: "https://api.tavily.com/search", method: "POST",
                  authType: "apikey", authHeader: "bearer",
                  costPerQuery: 0.008, freeMonthlyQuota: 1000, defaultMaxResults: 5 },
  fetchConfig: { baseUrl: "https://api.tavily.com/extract", method: "POST",
                 authType: "apikey", authHeader: "bearer", formats: ["markdown", "text"] },
};
```

It will not appear in `PROVIDERS` — that is correct, and it is one of the 41.
Its service kinds land in `PROVIDER_MEDIA`, and the dashboard surfaces it under
**Media Providers** with the API at `/api/media-providers/*`.

### Verifying a live provider

The dashboard doors under `/api/providers`: `GET /api/providers` (the list as the
UI sees it) · `POST /api/providers/validate` (validate a credential before saving)
· `POST /api/providers/[id]/test` · `POST /api/providers/test-batch` ·
`GET /api/providers/[id]/models` · `POST /api/providers/[id]/test-models` ·
`/api/providers/[id]/overrides` · `/api/providers/status` ·
`/api/providers/web-login` · `/api/providers/client`. The UI lives at
`/dashboard/providers`, with `/dashboard/providers/new` and
`/dashboard/providers/[id]`.

Per-category failure thresholds come from `open-sse/config/providerProfiles.js` —
`oauth` (flaky but recoverable, more headroom), `apikey` (fast recovery, but can
spam many accounts), `local` (fail fast). Twelve `VELA_PROVIDER_FAILURE_*`
variables tune them; see [ENVIRONMENT.md](./ENVIRONMENT.md).

---

## 💰 Pricing

Provider rates are **not** in the registry. They live in
`open-sse/providers/pricing.js` — hand-maintained static tables (`MODEL_PRICING`,
`PROVIDER_PRICING`, `PATTERN_PRICING`, `FREE_ALIAS_MAP`, `FREE_DENYLIST`,
`UNPRICEABLE`, `SYNC_VENDOR_MAP`) — with an async overlay in
`src/lib/db/repos/pricingRepo.js`.

The **seven-stratum static chain** and the sovereignty order above it (user
overrides → synced rates → static) are documented in full in
[ARCHITECTURE.md](./ARCHITECTURE.md) and `open-sse/AGENTS.md`. Do not duplicate it
here. Two facts matter at the provider level:

- **The registry `alias` is a pricing key** — `PROVIDER_PRICING` is consulted under
  the registry id *and then* under the alias (`providerOverride()`), which is why
  the 60 mismatched aliases are load-bearing.
- **A model that matches nothing resolves `null`** — estimated cost shows `$0`.
  Adding its rate, or a pattern, is the fix. `UNPRICEABLE` is the one *named*
  null: router pseudo-models and no-token-pricing lanes resolve `null` with a
  reason, so "unpriced" and "free" never read alike.

```bash
grep -nE "^export const (MODEL_PRICING|PROVIDER_PRICING|PATTERN_PRICING|FREE_ALIAS_MAP|FREE_DENYLIST|UNPRICEABLE|SYNC_VENDOR_MAP)" open-sse/providers/pricing.js
```

---

## 🔗 See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) — request lifecycle, the translator, the pricing chain
- [API.md](./API.md) — the gateway surface and the dashboard REST doors
- [ENVIRONMENT.md](./ENVIRONMENT.md) — every `VELA_*` variable, including the provider-failure knobs
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — when an upstream refuses
- [../open-sse/AGENTS.md](../open-sse/AGENTS.md) — the engine contributor guide
- [../DOCKER.md](../DOCKER.md) — sailing the image

— *Vela · The Sail of the Ship* ⛵
