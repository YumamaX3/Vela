# Subscription Providers - Maximize Your Value

You are already paying for Claude Code, or Codex, or Copilot. The subscription lane is about getting all of it: knowing how much is left, using it before it resets, and moving on cleanly when it is gone.

This page covers the five providers people connect first, what each costs upstream, which models you can call today, and how to put them to work.

> **Dates matter here.** Subscription tiers, prices and model names are set by Anthropic, OpenAI, GitHub and Google — not by Vela. The figures on this page are upstream facts as of **2026-10-28** (Vela 1.2.5). Providers change them often.

---

## Overview

The subscription lane is **first** because the money is already spent:

- ✅ **Claude Code** (Pro/Max) — the Claude family through your Anthropic subscription
- ✅ **OpenAI Codex** (Plus/Pro) — the GPT-5.x family through your ChatGPT plan
- ✅ **GitHub Copilot** — one subscription, several vendors' models
- ✅ **Antigravity** (Google) — Gemini and Claude models on your Google account
- ✅ **Kimi** — Moonshot's own coding plan, added by API key or login

**The idea:** use these first, watch the quota in real time, and have a cheap or free provider waiting behind them.

---

## Claude Code (Pro/Max)

### What it costs upstream

| Plan | Typical monthly price | Quota shape | Models |
|------|----------------------|-------------|--------|
| Pro | about $20 | rolling window plus weekly refresh | Opus, Sonnet, Haiku |
| Max | about $100 | larger rolling window plus weekly refresh | Opus, Sonnet, Haiku |

Those are Anthropic's published consumer prices; check your own plan page for what applies to you.

### Setup

> ⚠️ **A caveat worth stating up front.** In this release the Claude Code provider (`claude`, alias `cc`) is marked **deprecated, with a risk notice** in the registry. It rides an undocumented Claude Code interface, which Anthropic can change without warning. It works today — but treat it as a lane that may need mending, not a guarantee.

**Step 1: connect**

```
Dashboard → Providers → Claude → Connect
```

**Step 2: log in**

A browser window opens on Claude's sign-in page. Approve the connection. Tokens refresh themselves from that point on, and quota tracking starts immediately.

**Step 3: use it**

Models are named `cc/<model-id>`. The ones shipped in this release:

| Model | Good for |
|-------|----------|
| `cc/claude-opus-5` | hard problems, architecture, long refactors |
| `cc/claude-sonnet-5` | everyday work, the sensible default |
| `cc/claude-fable-5` | writing-heavy tasks |
| `cc/claude-haiku-4-5-20251001` | fast edits, small questions |

> Model lists move faster than documentation. Run `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` — or open **Providers → Claude** — to see exactly what your install offers today.

### Getting the most from it

- Put Opus first in a combo for production work, Sonnet first for everything else.
- Add several accounts if you have them; Vela can rotate between them.
- Watch the reset countdown on the **Quota** page rather than guessing.

---

## OpenAI Codex (Plus/Pro)

### What it costs upstream

| Plan | Typical monthly price | Quota shape | Models |
|------|----------------------|-------------|--------|
| Plus | about $20 | rolling window plus weekly refresh | GPT-5.x family |
| Pro | about $200 | much larger allowance | GPT-5.x family |

### Setup

**Step 1: connect**

```
Dashboard → Providers → Codex → Connect
```

**Step 2: sign in**

The OAuth flow opens in your browser (on loopback; if the browser does not come up on a headless server, copy the URL and complete it on your laptop, then paste the callback back). Tokens refresh automatically.

**Step 3: use it**

| Model | Good for |
|-------|----------|
| `cx/gpt-5.6-sol` | the current flagship for coding |
| `cx/gpt-5.6-terra` | a second modern option |
| `cx/gpt-5.6-luna` | fast, lighter work |
| `cx/gpt-5.5`, `cx/gpt-5.4` | stable fallbacks |

Each model also has a `-review` sibling (for example `cx/gpt-5.6-sol-review`) that draws on a separate quota family; useful to know when the main lane is tight.

### Getting the most from it

- Codex and Claude answer different kinds of questions well. A combo of `cc/claude-opus-5 → cx/gpt-5.6-sol` is a strong pair.
- The Pro tier is roughly ten times the Plus allowance — worth it only if you regularly exhaust Plus.

---

## GitHub Copilot

### What it costs upstream

| Plan | Typical monthly price | Reset | Models |
|------|----------------------|-------|--------|
| Individual | about $10 | monthly | several vendors |
| Business | about $19 per seat | monthly | several vendors |

### Setup

**Step 1: connect**

```
Dashboard → Providers → GitHub → Connect
```

**Step 2: authorize**

Sign in to GitHub and approve the Copilot authorization. Vela keeps the token fresh.

**Step 3: use it**

Models are named `gh/<model-id>`, for example:

