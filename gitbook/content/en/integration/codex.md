# OpenAI Codex CLI Integration

Codex CLI can be pointed at Vela with a small block in `~/.codex/config.toml`. This is the same shape the dashboard's **CLI Tools → Codex** page writes for you, so you can either paste it yourself or let the dashboard do it.

## Prerequisites

- Codex CLI installed
- Vela running locally, or a cloud endpoint you can reach
- An API key from the Vela dashboard (**Endpoint & Key → Create Key**)

## Setup

### 1. Edit `~/.codex/config.toml`

```toml
model = "cx/gpt-5.6-sol"
model_provider = "Vela"

[model_providers.Vela]
name = "Vela"
base_url = "http://localhost:32060/v1"
wire_api = "responses"
http_headers = { Authorization = "Bearer [your Vela key]" }
```

A custom provider in Codex authenticates **only** through the `http_headers` line above — the `OPENAI_API_KEY` in `auth.json` belongs to the built-in `openai` provider and is not read for a provider defined this way. Put the key here, not there.

### 2. Check it

```bash
curl -s http://localhost:32060/api/health      # → {"ok":true}
codex "Write a function that reverses a linked list"
```

Then look at **Usage** in the dashboard; the request should be there.

### 3. If you prefer environment variables

Some setups prefer the environment to the file. That works too, for anything that speaks the OpenAI API:

```bash
export OPENAI_BASE_URL="http://localhost:32060/v1"
export OPENAI_API_KEY="[your Vela key]"
```

The `config.toml` route is the one the dashboard generates, and the one to prefer — it survives a new shell.

## Available models

| Model | Good for |
|-------|----------|
| `cx/gpt-5.6-sol` | the current flagship for coding |
| `cx/gpt-5.6-terra` | a second modern option |
| `cx/gpt-5.6-luna` | lighter, faster work |
| `cx/gpt-5.5`, `cx/gpt-5.4` | stable fallbacks |

Any other model or combo works too — Codex does not care what the id means, only that Vela can resolve it.

## Usage examples

```bash
# Write code
codex --model cx/gpt-5.6-sol "Create a REST endpoint that paginates results"

# Explain code
codex --model cx/gpt-5.6-terra "Explain what this does: $(cat myfile.js)"

# Use a fallback chain
codex --model quality-first "Plan the refactor"
```

## Troubleshooting

### Authentication errors

1. The key must be in `http_headers` inside `[model_providers.Vela]` — a key in `auth.json` will not be used for a custom provider.
2. Check the key is complete and starts with `vela-v1-`.
3. Create a fresh one under **Endpoint & Key** if in doubt; keys cannot be recovered after creation.

### Connection issues

1. `curl http://localhost:32060/api/health`.
2. Confirm `base_url` ends in `/v1`.
3. Check nothing is blocking port 32060.

### Model not available

1. `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.
2. Confirm the Codex provider is connected in Vela (**Providers**).
3. Model ids change upstream; pick a current one from the list above.

## Cloud endpoint

Replace `base_url` with your deployed address (keeping `/v1`):

```toml
base_url = "https://your-domain.example/v1"
```

Older documentation mentions the project owner's hosted instance at `https://vela.my.id`; that is an upstream fact about their deployment, not a service these docs can promise. Use whatever endpoint you have credentials for.
