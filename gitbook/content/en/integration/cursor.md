# Cursor Integration

Cursor can use a custom OpenAI-compatible endpoint. Point it at Vela and every chat, inline edit and autocomplete call goes through the gateway — routed, tracked, and subject to your keys and budgets.

## Prerequisites

- Cursor installed
- Vela running locally, or a reachable cloud endpoint
- An API key from the Vela dashboard (**Endpoint & Key → Create Key**)

## ⚠️ Things worth knowing first

> **Custom endpoints may need a paid Cursor plan.** Cursor has moved this capability around between versions and plans. If the base-URL field is not offered in your build, that is a Cursor restriction, not a Vela one.

> **Localhost may not be enough.** Some Cursor configurations send requests through Cursor's own servers, from which `localhost` means Cursor's machine, not yours. If requests fail with a connection error while your browser can reach the dashboard, that is the cause — deploy Vela where Cursor can reach it (see [Cloud deployment](../deployment/cloud.md)) and use that address instead.

> **Use a domain, not a bare IP, over HTTPS.** If you put Vela behind a reverse proxy, give it a TLS certificate — API keys travel in the request.

## Setup

### 1. Open Cursor's model settings

**Settings** (`Cmd/Ctrl + ,`) → **Models**.

### 2. Enable the custom OpenAI endpoint

Turn on **OpenAI API key** and look for the **Override OpenAI Base URL** field. If your build has it, you are in business.

### 3. Set the base URL

```
http://localhost:32060/v1
```

Keep the `/v1`. A URL without it will reach the dashboard instead of the API and fail with a confusing HTML response.

### 4. Paste your key

The key looks like `vela-v1-<id>-<checksum>`. Get a fresh one from **Endpoint & Key → Create Key** if you do not have one — keys are shown once.

### 5. Add a model

Under **View All Models → Add custom model**, add the model id exactly as Vela resolves it:

```
cc/claude-opus-5
cc/claude-sonnet-5
glm/glm-4.7
premium-coding          ← a combo name works here too
```

### 6. Select it

Pick the model in Cursor's chat model selector and send a message. Confirm it arrived under **Usage** in the Vela dashboard.

## Configuration example

```
OpenAI API:        ✓ enabled
Base URL:          http://localhost:32060/v1
API key:           vela-v1-xxxxxxxx-xxxxxxxx
Custom models:     cc/claude-opus-5, cc/claude-sonnet-5, glm/glm-4.7
```

## Available models

Anything the gateway lists — run `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` to see yours. Common picks:

| Model | Lane |
|-------|------|
| `cc/claude-opus-5` | Claude subscription |
| `cc/claude-sonnet-5` | Claude subscription |
| `cx/gpt-5.6-sol` | Codex subscription |
| `glm/glm-4.7` | cheap |
| `minimax/MiniMax-M2.1` | cheapest |
| `kr/claude-sonnet-4.5` | free |

Combos work here as well, and are the reason to use Cursor with Vela at all: when one model's quota closes, the next one answers, mid-conversation.

## Usage

- **Chat** (`Cmd/Ctrl + L`) — select the Vela model and ask.
- **Inline edit** (`Cmd/Ctrl + K`) — select code, prompt, accept.
- **Explain** — select code, ask, and check which model answered under **Routed by Combo** if you are using a chain.

## Troubleshooting

### "Invalid API key"

1. Verify under **Endpoint & Key** that the key exists and is enabled.
2. Copy the whole key — `vela-v1-` through the trailing checksum.
3. Keys in an old `sk-...` format predate the current scheme and are rejected; create a new one.

### "Model not found"

1. Use the exact id from `/v1/models`.
2. Check the provider is connected in **Providers**.
3. Remember that a model the provider retired will not resolve, however it is spelled.

### Connection failures

1. Confirm Vela answers: `curl http://localhost:32060/api/health`.
2. Confirm the base URL ends in `/v1`.
3. If Cursor's servers are in the path, `localhost` cannot work — use a deployed endpoint.

### The field is missing

Some Cursor builds and plans do not expose a custom base URL. Nothing on the Vela side can add it. Alternatives: Cline, Roo or Continue inside VS Code, which all accept a base URL.

## Cloud endpoint

On a server with a certificate:

```
Base URL:  https://your-domain.example/v1
API key:   [your Vela key]
```

Then Cursor reaches Vela from wherever it runs. The rate limits and provider rotation are the same; only the address changed.

## Best practice

1. **One key per machine or per person** — the usage report tells you who spent what.
2. **Put a ceiling on it** if Cursor runs unattended; a spend cap is the only thing that stops a runaway loop.
3. **Rotate keys** when a laptop is lost or a key is pasted somewhere it should not be.
4. **Use a combo** so a quota wall does not end your afternoon.
