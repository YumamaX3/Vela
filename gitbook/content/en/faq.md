# Frequently Asked Questions

The questions people ask first, answered plainly. If nothing here matches, [Troubleshooting](troubleshooting.md) is the next stop.

---

## What is Vela?

**A gateway between your coding tools and your AI providers.**

You point every tool at one address — `http://localhost:32060/v1` — and Vela routes each request to a provider you have connected. It keeps track of quotas, keeps OAuth tokens fresh, and can fall back to a different model when one refuses.

It is not a model, and it does not make models free. It is the switchboard between the models you already have access to.

---

## Is Vela free?

**Vela itself is free and open source (MIT).**

What costs money is what happens upstream: a Claude Code subscription, a Codex plan, or pay-per-token providers like GLM and MiniMax. Vela does not add a fee on top.

You can run entirely on free providers — iFlow, Qwen, Kiro, Antigravity — if you accept their limits. That combination costs nothing.

---

## How does routing work?

There are two mechanisms, and they are different:

1. **A combo** is a chain you define: model 1, then model 2, then model 3. When a request to a model *fails* — quota error, rate limit, timeout, refused prompt, unknown model — Vela tries the next one.
2. **Round-robin** (per provider, or per combo) spreads requests across several accounts of the same provider, so one account is not hammered.

Neither one switches you to a cheaper model merely because a daily allowance is running low. That would spend money you did not agree to spend.

For a hard ceiling, use a per-key budget: when it is reached, Vela refuses with a 429 that says so.

See [Smart Routing](features/smart-routing.md) and [Combos](features/combos.md).

---

## How many providers does Vela support?

Three honest numbers, measured on 2026-10-28 at version 1.2.5:

- **189** provider files in the registry
- **186** imported by the index (three are deliberately commented out: `devin-cli`, `trae`, `windsurf`)
- **145** with a transport a request can actually reach

You can re-derive them in your own clone:

```bash
ls open-sse/providers/registry/*.js | grep -v index.js | wc -l
node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"
node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"
```

The ones documented lane by lane here:

- **Subscription:** Claude Code, Codex, GitHub Copilot, Antigravity, Kimi
- **Cheap:** GLM, MiniMax, Kimi
- **Free:** iFlow, Qwen, Kiro

---

## Which models can I use today?

Model ids are `prefix/model`. A few reliable ones in this release:

| Model | Lane |
|-------|------|
| `cc/claude-opus-5`, `cc/claude-sonnet-5` | Claude Code subscription |
| `cx/gpt-5.6-sol`, `cx/gpt-5.5` | Codex subscription |
| `gh/claude-sonnet-4.6`, `gh/gpt-5.4` | GitHub Copilot |
| `ag/gemini-4-argon-high` | Antigravity (free) |
| `glm/glm-4.7` | cheap — $0.60 / $2.20 per 1M |
| `minimax/MiniMax-M2.1` | cheap — $0.30 / $1.20 per 1M |
| `kr/claude-sonnet-4.5` | free |
| `if/qwen3-coder-plus` | free |
| `qwen/qwen-plus` | free |

Do not trust documentation over the running gateway:

```bash
curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"
```

That list is the truth for your install.

---

## Can I use several providers together?

**Yes — that is the point.** Build a combo:

```
Dashboard → Combos → Create
  Name:   premium-coding
  Models: 1. cc/claude-opus-5       ← subscription
          2. glm/glm-4.7            ← cheap
          3. kr/claude-sonnet-4.5   ← free
```

Then use `premium-coding` as the model name in any tool. The combo name is resolved before anything else, so it looks like an ordinary model on the wire.

---

## Does Vela work with Cursor?

**Yes.** Cursor takes an OpenAI-compatible base URL and key. If Vela runs on your machine:

```
Cursor → Settings → Models → OpenAI API
  Base URL: http://localhost:32060/v1
  API Key:  [your Vela key]
  Model:    your model or combo name (add it as a custom model)
```

Some Cursor versions restrict custom endpoints to paid plans, and some configurations route through Cursor's own servers, in which case `localhost` is not reachable from their side. In that situation, deploy Vela on a server with a public address (see [Cloud deployment](deployment/cloud.md)) and use `https://your-domain/v1` instead.

