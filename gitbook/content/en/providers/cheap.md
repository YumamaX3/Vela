# Cheap Providers - Ultra-Cheap Backup

When subscription quota runs out, a good cheap model costs a few dollars a day instead of a few dollars an hour. This page covers the three cheap providers Vela ships with, the exact rates Vela uses to estimate cost, and how to place them behind your subscriptions.

> **About the numbers.** Every rate on this page comes from `open-sse/providers/pricing.js` in this release (Vela 1.2.5). It is what Vela itself charges against in its cost estimates. Your provider's invoice is still the final word — rates are set upstream and change without notice.

---

## Overview

The cheap lane sits **between** subscriptions and free providers:

- 💰 **GLM-4.7** — $0.60 input / $2.20 output per 1M tokens (`glm/glm-4.7`)
- 💰 **MiniMax M2.1** — $0.30 input / $1.20 output per 1M tokens (`minimax/MiniMax-M2.1`)
- 💰 **Kimi** — subscription plans, for steady long-context use (`kimi/...`)

**The idea:** when a subscription window closes, the cheap lane keeps you working at a fraction of retail API pricing — and a free provider stays last in line for when even that is too much.

---

## GLM-4.7

### Pricing

| What | Rate |
|------|------|
| Input | $0.60 per 1M tokens |
| Output | $2.20 per 1M tokens |
| Cached input | $0.11 per 1M tokens |

That is the rate Vela books: roughly a fourteenth of a typical $20-per-1M retail API on input, and about a tenth on output.

**Worked example — 10M tokens, half read and half written:**

```
Input:   5M × $0.60 = $3.00
Output:  5M × $2.20 = $11.00
Total:              $14.00
```

**Worked example — a typical coding day, 8M tokens at a 3:1 read/write ratio:**

```
Input:   6M × $0.60 = $3.60
Output:  2M × $2.20 = $4.40
Total:              $8.00
```

### Setup

**Step 1: get a key**

Create an account with your GLM provider (Zhipu / Z.ai, depending on your region) and generate an API key.

**Step 2: add it to Vela**

```
Dashboard → Providers → GLM → Add API key → paste → Save
```

**Step 3: use it**

```
Model: glm/glm-4.7
```

### Models on this lane

| Model | Good for |
|-------|----------|
| `glm/glm-4.7` | the value workhorse: coding and general tasks |
| `glm/glm-4.6v` | vision — reading screenshots and diagrams |
| `glm/glm-5`, `glm/glm-5.2`, `glm/glm-5.3` | newer, stronger, and dearer |
| `glm/glm-5.3-flash` | vision, at a lower price |

### Practical notes

- **Cache-aware routing pays.** GLM's cached-input rate is a fifth of the fresh-input rate; long conversations that keep their prefix stable cost much less.
- **GLM has its own quota windows.** The dashboard's **Quota** page shows your remaining allowance and the reset countdown for your account.
- **Keep it second, not first**, unless you are deliberately optimising for cost — Claude and Codex are better on the genuinely hard problems.

---

## MiniMax M2.1

### Pricing

| What | Rate |
|------|------|
| Input | $0.30 per 1M tokens |
| Output | $1.20 per 1M tokens |
| Cached input | $0.03 per 1M tokens |

This is the cheapest paid lane Vela ships with, and a favourite for long-context work.

**Worked example — 10M tokens, half read and half written:**

```
Input:   5M × $0.30 = $1.50
Output:  5M × $1.20 = $6.00
Total:              $7.50
```

**Worked example — a typical coding day, 8M tokens at 3:1:**

```
Input:   6M × $0.30 = $1.80
Output:  2M × $1.20 = $2.40
Total:              $4.20
```

### Setup

**Step 1: get a key** from MiniMax's platform.

**Step 2: add it**

```
Dashboard → Providers → MiniMax → Add API key → paste → Save
```

**Step 3: use it**

```
Model: minimax/MiniMax-M2.1
```

### Models on this lane

| Model | Notes |
|-------|-------|
| `minimax/MiniMax-M2.1` | the value pick, $0.30 / $1.20 |
| `minimax/MiniMax-M2.5`, `minimax/MiniMax-M2.7` | newer generations, same headline rate |
| `minimax/MiniMax-M2.5-highspeed` | faster tier, $0.60 / $2.40 |
| `minimax/MiniMax-M3` | the current flagship |
| `minimax/minimax-image-01`, `minimax/speech-2.8-hd` | image and speech services |

