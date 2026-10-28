# Claude Code Integration

Pointing Claude Code at Vela takes two environment variables. After that, every Claude request your terminal makes goes through the gateway — which means it can be routed, tracked, and covered by a fallback chain.

## Prerequisites

- Claude Code CLI installed (`claude --version` should print a version)
- Vela running locally, or a cloud endpoint you can reach
- An API key created in the Vela dashboard (**Endpoint & Key → Create Key**)

## Setup

### 1. Configure environment variables

Add these to your shell profile (`~/.zshrc`, `~/.bashrc`, or `~/.bash_profile`):

```bash
export ANTHROPIC_BASE_URL="http://localhost:32060/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

- `ANTHROPIC_BASE_URL` — where Claude Code sends requests. Keep the `/v1`.
- `ANTHROPIC_AUTH_TOKEN` — your Vela key. Claude Code sends it as a bearer token; Vela accepts it as an API key.

If you prefer a different model to answer by default, set the alias targets too:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL="cc/claude-opus-5"
export ANTHROPIC_DEFAULT_SONNET_MODEL="cc/claude-sonnet-5"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="cc/claude-haiku-4-5-20251001"
```

### 2. Reload your shell

```bash
source ~/.zshrc     # or ~/.bashrc
```

### 3. Verify

```bash
echo $ANTHROPIC_BASE_URL
curl -s http://localhost:32060/api/health      # → {"ok":true}
```

Then run one small prompt:

```bash
claude --model sonnet "Say hello in five words."
```

A reply through Vela means it is wired. You can confirm it in the dashboard: **Usage** will show the request.

## Model aliases

Claude Code's short names map to whatever the environment variables above point at:

| Alias | Meaning | Set by |
|-------|---------|--------|
| `opus` | your heaviest model | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| `sonnet` | your everyday model | `ANTHROPIC_DEFAULT_SONNET_MODEL` |
| `haiku` | your fast model | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |

If you do not set them, Claude Code asks for its usual upstream names and Vela resolves them against the providers you have connected.

## Usage examples

### With aliases

```bash
claude --model opus   "Explain the trade-offs of an append-only log"
claude --model sonnet "Write a Python function that retries with backoff"
claude --model haiku  "Review this diff for typos"
```

### With a full Vela model name

```bash
claude --model cc/claude-opus-5 "Refactor this module"
```

### With a combo

This is where Vela earns its place: if the subscription window closes mid-afternoon, the chain carries on.

```bash
claude --model premium-coding "Plan the migration"
```

with a combo of `cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5`.

## The settings file

Claude Code also reads `~/.claude/settings.json`, where the same values can live under an `env` block:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:32060/v1",
    "ANTHROPIC_AUTH_TOKEN": "[your Vela key]"
  }
}
```

The dashboard can write this for you: **CLI Tools → Claude Code** fills in the base URL and the key, and shows you the result before it saves.

## Troubleshooting

### Connection issues

1. `curl http://localhost:32060/api/health` → should be `{"ok":true}`.
2. `echo $ANTHROPIC_BASE_URL` → should end in `/v1`.
3. Check nothing is blocking port 32060, and that Vela is bound where you expect (`vela --host 127.0.0.1` keeps it local).

### Model not found

1. Ask the gateway what it has: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.
2. Check the provider for that model is connected in **Providers**.
3. Remember model ids change upstream — `cc/claude-opus-5` today, something else next quarter.

### Unauthorized / 401

- Confirm `ANTHROPIC_AUTH_TOKEN` holds a Vela key (`vela-v1-...`), not a Claude subscription token.
- Keys are shown once at creation. If you no longer have it, create another under **Endpoint & Key**.

## Cloud endpoint

To use a deployed Vela instead of localhost:

```bash
export ANTHROPIC_BASE_URL="https://your-domain.example/v1"
export ANTHROPIC_AUTH_TOKEN="[your Vela key]"
```

The project's own hosted instance appears in older documentation as `https://vela.my.id` — that is the owner's deployment, an upstream fact rather than a service these docs can promise. Use whatever endpoint you actually have credentials for.
