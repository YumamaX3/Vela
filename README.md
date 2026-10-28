<div align="center">
  <img src="./public/vela-wordmark.svg" alt="Vela — the sail of the ship" width="520"/>

  **One OpenAI-compatible endpoint. 145 dialable upstream transports. Your subscriptions, your keys, your free tiers — one harbor, one sail.**

  Vela routes your AI coding tools (Claude Code, Codex, Cursor, Cline, OpenCode…) through a single local gateway with format translation, model-combo fallback, multi-account rotation, quota tracking, per-key ACL, and an RTK token saver that trims 20–40% of tool-output tokens before they leave the harbor.

  [![Version](https://img.shields.io/badge/version-1.2.4-blue?style=flat-square)](./CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-145%20dialable-0ea5e9?style=flat-square)](./docs/PROVIDERS.md)
  [![Image](https://img.shields.io/badge/image-ghcr.io%2Fyumamax3%2Fvela-181717?style=flat-square&logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)
  [![CLI](https://img.shields.io/npm/v/vela?style=flat-square&label=cli%20%22vela%22)](https://www.npmjs.com/package/vela)
  [![License](https://img.shields.io/badge/license-see%20LICENSE-gray?style=flat-square)](./LICENSE)

  [🚀 Quick Start](#-quick-start) · [✨ Features](#-key-features) · [📚 Docs](#-documentation) · [🌐 Languages](#-languages)

  🇺🇸 [English](./README.md) · 🇨🇳 [中文](./README.zh-CN.md) · 🇮🇩 [Indonesia](./i18n/README.id-ID.md) · 🇯🇵 [日本語](./i18n/README.ja-JP.md) · 🇻🇳 [Tiếng Việt](./i18n/README.vi.md) · 🇧🇷 [Português](./i18n/README.pt-BR.md) · 🇪🇸 [Español](./i18n/README.es.md) · 🇫🇷 [Français](./i18n/README.fr.md) · 🇷🇺 [Русский](./i18n/README.ru.md) · 🇹🇭 [ไทย](./i18n/README.th.md) · 🇮🇷 [فارسی](./i18n/README.fa_IR.md)
</div>

---

## ⛵ What is Vela?

Vela is a **local AI routing gateway + dashboard**. You point every AI tool at one endpoint — `http://localhost:32060/v1` — and Vela decides which provider actually answers: your paid subscriptions first, cheap API lanes next, free tiers last. When one lane runs dry, the next takes the wind. No tool-side changes, no downtime.

```
┌──────────────┐
│  Your tools  │  Claude Code · Codex · Cursor · Cline · OpenCode · …
└──────┬───────┘
       │  http://localhost:32060/v1   (OpenAI-compatible)
       ▼
┌─────────────────────────────────────────────────────┐
│                 Vela — the gateway                  │
│  RTK token saver · format translation · quota track │
│  combo fallback · multi-account · OAuth refresh     │
└──────────┬──────────────────────────────────────────┘
       ├─→ Tier 1  SUBSCRIPTION   Claude, Codex, Copilot, Cursor…
       ├─→ Tier 2  PAY-PER-USE    GLM, MiniMax, DeepSeek, Qwen…
       └─→ Tier 3  FREE           Kiro, OpenCode Free, MiMo Free…
       Result: every subscription token spent, every rate limit routed around.
```

One Node process serves both engines: the **dashboard + API** (`src/`, a Next.js App Router app) and the **routing engine** (`open-sse/`), on port **32060**. State lives in SQLite by default and can grow a MariaDB twin when you want one (`sqlite` → `mysql` → `mirror`). A sealed backup engine watches the harbor's ground, and the gateway stamps every release so the hull can always be proven.

> 📌 **Note:** Vela sails its own course — an AI gateway forged from open waters, with every system its own: storage, backup, pricing, and category. The CLI installs as `vela` from npm. Fork lineage: from v0.6.0 onward the gateway is MIT licensed and fully its own (see [Provenance](#-provenance--license)).

> 🔢 **Count discipline** (measured 2026-10-28, at v1.2.4). The provider registry reports **three honest numbers, and they differ**: **189** registry files on disk → **186** imported by the generated index → **145** dialable chat transports (the other 41 imported lanes carry media, search, and embedding transports that legitimately speak no chat). Three files sit on disk deliberately hidden from the index (`trae`, `devin-cli`, `windsurf`). Never collapse the three into one — name which number you mean, and re-derive rather than trusting this line:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 189 files on disk
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"   # 186 imported
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 dialable
> ```
> The census is pinned as a property by `tests/unit/provider-registry-census.test.js` — a file that lands on disk without an import reddens there before it goes silently dark. See [docs/PROVIDERS.md](./docs/PROVIDERS.md).

---

## 🤔 Why Vela?

| The problem | What Vela does |
|-|-|
| ❌ Subscription quota expires unused | ✅ Quota tracking + auto-fallback — spend every token before reset |
| ❌ Rate limits stop you mid-flow | ✅ Multi-account rotation + model-combo fallback, zero downtime |
| ❌ Tool output burns tokens (diffs, grep, ls…) | ✅ **RTK token saver** compresses `tool_result` content in-place — 20–40% saved |
| ❌ Paying $20–50/mo per provider | ✅ One gateway across subscription + cheap + free lanes |
| ❌ Every tool needs its own config | ✅ One OpenAI-compatible endpoint, every tool speaks it |
| ❌ A provider dies and your flow dies with it | ✅ Circuit breaker + provider-failure thresholds + cooling windows |

---

## ✨ Key Features

**🧭 Routing & Translation**
- One OpenAI-compatible endpoint: `/v1/chat/completions`, `/v1/messages` (Claude-native), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/speech` · `/v1/audio/transcriptions` · `/v1/audio/voices`, `/v1/videos/*` (generations, edits, extensions), `/v1/responses` (+`/compact`), `/v1beta/*`, web search, fetch & scrape
- Format translation pivots through OpenAI as the intermediate — direct routes registered for fragile pairs (thinking blocks, tool ids)
- **145 dialable providers** across subscription, pay-per-use, free, local, and media lanes — [the full roster](./docs/PROVIDERS.md)
- Model addressing is `provider/model` (`kr/claude-sonnet-4.5`) — the prefix names the lane

**🪂 Resilience**
- Model-combo fallback: define a combo, Vela walks the list until one answers
- Multi-account fallback per provider, round-robin rotation
- Circuit breaker per pool — and the breaker **survives a restart**: open windows persist through the bound store, deadlines clamp to a ceiling, and a restored breaker re-arms on one failure, matching in-process law
- Provider-failure thresholds with cooling windows (`VELA_PROVIDER_FAILURE_*`), OAuth + API-key credential management with automatic background token refresh

**💰 Cost Intelligence — the Pricing Covenant**
- Static price table (input / output / cached / reasoning / cache-creation, $/1M tokens) with a six-step resolution chain — provider overrides, exact match, free-model inheritance, vendor-strip, glob fallback
- Dashboard price editor + models.dev sync — every request gets an honest estimated cost
- Free-tier detection: free models inherit their paid sibling's rate so savings stay visible
- Cost is computed at **write time** and frozen — no backfill, no recomputation after rate edits

**🐚 RTK Token Saver**
- Pre-translate hooks compress `tool_result` content before the request leaves — fail-open by design, never touches `is_error` traces
- Operator-defined prompt injectors (append/prepend), layered after the built-in savers
- Optional [Headroom](https://github.com/chopratejas/headroom) sidecar for deeper compression

**🗝️ Storage Covenant**
- Three postures, one env var: `VELA_DB_MODE=sqlite|mysql|mirror`
- SQLite harbor by default; MariaDB as a full harbor; or **mirror** — SQLite serves while every write pumps to the MariaDB twin through an outbox, guarded by a divergence sweep
- Driver chain: `better-sqlite3` → `node:sqlite` (zero-install on Node ≥ 22.5) → pure-JS `sql.js`; `VELA_DB_DRIVER` pins one, failure is loud
- **23 migrations** (`SCHEMA_VERSION = 23`) — a declarative `TABLES` sync keeps both harbors and the twin honest — see [docs/STORAGE.md](./docs/STORAGE.md)
- Sealed backup engine: AES-256-GCM artifacts, retention tiers, restore **drill**, optional S3 off-site leg

**🛡️ Security**
- Per-key ACL — four layers: kinds, providers, combos, models (tri-state allowlists)
- Budget gates: daily caps, spend caps, rate limits per key
- **No default password.** The old `123456` was retired (v0.9.41). With none set, the local console admits you passwordless but **refuses remote logins** until you set one (Settings → Access). API keys mint as `vela-v1-<32 hex>-<8 hex>`; the `sk-` format is rejected everywhere
- OIDC and SAML single sign-on for the dashboard, a JWT strength gate at boot, a session ledger keyed by `jti`, a CSRF lock, and client IP derived from the **TCP socket** (unspoofable) — forwarding headers trusted only from a loop proxy

**🖥️ Dashboard** — `http://localhost:32060/dashboard`
- **31 dashboard rooms** (36 pages total) in **35 interface locales**: providers & OAuth flows, combos, endpoints + API keys, per-key usage, quota, token saver, translator console, CLI-tool setup, proxy fleet, fallback rules, prompt injectors, skills, request logs, and the settings console — start at [the harbor map](./docs/README.md)

---

## 🚀 Quick Start

### Option A — Docker (recommended)

```bash
docker pull ghcr.io/yumamax3/vela:1.2.4
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:1.2.4
```

The image is **public** — no registry login needed — and multi-arch (`linux/amd64` + `linux/arm64`). For the full chart — MariaDB twin, mirror posture, backup engine, Headroom sidecar — see [DOCKER.md](./DOCKER.md), [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md), and the [`docker-compose.example.yml`](./docker-compose.example.yml) template.

### Option B — npm CLI

```bash
npm install -g vela
vela
```

The launcher installs, starts, and manages the server (the npm package keeps the `vela` name; the app itself is the private `vela-app`). See [cli/README.md](./cli/README.md).

### Option C — From source

```bash
git clone https://github.com/YumamaX3/Vela.git && cd Vela
cp .env.example .env
npm install
npm run dev          # serves on 32060
```

Production: `npm run build && npm run start` (Node 22+; Bun works too — `npm run dev:bun` / `build:bun` / `start:bun`).

### Then connect a tool

1. Open `http://localhost:32060/dashboard` — **there is no default password.** The local console enters without one; set a password under **Settings → Access** to enable remote access.
2. **Providers** → connect one (Kiro AI is a good free start)
3. **Endpoints** → mint an API key
4. Point your tool at the gateway:

```
Endpoint: http://localhost:32060/v1
API Key:  vela-v1-…  (from the dashboard)
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

Tool-by-tool wiring (Claude Code, Codex, Cursor, Cline, Roo, Continue) lives in the [integration charts](./gitbook/content/en/) — and drop-in agent skills ready to paste live in [skills/](./skills/README.md).

---

## 📚 Documentation

The charts live in [`docs/`](./docs/README.md) — start at the harbor map. Every doc carries the same voice, and every count carries its re-derivation command: **if a chart and a command disagree, the command wins.**

| Chart | What it covers |
|-|-|
| [docs/README.md](./docs/README.md) | 🧭 The harbor map — every doc, one page |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 🏗️ Request lifecycle, translator engine, provider registry, DB layer, backup engine, pricing covenant |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | 🚀 Install paths, compose chart, exposure & the security gate, upgrading |
| [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md) | 🔧 The complete environment-variable contract |
| [docs/STORAGE.md](./docs/STORAGE.md) | 🗄️ Storage Covenant — sqlite/mysql/mirror, the mirror pump, backups, S3, recovery |
| [docs/PROVIDERS.md](./docs/PROVIDERS.md) | 🌐 The provider roster, the three counts, the executor model |
| [docs/API.md](./docs/API.md) | 🔌 The OpenAI-compatible surface + the dashboard REST surface |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | 🧯 Symptom → cause → fix |
| [docs/VERSIONING.md](./docs/VERSIONING.md) | ⛵ The versioning covenant — bump, log, seal together |
| [DOCKER.md](./DOCKER.md) | 🐳 Docker, deep |
| [CHANGELOG.md](./CHANGELOG.md) | 📖 The ship's log |

Newer hands: the [gitbook](./gitbook/content/en/) is the beginner-facing tour, in five languages. **For engineers working in this repo:** [CLAUDE.md](./CLAUDE.md) — the crew's papers. **For engine contributors:** [open-sse/AGENTS.md](./open-sse/AGENTS.md) — how to add a provider / executor / translator.

---

## 🗺️ Repository Map

```
src/                 Next.js app — dashboard UI + /api routes (incl. /v1)
├── app/             36 pages (31 dashboard rooms) + 255 API route handlers
├── sse/handlers/    app-side entry glue (chat, tts, images, search…)
└── lib/db/          SQLite/MariaDB layer — driver chain, repos, mirror, backups
open-sse/            the provider-agnostic routing/translation engine
├── handlers/        chatCore, embeddings, tts, images, video, search
├── executors/       per-provider upstream call (43 files incl. index)
├── translator/      format translation via OpenAI pivot
├── providers/       registry (190 files incl. index) + pricing covenant
└── rtk/             token saver hooks (fail-open)
cli/                 the launcher package (npm: vela)
docs/               the charts — start at docs/README.md
gitbook/            the beginner tour — 100 pages × 5 languages
skills/             drop-in agent skills (paste a link, done)
tests/              the vitest suite — 480 live test files
i18n/               localized READMEs (10 languages)
plans/               sealed design plans (internal, gitignored)
scripts/             changelog sync, registry generator, icon subset
```

---

## 🌍 Languages

This README is translated into 10 more languages — links in the banner above. The dashboard itself ships **35 interface locales**; switch from **Settings → General → Language**.

---

## 🏛️ Provenance & License

Vela sails its own course from v0.6.0 onward — the gateway is MIT licensed and fully its own. See [LICENSE](./LICENSE).

---

<div align="center">
*Set your sail. The wind is free.* ⛵
</div>