Other tools that take a base URL work the same way: Cline, Roo, Continue, Claude Code, Codex CLI, and anything else OpenAI-compatible. See [Integration](integration/claude-code.md).

---

## Can I self-host Vela?

**Yes, and it is the intended way to run it.** Three routes:

**On your machine:**
```bash
npm install -g vela
vela
# dashboard: http://localhost:32060/dashboard
# API:       http://localhost:32060/v1
```

**With Docker, on any server:**
```bash
docker run -d --name vela \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/yumamax3/vela:1.2.5
```

The image is public — no login or token required to pull it — and multi-architecture (amd64 and arm64). Pin the tag rather than using `:latest`.

**From source:**
```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

The repository root is the app; there is no nested `app/` directory. The available scripts are `dev`, `build`, `start` (and their Bun variants) — there is no test script and no Cloudflare deploy script.

Full details: [Localhost](deployment/localhost.md) · [Cloud](deployment/cloud.md).

---

## Is my data safe?

**It stays on your machine, by default.**

- Everything lives in the data directory — `~/.vela` on macOS/Linux, `%APPDATA%\vela` on Windows, or whatever `DATA_DIR` names.
- Connected providers' OAuth tokens and API keys are stored in that local database.
- Vela sends requests only to the providers you connected; nothing is reported back to the Vela project.

**What it keeps:** provider connections and tokens, your API keys (stored as hashes — full keys are shown once at creation), usage statistics, combos, settings and request logs (only if you enable them).

**What it does not keep:** a copy of your prompts or generated code beyond the request logs, which are off by default.

**Before exposing it to a network:** set a dashboard password under **Settings → Access**, turn on **Require dashboard login**, consider **Require API key**, and put it behind HTTPS. The checklist is in [Cloud deployment](deployment/cloud.md).

---

## What is the default password?

**There isn't one.**

Older tutorials mention `123456`; that default was retired. Current Vela has no default password at all:

- From the machine running Vela, the dashboard opens without asking.
- From anywhere else, logins are **refused** until you set a password under **Settings → Access**.

The same screen shows a green "gated" verdict once the controls are in place — worth checking before you open a port.

---

## How do I update Vela?

```bash
# npm install
npm update -g vela
npm list -g vela        # what you are running now

# Docker — pin the newer tag deliberately
docker pull ghcr.io/yumamax3/vela:1.2.5
docker stop vela && docker rm vela
# re-run your docker run command with the new tag

# From a git checkout
cd Vela && git pull && npm install && npm run build && npm run start
```

Back up the data directory first for major versions. Database migrations run automatically on start, with a safety copy taken before they do.

---

## How can I contribute?

Very welcome.

1. **Report bugs** — [GitHub Issues](https://github.com/YumamaX3/Vela/issues), with the error, the steps, and your version.
2. **Request features** — [GitHub Discussions](https://github.com/YumamaX3/Vela/discussions).
3. **Send code:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/Vela.git
   cd Vela
   git checkout -b feature/your-feature
   npm install
   npm run dev
   ```
   Run the check suite the repository ships with before opening a pull request, and keep commits small and descriptive.
4. **Improve docs** — corrections and translations are as useful as features.
5. **Add providers** — adapter examples live under `open-sse/providers/registry/`.

---

## What ports does Vela use?

- **32060** — everything: the dashboard (`/dashboard`) and the API (`/v1`), served by one process.
- **32060** again in a browser means `http://localhost:32060`; the dashboard lives one level down at `/dashboard`.

If something else needs that port, change it with `vela --port 8080` or `PORT=8080`.

---

## Where do I go when something breaks?

1. `http://localhost:32060/api/health` should answer `{"ok":true}`. If it does not, Vela is not running.
2. `curl http://localhost:32060/v1/models -H "Authorization: Bearer <key>"` should list models. An empty list means no provider is connected.
3. [Troubleshooting](troubleshooting.md) maps the common errors — connection refused, invalid key, model not found, slow replies — to their fixes.

---

## Need more help?

- **Documentation:** [vela.my.id/docs](https://vela.my.id/docs)
- **GitHub:** [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues:** [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
- **Troubleshooting:** [troubleshooting.md](troubleshooting.md)
