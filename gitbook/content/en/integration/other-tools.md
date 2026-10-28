# Other Tools Integration

Anything that can talk to the OpenAI API can talk to Vela. This page is the generic recipe: the address, the key, a handful of working examples, and the patterns that keep a script from failing in the same way twice.

## Overview

The shape is always the same:

```
Base URL:  http://localhost:32060/v1     (or https://your-domain.example/v1)
API key:   vela-v1-<id>-<checksum>       (from Dashboard → Endpoint & Key)
Model:     any id the gateway lists, or a combo name
```

## Generic setup pattern

**Local Vela:**

```
Base URL:  http://localhost:32060/v1
API Key:   [your Vela key]
Model:     cc/claude-sonnet-5
```

**Deployed Vela:**

```
Base URL:  https://your-domain.example/v1
API Key:   [your Vela key]
Model:     cc/claude-sonnet-5
```

Keep the `/v1`. Everything below assumes those three values.

## Available models

Ask the gateway rather than trusting a list:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

A reliable starting set:

| Model | Lane |
|-------|------|
| `cc/claude-opus-5` | Claude subscription |
| `cc/claude-sonnet-5` | Claude subscription |
| `cc/claude-haiku-4-5-20251001` | Claude subscription |
| `cx/gpt-5.6-sol` | Codex subscription |
| `cx/gpt-5.4` | Codex subscription |
| `glm/glm-4.7` | cheap |
| `minimax/MiniMax-M2.1` | cheapest |
| `if/qwen3-coder-plus` | free |

## Integration examples

### Python, OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="vela-v1-<id>-<checksum>",
    base_url="http://localhost:32060/v1",
)

response = client.chat.completions.create(
    model="cc/claude-sonnet-5",
    messages=[{"role": "user", "content": "Hello! Who are you?"}],
)

print(response.choices[0].message.content)
```

### Node.js, OpenAI SDK

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "vela-v1-<id>-<checksum>",
  baseURL: "http://localhost:32060/v1",
});

const response = await client.chat.completions.create({
  model: "cc/claude-sonnet-5",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);
```

### cURL

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer vela-v1-<id>-<checksum>" \
  -d '{
    "model": "cc/claude-sonnet-5",
    "messages": [{ "role": "user", "content": "Hello!" }]
  }'
```

### HTTP clients (Postman, Insomnia, Bruno)

```
POST http://localhost:32060/v1/chat/completions
Content-Type: application/json
Authorization: Bearer vela-v1-<id>-<checksum>

{
  "model": "cc/claude-sonnet-5",
  "messages": [{ "role": "user", "content": "Hello!" }],
  "temperature": 0.7,
  "max_tokens": 1000
}
```

### LangChain (Python)

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="cc/claude-sonnet-5",
    openai_api_key="vela-v1-<id>-<checksum>",
    openai_api_base="http://localhost:32060/v1",
    temperature=0.7,
)

print(llm.invoke("Explain vector databases in two sentences.").content)
```

### LlamaIndex (Python)

```python
from llama_index.llms.openai_like import OpenAILike

llm = OpenAILike(
    model="cc/claude-sonnet-5",
    api_key="vela-v1-<id>-<checksum>",
    api_base="http://localhost:32060/v1",
    is_chat_model=True,
)

print(llm.complete("What is a token?"))
```

### Anything that takes a base URL

- **Aider** — `--openai-api-base http://localhost:32060/v1`
- **OpenCode, Crush, Kilo Code, Cline, Roo, Continue** — OpenAI-compatible provider, same three fields
- **Claude Code** — see [Claude Code](claude-code.md)
- **Codex CLI** — see [Codex](codex.md)

The dashboard's **Endpoint & Key** page has a Quick Connect panel that prints paste-ready snippets for several of these, using your actual key.

## Custom scripts

### Batch processing

