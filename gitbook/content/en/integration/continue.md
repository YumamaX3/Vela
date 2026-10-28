# Continue VSCode Extension Integration

Continue is an open-source AI assistant for VS Code and JetBrains. It reads a `config.json`, and that file is all you need to route it through Vela.

## Prerequisites

- VS Code with the Continue extension installed
- Vela running locally, or a reachable cloud endpoint
- An API key from the Vela dashboard (**Endpoint & Key → Create Key**)

## Configuration steps

### 1. Open Continue's configuration

- `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
- Run **Continue: Open Config**
- This opens `~/.continue/config.json`

### 2. Add Vela models

Continue's current configuration format uses a `models` array:

**One model:**

```json
{
  "models": [
    {
      "title": "Vela — Claude Opus",
      "provider": "openai",
      "model": "cc/claude-opus-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    }
  ]
}
```

**Several, so you can switch in the dropdown:**

```json
{
  "models": [
    {
      "title": "Vela — Opus (hard tasks)",
      "provider": "openai",
      "model": "cc/claude-opus-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    },
    {
      "title": "Vela — Sonnet (everyday)",
      "provider": "openai",
      "model": "cc/claude-sonnet-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    },
    {
      "title": "Vela — GLM (cheap)",
      "provider": "openai",
      "model": "glm/glm-4.7",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1"
    }
  ]
}
```

**For a deployed Vela**, change `apiBase`:

```json
"apiBase": "https://your-domain.example/v1"
```

> If your Continue version still uses the older `models`/`apiBase` schema shown here, it works as written. Newer builds may ask you to run a small config wizard on first launch; the same three values — provider `openai`, model id, base URL — go in the same places.

### 3. Save and reload

Save the file, then **Developer: Reload Window**. Continue reads the config on load.

### 4. Select a model

Open the Continue sidebar and pick the model from the dropdown at the top.

## Available models

Anything the gateway lists — check with:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

| Model | Lane |
|-------|------|
| `cc/claude-opus-5` | Claude subscription |
| `cc/claude-sonnet-5` | Claude subscription |
| `cc/claude-haiku-4-5-20251001` | Claude subscription |
| `cx/gpt-5.6-sol` | Codex subscription |
| `cx/gpt-5.4` | Codex subscription |
| `glm/glm-4.7` | cheap |
| `minimax/MiniMax-M2.1` | cheapest |
| `kr/claude-sonnet-4.5` | free |

Combos work as model ids too.

## Usage examples

- **Explain:** select code, open the sidebar, ask "Explain this".
- **Generate:** ask for "a React card component for a user profile".
- **Refactor:** select code, ask "Refactor this to async/await".
- **Debug:** paste the stack trace and ask what broke.

## Advanced

### A system prompt

```json
{
  "models": [
    {
      "title": "Vela — Code Expert",
      "provider": "openai",
      "model": "cc/claude-sonnet-5",
      "apiKey": "vela-v1-<id>-<checksum>",
      "apiBase": "http://localhost:32060/v1",
      "systemMessage": "You are a senior engineer. Prefer small, reviewable changes and explain trade-offs."
    }
  ]
}
```

### Temperature

```json
"temperature": 0.9,
"topP": 0.95
```

For code, lower temperature is usually better; for writing, higher.

### Context providers

Continue decides what to send alongside your prompt. Tightening this is the single biggest lever on cost for Continue users:

```json
{
  "contextProviders": [
    { "name": "code", "params": { "maxLines": 100 } },
    { "name": "diff", "params": {} }
  ]
}
```

## Keyboard shortcuts

- `Cmd/Ctrl + L` — open the chat
- `Cmd/Ctrl + I` — inline edit
- `Cmd/Ctrl + Shift + R` — regenerate

(Shortcuts vary by version; VS Code's keyboard shortcuts panel lists yours.)

## Troubleshooting

### The model does not respond

1. `curl http://localhost:32060/api/health` → `{"ok":true}`.
2. Check the key in `config.json`.
3. Open VS Code's developer console (**Help → Toggle Developer Tools**) and read the error.

### The wrong model answers

- Check the dropdown in the sidebar — Continue remembers the last selection.
- Model ids are case-sensitive.

### The config does not load

- Validate the JSON (a trailing comma is the usual culprit).
- Confirm the path is `~/.continue/config.json`.
- Reload the window after saving.

### Slow

- Use a lighter model.
- Cut the context: fewer `maxLines`, fewer attached files.
- Check network latency to Vela.

## Best practice

1. **Three models, three prices** — Opus for thinking, Sonnet for writing, GLM for chores. Switching is one click.
2. **Select before asking** — sending whole files is the expensive habit.
3. **Put a ceiling on the key** if Continue runs on a shared machine.

## Next steps

- [Cursor](cursor.md) for the IDE
- [Roo](roo.md) for another agent
- [Combos](../features/combos.md) for fallback chains