### Practical notes

- **Long context is the reason to pick it.** MiniMax models take very large inputs, which makes them a good home for whole-file and whole-repo questions when your subscription window is shut.
- **Watch for the `-highspeed` variants** — they cost twice as much. Worth it for interactive work, wasteful for batch jobs.

---

## Kimi (flat planning)

### Pricing

Kimi sells coding plans rather than per-token retail. Vela can reach them by login or API key, whichever your account offers.

**Why it earns a place:** for steady, predictable usage a flat monthly plan beats per-token billing, and Kimi models are strong on long context.

### Setup

```
Dashboard → Providers → Kimi → Connect (login)   — or —   Add API key
```

```
Model: kimi/kimi-latest
       kimi/kimi-k2.5
       kimi/k3
```

---

## Side by side

| Provider | Input /1M | Output /1M | Shape | Best for |
|----------|-----------|------------|-------|----------|
| **GLM-4.7** | $0.60 | $2.20 | metered, own quota windows | everyday cheap coding |
| **MiniMax M2.1** | $0.30 | $1.20 | metered | cheapest, long context |
| **Kimi** | plan-based | plan-based | subscription | steady volume |
| A retail API for comparison | about $20 | about $20 (or more) | metered | — |

Read the table as "which one to try first when the subscription is done": MiniMax for cost, GLM for quality-per-dollar, Kimi if you already have a plan.

---

## Putting the lane to work

### Cursor, Cline, Continue, Roo

```
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    glm/glm-4.7        (or minimax/MiniMax-M2.1, or a combo name)
```

### A cheap-first combo

```
Dashboard → Combos → Create
  Name:   cheap-backup
  Models: 1. glm/glm-4.7
          2. minimax/MiniMax-M2.1
          3. if/qwen3-coder-plus      ← free last line
```

Use `cheap-backup` wherever a model name goes. Cheap first, cheaper second, free at the end.

### A subscription-first combo

```
  Models: 1. cc/claude-opus-5
          2. glm/glm-4.7
          3. minimax/MiniMax-M2.1
          4. kr/claude-sonnet-4.5     ← free last line
```

---

## Where the money actually goes

### A realistic month, 100M tokens

```
60M via a free allowance    : $0     (upstream allowance, not Vela's)
30M via a subscription      : $0     (already paid)
 8M via GLM-4.7             : about $4.80  (input-weighted)
 2M via MiniMax M2.1        : about $0.40  (input-weighted)
```

The cheap lane is rarely the bill. It is the insurance policy that keeps you coding when the subscription is dry.

### Setting a ceiling

If you hand an API key to a tool that runs unattended, give the key a spend cap:

```
Dashboard → Endpoint & Key → Create Key (or edit an existing one)
→ budget: daily / weekly / monthly token budget and spend cap
```

When the cap is reached, Vela refuses the request with a 429 that says so. It will **not** silently move you to a cheaper model — a spend cap is a hard stop, by design.

---

## Troubleshooting

### "Quota exhausted" on a cheap lane

Each provider has its own windows. Check **Quota** for the reset countdown, or let the combo fall through to the free lane.

### "API key invalid"

- Re-paste the key — trailing spaces are the usual culprit.
- Check the account actually has credit; a zero-balance account often answers with an authentication-shaped error.
- Regenerate the key if it was ever pasted somewhere public.

### "My bill is higher than the estimate"

- Vela estimates from the rates in `pricing.js`; a provider can change its retail rates before Vela updates them.
- Long contexts and output-heavy work cost far more than short prompts — output is 3–4× the input price on this lane.
- The `-highspeed` and `glm-5.x` variants are noticeably dearer than the headline models.

### "I want the cheapest possible"

Put MiniMax M2.1 first, GLM second, and a free provider last — and consider whether Antigravity (free) should simply be first.

---

## Next steps

- **Add a free last line:** [Free Providers](free.md)
- **Start with subscriptions:** [Subscription Providers](subscription.md)
- **Build and tune a chain:** [Combos](../features/combos.md)