- `gh/claude-sonnet-4.6`, `gh/claude-opus-4.7`, `gh/claude-haiku-4.5`
- `gh/gpt-5.4`, `gh/gpt-5.3-codex`, `gh/gpt-5.2-codex`
- `gh/gemini-3.1-pro-preview`, `gh/gemini-3-flash-preview`

### Getting the most from it

- Copilot is the odd one out: **one subscription, several vendors**. It is a good second or third entry in a combo when you want variety without a second bill.
- The monthly reset means it is best kept in reserve for the end of the month, when other lanes are dry.

---

## Antigravity (Google account)

### What it costs upstream

Antigravity is Google's agentic coding environment. It is free with a Google account, with its own quota, and it exposes both Gemini and Claude models.

### Setup

**Step 1: connect**

```
Dashboard → Providers → Antigravity → Connect
```

**Step 2: sign in with Google**

Approve the connection, then use models named `ag/<model-id>`:

- `ag/gemini-4-argon-high` (and `-medium`, `-low` for cheaper, faster variants)
- `ag/gemini-3.8-flash`, `ag/gemini-3.7-flash`, and other Gemini generations
- Claude models, where your account offers them

### Getting the most from it

- The `-high`/`-medium`/`-low` suffix is a real cost lever: same model family, very different token spend.
- Because it is free, it belongs at the top of a combo for anything experimental.

---

## Kimi (Moonshot)

### What it costs upstream

Moonshot sells coding plans directly. Vela can reach them by login or by API key, whichever your account supports.

### Setup

```
Dashboard → Providers → Kimi → Connect (login)   — or —   Add API key
```

Models are named `kimi/<model-id>`: `kimi/kimi-latest`, `kimi/kimi-k2.5`, `kimi/k3`, `kimi/kimi-for-coding`.

---

## Side by side

| Provider | Monthly (upstream) | How you log in | Reset | Standout |
|----------|--------------------|----------------|-------|----------|
| **Claude Code Pro** | about $20 | OAuth | rolling + weekly | best long-form code quality |
| **Claude Code Max** | about $100 | OAuth | rolling + weekly | biggest Claude allowance |
| **Codex Plus** | about $20 | OAuth | rolling + weekly | strongest single-purpose coding model |
| **Codex Pro** | about $200 | OAuth | rolling + weekly | ~10× Plus |
| **GitHub Copilot** | about $10–19 | OAuth | monthly | several vendors, one bill |
| **Antigravity** | **free** | Google OAuth | its own | Gemini + Claude at no cost |
| **Kimi** | plan-dependent | login or key | monthly | long-context coding |

---

## A worked example

**Cursor, Cline, or any OpenAI-compatible tool.**

If you have a combo called `premium-coding` (Claude first, GLM second, Kiro last):

```
Settings → Models
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    premium-coding
```

If you want the subscription alone, skip combos and use `cc/claude-opus-5` directly.

**Building the combo:**

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5      ← subscription
          2. glm/glm-4.7           ← cheap
          3. kr/claude-sonnet-4.5  ← free last line
```

---

## Watching the quota

The **Quota** page shows, per provider:

- how much of the window is used, as a bar and a percentage
- when it resets, as a countdown
- for paid lanes, what it has cost so far

The **Usage** page shows the same spend by model, combo and API key, over today, 7, 14, 30 and 60 days, or all time.

---

## Best practices

### 1. Free and cheap first, if the goal is cost

```
1. Antigravity (free Claude / Gemini)
2. Claude Code or Codex (you already pay)
3. GLM-4.7 (cheap)
4. iFlow or Kiro (free)
```

If the goal is *quality on the hard problems*, put the subscription first instead — there is no universal right order, only the one that matches what you are doing this week.

### 2. Look at the reset times

Rolling windows reset a few hours after first use; daily and monthly windows reset at fixed times. Heavy work the day before a monthly reset is quota spent for nothing.

### 3. Use a combo, and put a free provider at the end

A combo that ends in a free lane never leaves you stuck mid-thought.

---

## Troubleshooting

### "Quota exhausted"

Wait for the reset (check the countdown), or let the combo fall through to the next model. Nothing else is broken.

### "OAuth token expired"

Vela refreshes tokens automatically; an expired message usually means the refresh itself failed. Go to **Providers → [provider] → Disconnect**, then **Connect** again.

### Rate limited while quota looks available

Rate limits and quota are different limits. A provider can refuse requests for a burst even with allowance left; the fallback chain is the answer, not waiting.

### A model name is rejected

The model may have been renamed upstream. Ask the gateway what it really has:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>" | grep claude
```

---

## Next steps

- **Cheap backup:** [Cheap Providers](cheap.md)
- **Free fallback:** [Free Providers](free.md)
- **Build a chain:** [Combos](../features/combos.md)
