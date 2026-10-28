# Combos - Custom Fallback Chains

A combo is a name for a chain of models. Give it a name once, and every tool can ask for that name instead of a specific model — and when one model in the chain is out of reach, the next one answers.

Combos are the most useful five minutes you will spend with Vela.

---

## What a combo is

```
Name: premium-coding
Models:
  1. cc/claude-opus-5          ← try first
  2. glm/glm-4.7               ← if #1 is out
  3. kr/claude-sonnet-4.5      ← if #2 is out too
```

Then any tool asks for `premium-coding` as if it were a model name. Vela resolves combo names **before** anything else, so `premium-coding` will never collide with a provider prefix.

### When the chain moves

A combo falls through to the next model when a request **fails**:

- the provider reports a quota or rate-limit error
- the request times out
- the provider refuses the prompt on policy grounds
- the model id is unknown or unavailable

### When it does not

- A daily allowance that is merely getting low does **not** trigger a switch. Vela will not quietly move you to a paid model because you are nearly at a limit — that would be spending your money for you.
- A hard spend ceiling belongs on the API key (**Endpoint & Key → budget**); when it is reached, Vela refuses with a 429 rather than steering elsewhere.

---

## Why use them

### 1. Get value from subscriptions
```
cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5
```
Use what you already pay for first, cheap second, free last.

### 2. Keep costs down
```
glm/glm-4.7 → minimax/MiniMax-M2.1 → if/qwen3-coder-plus
```
$0.60 → $0.30 → free, per 1M input tokens.

### 3. Never get stuck
```
cc/claude-opus-5 → cx/gpt-5.6-sol → glm/glm-4.7 → if/qwen3-coder-plus
```
Always end the chain on something free, or you are one exhausted quota away from a stopped afternoon.

### 4. Keep quality when it matters
```
cc/claude-opus-5 → cx/gpt-5.6-sol → ag/gemini-4-argon-high
```
Premium models throughout. Costs more, never dulls.

---

## Creating one

### Step 1: open the dashboard

```
http://localhost:32060/dashboard → Combos
```

### Step 2: create

```
Combos → Create
  Combo Name: premium-coding
  Models:     add them one at a time, in priority order
```

Drag the rows to reorder. The model at the top is tried first.

### Step 3: save

The combo appears immediately, and the gateway will resolve it on the next request — no restart needed.

### Step 4: use it

```
Model: premium-coding
```

That is the whole interface. Any tool that takes a model name takes a combo name.

### A second strategy: round-robin

A combo can also rotate between its members rather than falling through them. Set that globally under **Settings → Routing → Combo round robin**, if your goal is to spread load (for example across several accounts) rather than to fall back.

---

## Worked examples

### Example 1: premium but frugal

```
premium-coding
  1. cc/claude-opus-5
  2. glm/glm-4.7
  3. minimax/MiniMax-M2.1
```

A typical month at 100M tokens:

```
80M via the Claude subscription : $0
15M via GLM-4.7                 : about $9
 5M via MiniMax M2.1            : about $1
```

The expensive model does the real work; the cheap ones catch the overflow.

### Example 2: budget only

```
budget-combo
  1. glm/glm-4.7
  2. minimax/MiniMax-M2.1
  3. if/qwen3-coder-plus
```

At 100M tokens a month, split 70 / 20 / 10:

```
70M via GLM          : about $42
20M via MiniMax      : about $4
10M via iFlow        : $0
```

Costs money, but nothing like a retail API bill.

### Example 3: zero cost

```
free-combo
  1. kr/claude-sonnet-4.5
  2. if/qwen3-coder-plus
  3. qwen/qwen-plus
```

Cost: $0. Constraints: whatever the free tiers think of you today.

### Example 4: quality first

```
quality-first
  1. cc/claude-opus-5
  2. cx/gpt-5.6-sol
  3. ag/gemini-4-argon-high
```

No cheap fallback, on purpose: if all three are spent, it fails loudly rather than quietly producing weaker work.

### Example 5: every lane, in order

```
never-stuck
  1. ag/gemini-4-argon-high     ← free, surprisingly strong
  2. cc/claude-opus-5           ← subscription
  3. cx/gpt-5.6-sol             ← second subscription
  4. gh/claude-sonnet-4.6       ← third
  5. glm/glm-4.7                ← cheap
  6. minimax/MiniMax-M2.1       ← cheaper
  7. kr/claude-sonnet-4.5       ← free, good quality
  8. if/qwen3-coder-plus        ← free, variety
```

Eight rungs, each costing less than the one above, none of them nothing-to-lose.

---

## Using a combo in every tool

### Cursor

```
Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    premium-coding   (add as a custom model)
```

### Claude Code

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
claude --model premium-coding
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
codex --model premium-coding "your prompt"
```

### Cline / Roo / Continue

```
Provider: OpenAI Compatible
Base URL: http://localhost:32060/v1
API Key:  [your Vela key]
Model:    premium-coding
```

### From a script

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer [your Vela key]" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "premium-coding",
    "messages": [{"role": "user", "content": "Write a function that reverses a linked list."}],
    "stream": true
  }'
```

---

## Good habits

### 1. End on something free

```
✅ cc/claude-opus-5 → glm/glm-4.7 → if/qwen3-coder-plus
❌ cc/claude-opus-5 → glm/glm-4.7
```

The second chain has a cliff at the end of it.

### 2. Decide what you are optimising for

- **Cost:** cheap first, free last.
- **Quality:** premium first, cheap last.
- **Subscription value:** subscription first, free last.

There is no universal answer, and the right order changes with the week.

### 3. Match the combo to the job

```
production code     : quality-first
everyday edits      : premium-coding
exploration         : budget-combo
other people's work : never-stuck
```

You can keep several and switch by changing one field in the tool.

### 4. Check what the chain actually did

The **Routed by Combo** page shows which model answered each request, so a combo that quietly always lands on the last rung is visible rather than mysterious.

### 5. Give shared keys a ceiling

For a key used by agents or background jobs, set a spend cap. A combo can move you down the chain, but it cannot stop you spending; a budget can.

---

## Advanced

### Per-combo strategies

A single combo can prefer round-robin over strict fallback — useful when the members are equal in quality and you want load spread. Set it under **Settings → Routing**.

### Temporarily disabling a model

Disable a model on its provider page rather than deleting it from every combo; the combo skips it and keeps its shape for when you turn it back on.

### Importing and exporting

Combos can be exported and imported from the Combos page, which is the easiest way to move a working setup to a second machine.

---

## Troubleshooting

### The combo name is not recognised

- Check that the name is spelled exactly as saved (case-sensitive).
- Restart the tool if it caches its model list at startup.
- Confirm the combo is saved — it should appear in the Combos list.

### It always lands on the last model

That means the earlier ones are failing. Look at **Quota** and **Providers**: usually an expired token, an exhausted allowance, or a provider that is down.

### It costs more than expected

- Check **Routed by Combo** to see how often it fell through.
- Read the rates in [Cheap Providers](../providers/cheap.md) — output tokens cost 3–4× input on the cheap lane.
- Reorder: put the cheaper member first if quality allows.

### A request fails instead of falling back

Some failures cannot be retried elsewhere — a malformed request will fail the same way on every model. Check the error text before assuming the chain is broken.

---

## Related

- [Smart Routing](smart-routing.md) — how a request picks a provider
- [Quota Tracking](quota-tracking.md) — reading usage and cost
- [Cheap Providers](../providers/cheap.md) — the numbers behind the chains
