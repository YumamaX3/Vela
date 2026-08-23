# Vela — Agent Skills

Drop-in skills for any AI agent (Claude, Cursor, ChatGPT, custom SDK). Just **copy a link** below and paste it to your AI — it will fetch the skill and use Vela for you.

> Tip: start with the **vela** entry skill — it covers setup and links to all capability skills.

## Skills

| Capability | Copy link below and paste to your AI |
|---|---|
| **Entry / Setup** (start here) | https://raw.githubusercontent.com/YumamaX3/Vela/main/skills/vela/SKILL.md |
| Chat / code-gen | https://raw.githubusercontent.com/YumamaX3/Vela/main/skills/vela-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/YumamaX3/Vela/main/skills/vela-image/SKILL.md |
| Video generation (xAI Grok Imagine) | https://raw.githubusercontent.com/YumamaX3/Vela/main/skills/vela-video/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/YumamaX3/Vela/main/skills/vela-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/YumamaX3/Vela/main/skills/vela-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/YumamaX3/Vela/main/skills/vela-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/YumamaX3/Vela/main/skills/vela-web-search/SKILL.md |
| Web fetch (URL → markdown) | https://raw.githubusercontent.com/YumamaX3/Vela/main/skills/vela-web-fetch/SKILL.md |

## How to use

Paste to your AI (Claude, Cursor, ChatGPT, …):

```
Read this skill and use it: https://raw.githubusercontent.com/YumamaX3/Vela/main/skills/vela/SKILL.md
```

Then ask normally — *"generate an image of a cat"*, *"transcribe this URL"*, etc.

## Configure your shell once

```bash
export VELA_URL="http://localhost:32060"   # local default, or your VPS / tunnel URL
export VELA_KEY="sk-..."                   # from Dashboard → Keys (only if requireApiKey=true)
```

Verify: `curl $VELA_URL/api/health` → `{"ok":true}`.

## Links

- Source: https://github.com/YumamaX3/Vela
- Dashboard: your Vela instance at `${VELA_URL}/dashboard`
