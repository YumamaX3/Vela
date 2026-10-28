# Welcome to Vela

**Use Claude, Codex, and Gemini through one endpoint — then keep coding on cheap or free backstops when your subscription runs dry.**

Vela is a small gateway that sits between your coding tools and your AI providers. You point every tool at one address, and Vela decides which provider answers each request — the one whose quota you already paid for first, then a cheap one, then a free one.

If you have ever watched a month of Claude Code quota expire unused, or lost an hour to a rate limit in the middle of a refactor, Vela is built for that afternoon.

---

## What is Vela, in plain words?

Your coding tools (Cursor, Cline, Continue, Claude Code, Codex, and dozens more) all speak "OpenAI-compatible": give them a base URL and a key, and they talk to whatever answers there.

Vela answers there. Behind it sit the providers you connect — your Claude Code login, your Codex login, a GLM key, a free Kiro account — and Vela routes each request to the one that should serve it.

**What that fixes:**
- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-sentence
- ❌ Several paid APIs, each with its own monthly bill
- ❌ Hand-switching tools between providers

**What you get instead:**
- ✅ **Subscriptions used to the last token** — Claude Code, Codex, Copilot and friends, tracked in real time
- ✅ **Cheap backups** — GLM-4.7 at $0.60 / $2.20 per 1M tokens, MiniMax M2.1 at $0.30 / $1.20
- ✅ **Free fallbacks** — iFlow, Qwen and Kiro, which cost nothing
- ✅ **Automatic fallback** — when one runs out, the next takes over without you noticing

---

## Key Features

### 🔄 Three tiers, one endpoint

You set the order once and keep coding:

```
Tier 1 (SUBSCRIPTION): Claude Code → Codex → Copilot
  ↓ quota exhausted
Tier 2 (CHEAP):        GLM-4.7 → MiniMax M2.1 → Kimi
  ↓ spend cap reached
Tier 3 (FREE):         iFlow → Qwen → Kiro

→ The next one answers. You keep typing.
```

Tiers 2 and 3 are not automatic unless you build them. A **combo** is how you name the chain; the [Combos guide](features/combos.md) walks through building one in a few clicks.

### 📊 Quota tracking

- Token consumption per provider, live
- Reset countdowns (hourly, daily, weekly, monthly)
- Cost estimates for the paid lanes
- Budget ceilings per API key, if you want hard limits

### 🎯 Works with any OpenAI-compatible tool

✅ **Cursor** • **Cline** • **Claude Code** • **Codex CLI** • **Roo** • **Continue** • **anything else that takes a base URL**

### 💰 A realistic month

A developer on 100M tokens a month, mostly through quota they already own:

```
60M via Gemini CLI        : $0   (free allowance, upstream figure)
30M via Claude Code       : $0   (subscription you already pay for)
 8M via GLM-4.7            : about $4.80
 2M via MiniMax M2.1       : about $0.40
```

The [cheap providers page](providers/cheap.md) works through these numbers line by line.

---

## How many providers does Vela support?

The honest answer is three numbers, because they measure three different things. All three were measured on 2026-10-28 at version 1.2.5, and you can re-derive them at any time:

| Count | What it means | How to check it yourself |
|-|-|-|
| **189** | provider files in the registry — everything anyone has written | `ls open-sse/providers/registry/*.js \| grep -v index.js \| wc -l` |
| **186** | entries the app can actually see (three files are deliberately not imported) | `node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"` |
| **145** | transports a request can actually reach | `node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"` |

So: **145 providers you can dial**, out of 186 the app can see, out of 189 written down.

The gaps explain themselves. Three files (`devin-cli`, `trae`, `windsurf`) sit on disk but are commented out of the generated index — two lacked solid tool-calling support, one spawns a local agent with shell access — so they are visible to nobody. The other 41 of the 186 are entries that declare no transport: media, tools, or work in progress, reachable by nothing that sends a chat request. Every file, imported or not, still matters to someone reading the registry; none of them is a marketing number. Run the three commands in your own clone and you will get today's numbers, not next month's.

By the way they authenticate, the 186 the app can see split into 131 API-key providers, 23 OAuth logins, 22 free-tier lanes, 7 web-cookie providers and 3 with no account at all. You do not need to remember that — the dashboard's **Providers** room lists them.

---

## Why people choose Vela

### Get full value from what you already pay for

Already on Claude Code or Codex? Vela tracks how much of that quota is left, switches between accounts, and keeps a countdown to the reset. The goal is simple: use what you bought before it expires.

### Cheap when the good stuff runs out

| Provider | Per 1M tokens | Typical reset |
|----------|---------------|---------------|
| **GLM-4.7** | $0.60 in / $2.20 out | daily |
| **MiniMax M2.1** | $0.30 in / $1.20 out | rolling window |
| **Kimi** | subscription plans | monthly |

These are the rates Vela itself uses for cost estimates (`open-sse/providers/pricing.js`); your provider's invoice is the final word.

### Free when everything else is spent

- **iFlow** — free account, many models (Qwen3, Kimi K2, GLM 4.7, DeepSeek and more)
- **Qwen** — Qwen models on Qwen's own account
- **Kiro** — Claude models through an AWS Builder ID

Free lanes have rate limits, and they change without notice. They are the last line, not the first.

---

## Quick start

Two minutes, if Node.js 20 or newer is installed:

```bash
# The launcher installs itself and starts the gateway
npm install -g vela
vela
```

The dashboard opens by itself at **http://localhost:32060/dashboard**. There is no default password: a local browser walks straight in, and remote logins stay closed until you set a password under **Settings → Access**.

Then, in any coding tool:

```
Endpoint: http://localhost:32060/v1
API Key:  [create one under Dashboard → Endpoint & Key → Create Key]
Model:    cc/claude-opus-5        (or any model, or a combo name)
```

[→ Full getting-started guide](getting-started/quick-start.md)

---

## What people use it for

### Solo developers
Run every tool against one endpoint, let subscriptions go first, and stop paying for extra API credit "just in case".

### Small teams
Run Vela once on a small server, hand out one API key per person with its own spend ceiling, and watch usage in one place.

### Coding from more than one machine
Deploy Vela on a VPS or container and reach it from a laptop, a tablet, or a phone. [The cloud guide](deployment/cloud.md) covers it, including the reverse proxy you will need.

---

## Where to go next

- [Quick start](getting-started/quick-start.md) — running in five minutes
- [Installation](getting-started/installation.md) — every installation method, in detail
- [Providers](providers/subscription.md) — the three lanes explained: subscription, cheap, free
- [Features](features/smart-routing.md) — routing, combos, quota tracking
- [Integration](integration/claude-code.md) — hooking up your tools
- [Deployment](deployment/localhost.md) — local, cloud, Docker
- [FAQ](faq.md) — short answers to common questions

---

<div align="center">
  <sub>Built for developers who would rather code than babysit their API bills.</sub>
</div>
