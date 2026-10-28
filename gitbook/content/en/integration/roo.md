# Roo AI Assistant Integration

Roo is a VS Code agent that lives in the sidebar. Point it at Vela and it reaches every model you have connected, with one key and one address.

## Prerequisites

- Roo installed in VS Code
- Vela running locally, or a reachable cloud endpoint
- An API key from the Vela dashboard (**Endpoint & Key → Create Key**)

## Configuration steps

### 1. Open Roo's settings

Launch Roo and open its settings panel from the sidebar.

### 2. Choose the provider type

Under **API Provider**, choose **OpenAI Compatible**. Vela speaks the OpenAI API, so that is the right shape — Roo will ask for a base URL, a key and a model id.

### 3. Fill in the three fields

**Local Vela:**

```
Base URL:  http://localhost:32060/v1
API Key:   vela-v1-<id>-<checksum>
Model:     cc/claude-opus-5
```

**Deployed Vela:**

```
Base URL:  https://your-domain.example/v1
API Key:   [your Vela key]
Model:     cc/claude-opus-5
```

### 4. Test it

Send:

```
Hello! Can you confirm you're connected through Vela?
```

Then look under **Usage** in the dashboard — the request should be there, attributed to that key.

## Choosing a model

| Model | Lane | Use it for |
|-------|------|------------|
| `cc/claude-opus-5` | Claude subscription | the hardest tasks |
| `cc/claude-sonnet-5` | Claude subscription | balanced everyday work |
| `cc/claude-haiku-4-5-20251001` | Claude subscription | quick edits |
| `cx/gpt-5.6-sol` | Codex subscription | coding-heavy problems |
| `glm/glm-4.7` | cheap | long sessions on a budget |
| `kr/claude-sonnet-4.5` | free | when paid lanes are spent |

> **A note on the `cc/` lane.** The Claude Code provider (`claude`, alias `cc`) carries a **deprecated** marker with a risk notice in this release: it rides an undocumented Claude Code interface that can change without notice. It works today and it is the natural choice for an Anthropic subscription — keep `cx/` and the free `kr/` Claude models in mind if it breaks.

## Usage examples

```
Quick tasks       : cc/claude-haiku-4-5-20251001  or  glm/glm-4.7
Balanced work     : cc/claude-sonnet-5  or  cx/gpt-5.6-sol
Hard reasoning    : cc/claude-opus-5
Cost-sensitive    : glm/glm-4.7  →  kr/claude-sonnet-4.5
```

## Model selection tips

- **Fast and cheap** for renames, comment fixes and small edits.
- **Sonnet-class** for ordinary feature work.
- **Opus-class** when a task spans many files or the logic is subtle.
- **A combo** when the session may outlive a quota window — it is the difference between finishing and not.

## Troubleshooting

### Connection failed

1. `curl http://localhost:32060/api/health` → `{"ok":true}`.
2. Check the base URL ends in `/v1`.
3. Check the key is complete.
4. Reload the VS Code window.

### Model not available

- The id must match exactly, case included.
- Confirm the provider is connected in **Providers**.
- Check the gateway's own list: `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"`.

### Slow responses

- Move to a lighter model (`cc/claude-haiku-4-5-20251001`, `glm/glm-4.7`).
- Trim the context — fewer attached files.
- Check the provider is not degraded.

## Advanced

### Short aliases

If Roo lets you save named model presets, name them after the job rather than the model:

```
"fast"  → cc/claude-haiku-4-5-20251001
"smart" → cc/claude-opus-5
"cheap" → glm/glm-4.7
"chain" → never-stuck
```

### Separate profiles

Different profiles for different kinds of work — coding, writing, research — each with its own model and its own Vela key, so usage lands in the right bucket.

## Next steps

- [Cursor](cursor.md) for IDE integration
- [Continue](continue.md) for VS Code
- [Combos](../features/combos.md) for the fallback chains worth using
