# ⛵ Vela — The AI Gateway CLI

**One OpenAI-compatible endpoint across 143+ providers. Never stop coding.**

**Connect All AI Code Tools (Claude Code, Cursor, Antigravity, Copilot, Codex, Gemini, OpenCode, Cline, OpenClaw...) to 143 AI Providers & 1000+ Models — with RTK token savings, quota tracking, and auto-fallback.**

[![npm](https://img.shields.io/npm/v/vela.svg)](https://www.npmjs.com/package/vela)
[![License](https://img.shields.io/npm/l/vela.svg)](https://github.com/YumamaX3/Vela/blob/main/LICENSE)
[![GHCR](https://img.shields.io/badge/GHCR-YumamaX3%2FVela-blue?logo=github)](https://github.com/YumamaX3/Vela/pkgs/container/vela)

---

## 🤔 Why Vela?

**Stop wasting money, tokens and hitting limits:**

- ❌ Subscription quota expires unused every month
- ❌ Rate limits stop you mid-coding
- ❌ Tool outputs (git diff, grep, ls...) burn tokens fast
- ❌ Expensive APIs ($20-50/month per provider)

**Vela solves this:**

- ✅ **RTK Token Saver** — Auto-compress `tool_result`, save 20–40% tokens
- ✅ **Maximize subscriptions** — Track quota, use every bit before reset
- ✅ **Auto fallback** — Subscription → Cheap → Free, zero downtime
- ✅ **Multi-account** — Round-robin between accounts per provider
- ✅ **Universal** — Works with any OpenAI/Claude-compatible CLI

---

## ⚡ Quick Start

**Option 1 — npm (recommended for desktop):**

```bash
npm install -g vela
vela

# Or run directly with npx
npx vela
```

**Option 2 — Docker (server/VPS):**

```bash
docker run -d --name vela -p 32060:32060 \
  -v "$HOME/.vela:/app/data" -e DATA_DIR=/app/data \
  ghcr.io/yumamax3/vela:latest
```

🎉 Dashboard opens at `http://localhost:32060`

**2. Connect a FREE provider (no signup needed):**

Dashboard → Providers → Connect **Kiro AI** (free Claude unlimited) or **OpenCode Free** (no auth) → Done!

**3. Use in your CLI tool:**

```
Claude Code/Codex/OpenClaw/Cursor/Cline Settings:
  Endpoint: http://localhost:32060/v1
  API Key:  [copy from dashboard]
  Model:    kr/claude-sonnet-4.5
```

That's it! Start coding with FREE AI models.

---

## 🚀 CLI Options

```bash
vela                    # Start with default settings
vela --port 8080        # Custom port
vela --host 127.0.0.1   # Local-only (default is 0.0.0.0 — network-exposed!)
vela --no-browser       # Don't open browser
vela --log              # Show server logs
vela --tray             # Run in system tray (background)
vela --skip-update      # Skip auto-update check
vela --help             # Show all options
vela xai video --prompt "..." --output clip.mp4   # Grok Imagine via the gateway
```

**Dashboard**: `http://localhost:32060/dashboard`

---

## 🛠️ Supported CLI Tools

Claude Code • OpenClaw • Codex • OpenCode • Cursor • Antigravity • Cline • Continue • Droid • Roo • Copilot • Kilo Code • Gemini CLI • Qwen Code • iFlow • Crush • Crusher • Aider

Any tool supporting OpenAI/Claude-compatible API works.

---

## 💾 Data Location

- **macOS/Linux**: `~/.vela/db/data.sqlite`
- **Windows**: `%APPDATA%/vela/db/data.sqlite`
- **Docker**: `/app/data/db/data.sqlite` (mount `$HOME/.vela` to persist)

---

## 🛡️ Stability Notes

- **Graceful drain** — the server drains in-flight requests on shutdown (no half-boot states)
- **Crash recovery** — the CLI restarts a crashed server up to 2× (30s window); after repeated crashes it disables the MITM proxy and tries again
- **Runtime deps** — native SQLite + tray binaries live in `~/.vela/runtime` (not the locked install dir), so `npm i -g vela@latest` never hits Windows EBUSY locks

---

## 📚 Documentation

- **Source**: https://github.com/YumamaX3/Vela
- **Changelog**: https://github.com/YumamaX3/Vela/blob/main/CHANGELOG.md

---

## 🙏 Acknowledgments

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** — Original Go implementation
- The Shores' design system — the gateway's dashboard, the covenant, the voice

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
