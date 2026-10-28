# Quota Tracking & Usage Monitoring

Vela keeps a receipt for everything. This page is about reading those receipts: how much of each allowance is left, when it resets, where the money is going, and how to put a hard ceiling on it.

---

## Overview

- **Live consumption** — tokens and cost per request, per model, per key
- **Quota and remaining** — how much of each provider's allowance you have used
- **Reset countdowns** — when the window opens again
- **Cost estimates** — computed from the rates Vela ships
- **Budget ceilings** — hard stops, per API key
- **History** — today, 7, 14, 30, 60 days, or all time

---

## The dashboard rooms

```
Quota     per-provider allowances and reset times
Usage     requests, tokens, cost, by period, model, combo and key
Log Harbor   the request ledger, for when you need a single request
```

### What the Quota page shows

For each connected provider, a row with:

- **Used / total** — as a bar and a percentage, when the provider publishes a limit
- **Reset** — a countdown to the next window
- **Cost so far** — for metered lanes

Quota data comes from each provider. Where a provider does not publish a usable number, Vela shows what it can measure (your own usage) and says so, rather than inventing a percentage.

### What the Usage page shows

- Requests and tokens for the selected period
- Cost split by model, combo and API key
- Which model actually answered (through **Routed by Combo**)

---

## Per-request tracking

Every request logged with its model, token counts, duration, outcome and cost. When a bill surprises you, this is where you find the request that caused it.

If you want the full request and response bodies, turn on `ENABLE_REQUEST_LOGS` — it is off by default because it is large and it contains whatever you sent.

---

## How the different quota shapes behave

Quotas are not one thing. The providers use several shapes, and they reset differently:

| Shape | Typical providers | How it resets |
|-------|-------------------|---------------|
| **Rolling window** | Claude Code, Codex | the window slides; allowance returns as old usage ages out |
| **Fixed daily** | some cheap lanes | at a fixed hour, in the provider's timezone |
| **Monthly** | Copilot, plans | on a date, usually the 1st or your billing date |
| **Metered credit** | GLM, MiniMax, most API keys | never "resets" — it is a balance |

The practical consequence: on a rolling window, waiting an hour may be enough; on a fixed daily window, it may be worth sleeping; on a balance, only paying helps.

---

## Cost estimation

Vela estimates cost from `open-sse/providers/pricing.js`. Two rates that matter most here:

| Model | Input /1M | Output /1M |
|-------|-----------|------------|
| `glm/glm-4.7` | $0.60 | $2.20 |
| `minimax/MiniMax-M2.1` | $0.30 | $1.20 |

Because output is three to four times the input price, an output-heavy conversation costs far more than a long prompt with a short answer. When a number looks high, look at the split before looking for a fault.

Estimates are estimates: a provider can change its retail rates before Vela's table catches up. Your invoice is authoritative.

---

## Budgets and ceilings

There are two different controls, and they behave differently. Worth knowing which you have switched on.

### Per-key budget (the hard stop)

```
Dashboard → Endpoint & Key → Create Key (or edit one)
  token budget:  daily / weekly / monthly / yearly
  spend cap:     in currency
```

When a key reaches its ceiling, requests through that key are refused:

```
HTTP 429 — "Monthly spend cap exceeded: $20.00 of $20.00 used (budget_exceeded)"
```

That is a refusal, not a redirection. Vela does not move you to a cheaper model to stay under a cap; it stops, because "stop" is what you asked for.

### Gateway budgets (soft thresholds and hard caps)

Usage budgets can be set at gateway, key or model scope, with day, week or month windows. These emit alerts at 50%, 80% and 100%, and deny outright once a hard cap is passed — with a code that names the scope.

### The difference from fallback

A combo moves to the next model when a request **fails**. A budget refuses when you have **spent enough**. Neither happens by accident, and neither guesses on your behalf.

---

## Reading your own usage from the API

The dashboard reads from the same endpoints you can:

```bash
# Usage summary
curl "http://localhost:32060/api/usage/stats?period=7d" \
  -H "Authorization: Bearer <key>"

# Request metrics over time (for charts)
curl "http://localhost:32060/api/usage/metrics/timeseries?period=7d" \
  -H "Authorization: Bearer <key>"

# Budget definitions
curl "http://localhost:32060/api/usage/budgets" \
  -H "Authorization: Bearer <key>"
```

Valid periods: `today`, `24h`, `7d`, `14d`, `30d`, `60d`, `all`. These are the same windows the dashboard's period selector uses, which makes them convenient for a weekly script.

---

## Alerts

Alert records are produced when a budget crosses a threshold, and can be delivered to a dashboard banner, a Discord webhook or an n8n webhook, depending on what you have configured.

A monthly summary email is not something Vela sends by itself; if you want one, the API above plus a cron job is a ten-line script.

---

## Good habits

### 1. Look once a day

The **Quota** page takes ten seconds. It tells you more about your week than any productivity tool.

### 2. Put ceilings on keys that run unattended

Agents, background jobs, anything that loops. A ceiling you set once beats a bill you read once.

### 3. Give each tool its own key

Then the per-key usage report actually means something.

### 4. Prefer cheaper models for the boring work

A combo that puts GLM first for "write a commit message" costs a great deal less than one that sends it to Opus, and answers just as well.

### 5. Treat the estimates as estimates

They are derived from published rates and token counts. They are accurate enough to budget with, not accurate enough to argue with an invoice.

---

## Troubleshooting

### Quota shows used, but requests fail

The provider may be applying a limit Vela cannot see (an account-level cap, a per-minute rate limit). The quota number is a guide, not a promise. Try another model or check the provider's status page.

### Costs look wrong

1. Check the rates: **Cheap Providers** lists the ones Vela ships with.
2. Check the split — output tokens dominate.
3. Check the model — `-highspeed` and larger variants cost more.
4. If a provider changed its prices, the estimate will be off until the table is updated.

### The reset countdown looks stuck

Refresh the page; quota data is fetched on load. If the countdown itself is wrong for a provider that publishes its reset time, that is an upstream detail Vela is displaying, not computing.

### Budget reached, but I want to continue

Edit the key's budget in **Endpoint & Key**, or use a different key. The refusal is the ceiling doing its job.

---

## Related

- [Smart Routing](smart-routing.md) — where requests go, and why
- [Combos](combos.md) — the chains behind the costs
- [Cheap Providers](../providers/cheap.md) — the rates in detail
