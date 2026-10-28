# Cline Integration

Cline is a VS Code extension that reads, edits and runs code for you. Point it at Vela and it gets any model you have connected — plus a fallback chain when a quota closes mid-task.

## Prerequisites

- VS Code installed
- The Cline extension, installed from the VS Code marketplace
- Vela running locally, or a reachable cloud endpoint
- An API key from the Vela dashboard (**Endpoint & Key → Create Key**)

## Setup

### 1. Open Cline's settings

Click the Cline icon in the VS Code sidebar, then the gear icon in the Cline panel.

### 2. Choose the OpenAI Compatible provider

In the **API Provider** dropdown, choose **OpenAI Compatible**. That is the correct choice for Vela — it accepts an OpenAI-shaped base URL and a key.

### 3. Set the base URL

```
http://localhost:32060/v1
```

Include the `/v1`. A cloud deployment is the same shape with a different host:

```
https://your-domain.example/v1
```

### 4. Paste your key

Your Vela key looks like `vela-v1-<id>-<checksum>`. It is shown once when created, so create a fresh one under **Endpoint & Key** if you have lost it.

### 5. Set the model id

Cline accepts a free-text model id. Use one Vela resolves:

```
cc/claude-opus-5
cc/claude-sonnet-5
glm/glm-4.7
premium-coding            ← a combo name works too
```

### 6. Save

Close the settings panel; Cline saves as you type. Send a small message to confirm, then check **Usage** in the Vela dashboard.

## Configuration example

```
API Provider:  OpenAI Compatible
Base URL:      http://localhost:32060/v1
API Key:       vela-v1-xxxxxxxx-xxxxxxxx
Model:         cc/claude-opus-5
```

### What the dashboard writes

Cline keeps its settings in two files on disk. The dashboard's Quick Connect prints exactly this shape, and you can paste it by hand if you prefer editing files to clicking:

```json
// ~/.cline/data/globalState.json
{ "openAiBaseUrl": "http://localhost:32060", "actModeApiProvider": "openai" }
```

```json
// ~/.cline/data/secrets.json
{ "openAiApiKey": "vela-v1-<id>-<checksum>" }
```

Note the difference from the field above: **`openAiBaseUrl` here omits the `/v1`** — Cline appends the path itself. A base URL of `http://localhost:32060/v1` in that field produces `/v1/v1/chat/completions` and a 404. Use the dashboard's snippet, or enter the URL through Cline's own settings panel, which handles the suffix for you.

## Available models

Anything the gateway lists: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.

| Model | Lane | Good for |
|-------|------|----------|
| `cc/claude-opus-5` | Claude subscription | complex multi-file work |
| `cc/claude-sonnet-5` | Claude subscription | everyday edits |
| `cx/gpt-5.6-sol` | Codex subscription | hard coding problems |
| `glm/glm-4.7` | cheap | long runs on a budget |
| `minimax/MiniMax-M2.1` | cheapest | big contexts |
| `kr/claude-sonnet-4.5` | free | when paid lanes are dry |

> **A note on the `cc/` lane.** The Claude Code provider (`claude`, alias `cc`) is marked **deprecated with a risk notice** in the registry this release ships. It works, and it is what most people want for their Anthropic subscription — but it depends on an undocumented Claude Code interface that can change without warning. If it starts failing, the free `kr/` Claude models and the `cx/` lane are the steady alternatives.

## Usage

### Chat

Type in the Cline panel and press Enter. Cline sends the conversation, and any files it chooses to read, through Vela.

### Code generation

Ask for a change ("add pagination to this endpoint"). Cline proposes edits; review them before accepting — the same care you would take with any agent.

### File operations

Cline can create, modify and delete files. Vela does not alter that behaviour; it only decides which model plans and executes it. Fallback here is genuinely useful: a model switch between steps keeps a long task moving.

## Troubleshooting

### "Connection failed"

1. `curl http://localhost:32060/api/health` → should answer.
2. Confirm the base URL ends in `/v1`.
3. Check the firewall on port 32060.
4. Reload the VS Code window (`Cmd/Ctrl + Shift + P` → "Reload Window").

### "Invalid API key"

- The key must start with `vela-v1-`. Keys in an older `sk-...` format are rejected.
- Copy it whole, with no trailing newline.
- Create a new key if the old one was ever pasted publicly — old keys cannot be displayed again.

### "Model not found"

- Use the exact id from `/v1/models`.
- Confirm that provider is connected in **Providers**.
- Model ids change upstream; a retired id will not resolve however it is spelled.

### Cline stops mid-task

Very often a quota window closing or a rate limit. A combo (`cc/claude-opus-5 → glm/glm-4.7 → kr/claude-sonnet-4.5`) lets the next step run on the next model instead of stopping.

## Advanced

### Using a combo

```
Model: never-stuck
```

with a chain that ends on a free provider. Long agent runs benefit most — they are exactly the workload that hits a quota wall half an hour in.

### Switching models per task

Keep two or three ids handy and change the field as the work changes:

- heavy reasoning and refactors → `cc/claude-opus-5`
- everyday edits → `glm/glm-4.7`
- experiments → `kr/claude-sonnet-4.5`

### Timeouts

Large edits with long contexts can exceed Cline's request timeout. Raise it in VS Code settings if Cline offers the option, or split the task — Vela will stream as fast as the provider does.

## Best practice

1. **Give Cline its own key**, with a spend ceiling. An agent that loops can burn a budget surprisingly fast; a cap makes that a stop instead of an invoice.
2. **Keep conversations focused** — context is the dominant cost.
3. **Never commit the key.** It lives in VS Code settings, not in the repository.
4. **Watch which model answered** in **Routed by Combo** when using a chain: it tells you whether your fallbacks are doing the work.
