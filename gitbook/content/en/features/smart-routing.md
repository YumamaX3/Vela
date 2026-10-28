# Smart Routing & Auto Fallback

Vela does not guess. Every request goes somewhere for a reason: the model you asked for, the account that should serve it, and — if that fails — the next one in line.

This page explains the pieces, so that when a request lands somewhere unexpected, you know exactly which knob to turn.

---

## The shape of a request

```
Your tool
   ↓  POST /v1/chat/completions, model: "premium-coding"
Vela
   ↓  is "premium-coding" a combo?      → yes: walk its chain
   ↓  otherwise: is it prefix/model?    → resolve provider + model
   ↓  which account for that provider?  → connection order, or round-robin
   ↓  does the API key allow it?        → key scope
   ↓  is the key within budget?         → 429 if not
   ↓  call the upstream
   ↓  failed?                           → next model in the chain (combos)
Reply
```

Nothing in that path silently reorders your priorities. If you asked for a subscription model, you get it or you get an error — unless you are using a combo, in which case you get the next model you listed.

---

## Combo fallback

A combo is the only mechanism that moves a request to a *different model*:

```
cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5
```

It moves on when a request fails — quota errors, rate limits, timeouts, policy refusals, unknown models — and stays put when a request merely *might* fail later. The full rules, and how to build one, are in [Combos](combos.md).

## Account rotation

Within one provider, several connections can share the work. **Settings → Routing** offers round-robin (spread across connections) or fill-first (use one until it complains), with a sticky limit that keeps a conversation on the same account for a while. This is how you use two Claude accounts, or three, without thinking about it.

## Key scope and budget

Every API key can be limited to certain providers, models or combos, and given a token budget and spend ceiling. When the ceiling is reached, the request is refused with a `429` carrying a `budget_exceeded` code — a clear stop rather than a quiet downgrade.

---

## What each lane is for

**Subscription — use first, if quality matters**
- Claude Code, Codex, Copilot, Antigravity, Kimi
- You already pay for these; the goal is to use the allowance before it expires

**Cheap — the middle**
- GLM-4.7 ($0.60 / $2.20 per 1M), MiniMax M2.1 ($0.30 / $1.20), Kimi plans
- A fraction of retail API pricing, and good enough for most work

**Free — the last line**
- iFlow, Qwen, Kiro
- Rate-limited and variable, but they cost nothing

---

## Watching it happen

```
Dashboard → Usage        a live view of requests, tokens and cost
Dashboard → Quota        per provider: used, remaining, reset countdown
Dashboard → Routed by Combo   which model actually answered
Dashboard → Log Harbor   the request ledger, when you need the detail
```

If a combo is landing on its last rung every time, **Quota** will show you why within seconds.

---

## Configuration that matters

### Routing strategy

```
Dashboard → Settings → Routing
  Round robin            spread requests across connections
  Sticky limit           how long one conversation stays on one connection
  Combo round robin      rotate through a combo's members instead of falling through
```

### Fallback rules

Beyond combos, Vela has **Fallback Rules** — operator-defined rules keyed on what went wrong:

- a specific HTTP status
- a refused prompt (content policy)
- a context window that is too small
- a timeout
- any error at all

Rules can be chained and tested in a dry-run panel before they go live. They are the right tool when "try this other model when *that* happens" is a policy rather than a preference. Find them under **Fallback Rules** in the sidebar.

### Per-key ceilings

```
Dashboard → Endpoint & Key → Create Key / Edit
  rate limit, token budget, spend cap, provider/model scope
```

This is the only mechanism that stops spending. Use it on any key that runs unattended.

---

## Examples

### Example 1: subscription first

```
Model: premium-coding
  1. cc/claude-opus-5
  2. glm/glm-4.7
  3. if/qwen3-coder-plus
```

Morning: Claude answers. Afternoon, when the rolling window closes: GLM answers. Evening, when the card declines: iFlow answers. You keep typing.

### Example 2: with a spend ceiling

Give the key a $20 monthly cap. Work through GLM and MiniMax until the cap is reached; from then on every paid request is refused with a `429`, and free lanes still answer. Predictable bills, no surprise invoices.

### Example 3: subscription only

A single model and no combo. If the window is closed, you get the provider's error. That is deliberate: some people would rather wait than spend.

---

## Good habits

### 1. Let the hard work go to the subscription

Opus and GPT-5.6-class models earn their price on architecture and debugging. Cheap models earn theirs on the other eighty percent.

### 2. End on a free lane

A chain that ends on a paid model ends on a closed door.

### 3. Watch the reset times, not just the percentages

Rolling windows and fixed windows behave differently. Heavy work the day before a monthly reset is allowance thrown away.

### 4. One key per tool or per person

Scopes and budgets are per key. One shared key means one shared ceiling and no way to tell who spent what.

---

## Troubleshooting

### "No available provider" / "quota exhausted"

Check **Quota** for a countdown, then check the combo ends on a free model. If it does and free providers are also out, that is a genuinely bad day upstream, not a local fault.

### It keeps falling back

- Look at the first rung: an expired OAuth token is the most common cause.
- Check the provider's status page.
- Confirm the model id still exists (`/v1/models`).

### Costs are higher than the combo suggests

- Read **Routed by Combo**: it fell further down the chain than you assumed.
- Remember output tokens cost several times input on every lane.
- Check for `-highspeed` or larger `glm-5.x` models in the chain.

### A request is refused with a 429

Read the code in the response: rate limit, key scope, or budget. Each names what it refused and why.

---

## Related

- [Combos](combos.md) — building the chains
- [Quota Tracking](quota-tracking.md) — reading the numbers
- [Cheap Providers](../providers/cheap.md) — the rates
