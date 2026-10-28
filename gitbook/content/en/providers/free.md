# Free Providers - Zero Cost Fallback

The free lane is the last line. When subscriptions are spent and the cheap lane is capped, these providers still answer — at no cost to you.

Three of them ship ready to connect: iFlow, Qwen and Kiro. All three use accounts you can create for free, and all three have limits of their own that are set by the provider, not by Vela.

---

## Overview

- 🆓 **iFlow** — a free account with a broad model menu: Qwen3, Kimi K2, DeepSeek, GLM, and more
- 🆓 **Qwen** — Qwen's own models, on Qwen's own platform
- 🆓 **Kiro** — the Claude family through an AWS Builder ID or a social login

**The idea:** put one of these at the end of every combo. Then "everything is out of quota" stops being an emergency and becomes a slower afternoon.

> **Be honest about "free".** Free tiers are rate-limited, occasionally unavailable, and change without notice. The providers publish their allowances; Vela shows what your account actually has left on the **Quota** page. Anything else — a headline like "180K requests a month" — is an upstream figure that can move.

---

## iFlow

### What you get

One login, one menu. The provider this release ships with:

| Model | Good for |
|-------|----------|
| `if/qwen3-coder-plus` | code generation |
| `if/qwen3-max` | the strongest Qwen3 general model |
| `if/qwen3-235b-a22b-thinking-2507` | reasoning-heavy tasks |
| `if/kimi-k2` | long-context coding |
| `if/deepseek-r1` | step-by-step reasoning |
| `if/deepseek-v3.2` | fast general chat |
| `if/glm-4.7` | the same model as the cheap lane, at no cost |
| `if/qwen3-vl-plus` | vision |

### Setup

**Step 1: connect**

```
Dashboard → Providers → iFlow → Connect
```

**Step 2: log in**

The browser opens iFlow's sign-in page. Create an account if you do not have one, approve the connection, and Vela keeps the token fresh from then on.

Some iFlow accounts authenticate with a session cookie rather than OAuth; if the dashboard offers a cookie field, paste the value it asks for.

**Step 3: use it**

```
Model: if/qwen3-coder-plus
```

### Why it is the first free pick

Variety. One account reaches models from several vendors, which makes it a good default when you do not want to think about which free provider to try.

---

## Qwen

### What you get

Qwen's own models, served by Qwen:

| Model | Good for |
|-------|----------|
| `qwen/qwen-max` | the strongest general model |
| `qwen/qwen-plus` | balanced |
| `qwen/qwen-turbo` | fast, light tasks |
| `qwen/qwen-long` | very long documents |

### Setup

```
Dashboard → Providers → Qwen → Connect or Add API key
```

Depending on your account, that is either a login or a key from Qwen's console. Then use models as `qwen/qwen-plus`.

### When to reach for it

- When iFlow is rate-limited and you need something now.
- For long-document work, where `qwen/qwen-long` has an edge.
- As the second rung of a free-only combo.

---

## Kiro (Claude at no cost)

### What you get

The Claude family through Kiro, which is AWS's coding environment:

| Model | Good for |
|-------|----------|
| `kr/claude-sonnet-5` | the everyday balance |
| `kr/claude-sonnet-4.5` | a proven stable choice |
| `kr/claude-opus-4.8`, `kr/claude-opus-5` | the hard problems |
| `kr/claude-haiku-4.5` | quick tasks |

Each also has `-thinking` and `-agentic` variants (`kr/claude-sonnet-4.5-thinking`, and so on) when you want visible reasoning.

### Setup

**Step 1: connect**

```
Dashboard → Providers → Kiro → Connect
```

**Step 2: choose a login**

AWS Builder ID is the usual option; Google and GitHub logins are also offered by the provider.

**Step 3: use it**

```
Model: kr/claude-sonnet-4.5
```

### Why it is the quality pick

It is the same model family you would pay for, at nothing. That makes `kr/...` the natural "free but still good" entry in a combo — the one you use for real work rather than experiments.

---

## Side by side

| Provider | Prefix | Models shipped | Login | Best at |
|----------|--------|-----------------|-------|---------|
| **iFlow** | `if/` | 15 | OAuth or cookie | variety |
| **Qwen** | `qwen/` | 4 | login or key | long documents |
| **Kiro** | `kr/` | 44 | AWS Builder ID / social | Claude quality |

---

## Using them in your tools

### One free model, directly

```
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    kr/claude-sonnet-4.5
```

### A free-only combo

```
Dashboard → Combos → Create
  Name:   zero-cost
  Models: 1. kr/claude-sonnet-4.5      ← quality first
          2. if/qwen3-coder-plus        ← variety
          3. qwen/qwen-plus             ← last resort
```

Cost: nothing, ever. Speed and availability: whatever the free tiers allow today.

### The full three-lane combo

```
Dashboard → Combos → Create
  Name:   never-stuck
  Models: 1. cc/claude-opus-5          ← subscription
          2. cx/gpt-5.6-sol            ← second subscription
          3. glm/glm-4.7               ← cheap
          4. minimax/MiniMax-M2.1      ← cheaper
          5. kr/claude-sonnet-4.5      ← free, still good
          6. if/qwen3-coder-plus       ← free, variety
```

This is the chain the whole design is pointing at: use what you paid for, fall back to what is cheap, and never end on nothing.

**How the falling-back works:** a combo moves to the next model when a request *fails* — quota error, rate limit, timeout, refused prompt, unknown model. It does not pre-emptively switch because a daily allowance is running low. If you want a hard ceiling, set one on the API key (**Endpoint & Key → budget**); Vela then refuses with a 429 rather than quietly spending.

---

## Getting the most out of free tiers

### 1. Put them last, and mean it

A free model first will soak up all your work and leave your paid quota to expire unused. A free model last costs nothing and saves the day.

### 2. Match the model to the job

```
Reasoning / tricky code : if/qwen3-235b-a22b-thinking-2507, kr/claude-opus-4.8
Everyday coding         : kr/claude-sonnet-4.5, if/qwen3-coder-plus
Fast and cheap          : qwen/qwen-turbo, if/deepseek-v3.2
Long documents          : qwen/qwen-long
Vision                  : if/qwen3-vl-plus
```

### 3. Do not build production on them alone

Free lanes change without warning: a model disappears, a limit tightens, a provider has a bad afternoon. Use them as the floor of a chain, not the whole floorplan.

### 4. Watch the priority, not the quota

Free tiers often throttle by priority rather than refuse outright: your request waits behind paying customers. If replies feel slow, that is usually why, and switching to another free provider is the fix.

---

## Troubleshooting

### "OAuth failed"

- Check you are online and the provider's site loads in a normal browser.
- Try a different browser, or a private window with extensions off.
- Disconnect and reconnect from **Providers**.

### "Model not available"

- Confirm the provider shows as connected in **Providers**.
- Confirm the model id is exactly as listed by the gateway: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.

### "Slow responses"

Free lanes are the lowest priority. Try another free provider, work at quieter hours, or let the combo move on.

### "It worked yesterday and stopped today"

That is the nature of a free tier. Reconnect, try a different model on the same provider, or lean on a different free provider until it returns.

---

## Next steps

- **Start with subscriptions:** [Subscription Providers](subscription.md)
- **Add a cheap middle lane:** [Cheap Providers](cheap.md)
- **Build and tune a chain:** [Combos](../features/combos.md)
