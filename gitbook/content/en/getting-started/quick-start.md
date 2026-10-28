# Getting Started

Five minutes, one endpoint, every tool pointed at it. This page is the fast path; [Installation](../getting-started/installation.md) has the details and the troubleshooting.

---

## Quick Start

### 1. Install

```bash
npm install -g vela
```

You need Node.js 20 or newer. The `vela` command is a small launcher: it starts the gateway and opens your browser.

### 2. Start

```bash
vela
```

The dashboard opens at **http://localhost:32060/dashboard**.

A few things worth knowing on first run:

- There is **no default password**. From the machine running Vela, the dashboard opens straight in. Logins from other machines are refused until you set a password under **Settings → Access**.
- Your data lives in `~/.vela` on macOS and Linux, and in `%APPDATA%\vela` on Windows.
- By default the gateway listens on all network interfaces (`0.0.0.0`). If you only need it on this machine, start it with `vela --host 127.0.0.1`.

### 3. Connect a provider

There are three kinds of provider, and you can mix them freely.

#### Option A — OAuth subscriptions

**Best for:** Claude Code, Codex, GitHub Copilot, Antigravity — anything you already pay for or log into.

```
Dashboard → Providers → pick a provider → Connect
→ Log in in the browser window → done
```

Tokens refresh themselves from then on, and quota tracking starts immediately.

**Example: Claude Code**
1. Open **Providers** and choose **Claude**.
2. Click **Connect**, log in to your Claude account, and approve.
3. Use the model by its full name, e.g. `cc/claude-opus-5`.

#### Option B — API keys

**Best for:** GLM, MiniMax, Kimi, OpenRouter, and any other pay-as-you-go provider.

```
Dashboard → Providers → pick a provider → Add API key
→ paste the key → Save
```

**Example: GLM-4.7**
1. Create an account and a key at your GLM provider.
2. In Vela: **Providers → GLM → Add API key**, paste, save.
3. Use `glm/glm-4.7`.

#### Option C — Free providers

**Best for:** the last line when paid quota runs out.

```
Dashboard → Providers → Connect a free provider
→ Device code or OAuth → done
```

**Example: Kiro**
1. Open **Providers** and choose **Kiro**.
2. Sign in with an AWS Builder ID or a social account.
3. Use `kr/` models — Claude family, at no cost.

### 4. Create an API key for your tools

```
Dashboard → Endpoint & Key → Create Key → copy it
```

Keys look like `vela-v1-<id>-<checksum>`. They are shown once — copy it somewhere safe, or create a new one later if you lose it. Each key can be given its own provider scope, rate limit, token budget and spend ceiling.

### 5. Point your tools at Vela

Every tool needs the same two things: the endpoint and the key.

**Cursor**

```
Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    cc/claude-opus-5     (add it as a custom model)
```

**Cline / Continue / Roo**

```
Provider: OpenAI Compatible
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    cc/claude-opus-5
```

**Claude Code**

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

**Codex CLI**

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
```

Each tool has its own page under [Integration](../integration/claude-code.md) with the exact fields and the usual snags.

---

## 6. Build a fallback chain (optional, but recommended)

A single model is a single point of failure. A **combo** lets you name a chain of models, and Vela walks it until one answers.

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5      (subscription first)
          2. glm/glm-4.7           (cheap backup)
          3. kr/claude-sonnet-4.5  (free last line)
```

Then use `premium-coding` wherever a model name goes. The combo is looked up by name before anything else, so it works in any tool.

A combo falls back when a request fails — a quota error, a rate limit, a timeout, a refused prompt, a model that does not exist. It does **not** switch just because a daily quota is getting low; that would silently spend money. If you want a spend ceiling, set one on the API key (**Endpoint & Key → Create/Edit Key → budget**), and Vela will refuse requests once it is reached with a clear 429 rather than quietly downgrading you.

---

## Available models

Model names are `prefix/model`. Here is a starting set; open **Providers** in the dashboard for the full list — it changes as providers ship new models.

### Subscription lane

**Claude Code (`cc/`)**
- `cc/claude-opus-5` — the heavy lifter
- `cc/claude-sonnet-5` — the everyday balance
- `cc/claude-haiku-4-5-20251001` — fast and light

**Codex (`cx/`)**
- `cx/gpt-5.6-sol`, `cx/gpt-5.6-terra`, `cx/gpt-5.6-luna` — the current family
- `cx/gpt-5.5`, `cx/gpt-5.4` — still there and still good

**GitHub Copilot (`gh/`)**
- `gh/claude-sonnet-4.5`, `gh/claude-opus-4.5`, `gh/gpt-5.4`

**Antigravity (`ag/`)**
- `ag/gemini-4-argon-high` and the rest of the Gemini family, plus Claude models

### Cheap lane

**GLM (`glm/`)** — `glm/glm-4.7` at $0.60 / $2.20 per 1M, plus newer `glm-5.x` models

**MiniMax (`minimax/`)** — `minimax/MiniMax-M2.1` at $0.30 / $1.20 per 1M, plus M2.5, M2.7 and M3

**Kimi (`kimi/`)** — `kimi/kimi-latest`, `kimi/kimi-k2.5`, `kimi/k3`

### Free lane

**iFlow (`if/`)** — `if/qwen3-coder-plus`, `if/kimi-k2`, `if/glm-4.7`, `if/deepseek-r1`, and more

**Qwen (`qwen/`)** — `qwen/qwen-plus`, `qwen/qwen-max`, `qwen/qwen-turbo`

**Kiro (`kr/`)** — `kr/claude-sonnet-4.5`, `kr/claude-opus-4.8`, and newer Claude models

> **About the free allowances:** figures such as Gemini CLI's reported 180K completions per month and Meta's or Google's daily limits are **upstream figures published by those providers** — not something Vela controls. They have changed before and will change again. Treat the dashboard's live quota readout as the truth.

---

## Keeping costs low

A practical routine, no spreadsheet required:

```
1. Put your subscription models first in the combo.
2. Put GLM or MiniMax second — a fraction of the cost of any retail API.
3. Always end with a free provider, so the chain never dead-ends.
4. Set a budget ceiling on the API key you hand to tools you leave running.
```

The [Cheap Providers](../providers/cheap.md) and [Free Providers](../providers/free.md) pages have worked examples, with the arithmetic shown.

---

## Next steps

- [Installation](../getting-started/installation.md) — requirements, Docker, source builds, uninstalling
- [Smart routing](../features/smart-routing.md) — how requests pick a provider
- [Combos](../features/combos.md) — building and tuning fallback chains
- [Quota tracking](../features/quota-tracking.md) — reading the dashboard
- [FAQ](../faq.md) — the questions everyone asks first
- [Troubleshooting](../troubleshooting.md) — when something will not connect

---

## Need help?

- **Website**: [vela.my.id](https://vela.my.id)
- **GitHub**: [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**: [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)

Vela is version 1.2.4. Check what you are running with:

```bash
npm list -g vela
```