```python
import json
import os

from openai import OpenAI

client = OpenAI(
    api_key=os.environ["VELA_API_KEY"],
    base_url=os.environ.get("VELA_BASE_URL", "http://localhost:32060/v1"),
)


def process_batch(prompts, model="glm/glm-4.7"):
    return [
        {
            "prompt": prompt,
            "response": client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
            ).choices[0].message.content,
        }
        for prompt in prompts
    ]


print(json.dumps(process_batch(["Explain AI in one sentence", "Define a neural network"]), indent=2))
```

### Streaming

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.VELA_API_KEY,
  baseURL: process.env.VELA_BASE_URL || "http://localhost:32060/v1",
});

const stream = await client.chat.completions.create({
  model: "cc/claude-sonnet-5",
  messages: [{ role: "user", content: "Write a short story about lighthouses" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

### Comparing models

```python
for model in ["cc/claude-sonnet-5", "cx/gpt-5.6-sol", "glm/glm-4.7"]:
    reply = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": "Explain a bloom filter in three sentences."}],
    ).choices[0].message.content
    print(f"\n=== {model} ===\n{reply}")
```

## Common patterns

### Keep the key in the environment

```bash
# .env
VELA_API_KEY=vela-v1-<id>-<checksum>
VELA_BASE_URL=http://localhost:32060/v1
VELA_MODEL=cc/claude-sonnet-5
```

```python
import os
from openai import OpenAI

client = OpenAI(api_key=os.environ["VELA_API_KEY"], base_url=os.environ["VELA_BASE_URL"])
```

### Handle errors

```python
from openai import OpenAIError

try:
    reply = client.chat.completions.create(model="cc/claude-sonnet-5", messages=[...])
except OpenAIError as e:
    print(f"Request failed: {e}")
```

### Retry with backoff

```python
import time
from openai import RateLimitError

def chat_with_retry(prompt, max_retries=3):
    for attempt in range(max_retries):
        try:
            return client.chat.completions.create(
                model="cc/claude-sonnet-5",
                messages=[{"role": "user", "content": prompt}],
            ).choices[0].message.content
        except RateLimitError:
            if attempt == max_retries - 1:
                raise
            time.sleep(2 ** attempt)
```

Better still: use a **combo** as the model. Vela then moves to the next model when one fails, and your retry logic only has to handle the case where every rung is out.

## Troubleshooting

### Connection refused

```bash
curl http://localhost:32060/api/health      # {"ok":true}
```

If that fails, Vela is not running or not on that port. Check the base URL ends in `/v1` even once it does.

### 401 Unauthorized

- The key must be complete and start with `vela-v1-`.
- The header must be `Authorization: Bearer <key>` — one space after `Bearer`.
- Keys are shown once. If you no longer have it, create another.

### 404 model not found

- Use the exact id; case matters.
- Ask the gateway: `curl .../v1/models -H "Authorization: Bearer <key>"`.
- Model ids change upstream — a retired one will not resolve.

### 429

- Read the code in the response body: rate limit, scope or budget.
- Budget codes mean a ceiling you set was reached — edit it under **Endpoint & Key**.
- Otherwise retry with backoff, or let a combo move on.

### Timeouts

- Raise the client timeout; long generations take time.
- Try a faster model for interactive paths.
- Remember that a reverse proxy must not buffer the stream (`proxy_buffering off`).

## Best practice

### Security
- Keys in environment variables or a secret store, never in source.
- HTTPS for anything leaving your machine.
- One key per application, so a leak is one key to rotate.

### Performance
- Stream when a human is waiting.
- Cache repeated answers yourself where it is legitimate.
- Match the model to the task instead of defaulting to the most expensive one.

### Cost
- Watch **Usage**; the per-key report is the honest account of what a script costs.
- Set a spend cap on any key used by automation.

## Next steps

- [Cursor](cursor.md) · [Cline](cline.md) · [Continue](continue.md) · [Roo](roo.md)
- [Combos](../features/combos.md) — fallback chains for scripts
- [Quota tracking](../features/quota-tracking.md) — reading usage and budgets
