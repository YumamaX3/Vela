<div align="center">
  <img src="./public/vela-wordmark.svg" alt="Vela — the sail of the ship" width="520"/>

  **One OpenAI-compatible endpoint. 40+ upstream providers. Your subscriptions, your keys, your free tiers — one harbor, one sail.**

  Vela routes your AI coding tools (Claude Code, Codex, Cursor, Cline, OpenCode…) through a single local gateway with format translation, model-combo fallback, multi-account rotation, quota tracking, and an RTK token saver that cuts 20–40% of tool-output tokens before they leave the harbor.

  [![Version](https://img.shields.io/badge/version-0.6.80-blue?style=flat-square)](./CHANGELOG.md)
  [![Providers](https://img.shields.io/badge/providers-129-0ea5e9?style=flat-square)](./docs/PROVIDERS.md)
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
│                  Vela — the gateway                  │
│  RTK token saver · format translation · quota track  │
│  combo fallback · multi-account · OAuth refresh      │
└──────┬──────────────────────────────────────────────┘
       ├─→ Tier 1  SUBSCRIPTION   Claude, Codex, Copilot, Cursor…
       ├─→ Tier 2  PAY-PER-USE    GLM, MiniMax, DeepSeek, Qwen…
       └─→ Tier 3  FREE           Kiro, OpenCode Free, MiMo Free…

       Result: every subscription token spent, every rate limit routed around.
```

Under the hood: a Next.js server (dashboard + API) on port **32060**, a provider-agnostic routing engine (`open-sse/`), and a SQLite database that can grow a MariaDB twin when you want one (sqlite → mysql → mirror).

> 📌 **Note:** Vela is a fork of [9Router](https://github.com/decolua/9router), rebranded and reforged — the storage, backup, pricing, and category systems are Vela's own. The CLI launcher keeps the `9router` npm name for install compatibility.

---

## 🤔 Why Vela?

| The problem | What Vela does |
|-|-|
| ❌ Subscription quota expires unused | ✅ Quota tracking + auto-fallback — spend every token before reset |
| ❌ Rate limits stop you mid-flow | ✅ Multi-account rotation + model-combo fallback, zero downtime |
| ❌ Tool output burns tokens (diffs, grep, ls…) | ✅ **RTK token saver** compresses `tool_result` content in-place — 20–40% saved |
| ❌ Paying $20–50/mo per provider | ✅ One gateway across subscription + cheap + free lanes |
| ❌ Every tool needs its own config | ✅ One OpenAI-compatible endpoint, every tool speaks it |

---

## ✨ Key Features

**🧭 Routing & Translation**
- One OpenAI-compatible endpoint: `/v1/chat/completions`, `/v1/messages` (Claude-native), `/v1/embeddings`, `/v1/images/generations`, `/v1/audio/*`, `/v1/responses`, `/v1/videos/*`, web search & fetch
- Format translation pivots through OpenAI as the intermediate — direct routes registered for fragile pairs (thinking blocks, tool ids)
- **129 providers** registered: OpenAI, Anthropic, Google Gemini, xAI, DeepSeek, Qwen, GLM, MiniMax, Kimi, Mistral, Groq, Cerebras, Vertex, Azure, Ollama, and dozens more — [full roster](./docs/PROVIDERS.md)

**🪂 Resilience**
- Model-combo fallback: define a combo, Vela walks the list until one answers
- Multi-account fallback per provider, round-robin rotation
- OAuth + API-key credential management with automatic token refresh

**💰 Cost Intelligence — the Pricing Covenant**
- Static price table (input / output / cached / reasoning / cache-creation, $/1M tokens) with a six-step resolution chain — provider overrides, exact match, free-model inheritance, vendor-strip, glob fallback
- Dashboard price editor + models.dev sync — every request gets an honest est. cost
- Free-tier detection: free models inherit their paid sibling's rate so savings are visible

**🐚 RTK Token Saver**
- Pre-translate hooks compress `tool_result` content before the request leaves — fail-open by design, never touches `is_error` traces
- Optional [Headroom](https://github.com/chopratejas/headroom) sidecar for deeper compression

**🗝️ Storage Covenant**
- Three postures, one env var: `VELA_DB_MODE=sqlite|mysql|mirror`
- SQLite harbor by default; MariaDB as a full harbor; or **mirror** — SQLite serves while every write pumps to the MariaDB twin, guarded by a divergence sweep
- Sealed backup engine: AES-256-GCM artifacts, retention tiers, drill + restore, optional S3 off-site leg

**🖥️ Dashboard** — `http://localhost:32060/dashboard`
- Providers & OAuth flows, combos, endpoints + API keys, per-key usage, quota, token saver, translator console, CLI-tool setup pages, pricing settings — in 34+ interface locales

---

## 🚀 Quick Start

### Option A — Docker (recommended)

```bash
docker login ghcr.io          # PAT with read:packages — the image is private
docker pull ghcr.io/yumamax3/vela:0.6.70

docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:0.6.70
```

For the full chart — MariaDB twin, mirror posture, backup engine, Headroom sidecar — see [DOCKER.md](./DOCKER.md) and the [`docker-compose.example.yml`](./docker-compose.example.yml) template.

### Option B — npm CLI

```bash
npm install -g 9router
9router
```

The CLI installs, starts, and manages the server (the launcher package keeps the `9router` name on npm).

### Option C — From source

```bash
git clone <this repo> && cd Vela
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
```

Production: `npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start`

### Then connect a tool

1. Open `http://localhost:32060/dashboard` (default password `123456` — change it)
2. **Providers** → connect one (Kiro AI is a good free start)
3. **Endpoints** → copy an API key
4. Point your tool at the gateway:

```
Endpoint: http://localhost:32060/v1
API Key:  <from dashboard>
Model:    kr/claude-sonnet-4.5      # provider prefix / model name
```

---

## 📚 Documentation

The charts live in [`docs/`](./docs/README.md) — a full harbor map.

| Chart | What it covers |
|-|-|
| [docs/README.md](./docs/README.md) | 🧭 The harbor map — every doc, one page |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 🏗️ Request lifecycle, translator engine, provider registry, DB layer |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | 🚀 Install paths, compose chart, storage postures, upgrading |
| [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md) | 🔧 The complete env-var contract |
| [docs/STORAGE.md](./docs/STORAGE.md) | 🗝️ Storage Covenant — sqlite/mysql/mirror, backups, S3 |
| [docs/PROVIDERS.md](./docs/PROVIDERS.md) | 🌐 The full 129-provider roster |
| [docs/API.md](./docs/API.md) | 🔌 The OpenAI-compatible surface + dashboard APIs |
| [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) | 🧯 When the wind dies |
| [docs/VERSIONING.md](./docs/VERSIONING.md) | ⛵ The versioning covenant |
| [DOCKER.md](./DOCKER.md) | 🐳 Docker, deep |
| [CHANGELOG.md](./CHANGELOG.md) | 📖 The ship's log |

**For engineers working in this repo:** [CLAUDE.md](./CLAUDE.md) — the crew's papers.
**For engine contributors:** [open-sse/AGENTS.md](./open-sse/AGENTS.md) — how to add a provider / executor / translator.

---

## 🗺️ Repository Map

```
src/                 Next.js app — dashboard UI + /api routes (incl. /v1)
├── app/             pages + API route handlers
├── sse/handlers/    app-side entry glue (chat, tts, images, search…)
└── lib/db/          SQLite/MariaDB layer — driver chain, repos, mirror, backups

open-sse/            the provider-agnostic routing/translation engine
├── handlers/        chatCore, embeddings, tts, images, video, search
├── executors/       per-provider upstream call (29 specialized + default)
├── translator/      format translation via OpenAI pivot
├── providers/       registry (129 files) + pricing covenant
└── rtk/             token saver hooks (fail-open)

cli/                 the launcher package (npm: 9router)
docs/                the charts — start at docs/README.md
plans/               sealed design plans (Storage Covenant, Pricing Covenant…)
tests/               vitest suite (independent ESM package)
i18n/                localized READMEs (10 languages)
```

---

## 🌍 Languages

This README is translated into 10 more languages — links in the banner above. The dashboard itself ships 34+ interface locales; switch from the dashboard profile page.

---

## 🏛️ Provenance & License

Vela forked from [decolua/9Router](https://github.com/decolua/9router) (MIT) and sails its own course from v0.6.0 onward. Upstream credit is kept where it is due; the storage, backup, pricing, and category systems are Vela's own forges. See [LICENSE](./LICENSE).

---

<div align="center">

*Set your sail. The wind is free.* ⛵

</div>
