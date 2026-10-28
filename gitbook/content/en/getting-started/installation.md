# Installation

Everything you need to get Vela running: the requirements, four ways to install it, how to verify that it works, and how to take it off again. If you just want it running in two minutes, [Quick Start](quick-start.md) is the shorter road.

---

## Requirements

### System requirements

- **Node.js**: version 20 or newer if you install through npm. The official Docker image bundles Node 22, so Docker users can skip this.
- **npm**: version 10 or newer (it ships with Node.js).
- **Operating system**: macOS, Linux, or Windows (Windows works natively; WSL is also fine).
- **Disk**: roughly 500MB for the app, more for your data as usage history grows.
- **Memory**: about 1GB is comfortable. The Docker image sets a 1GB heap ceiling by default.

Check what you have:

```bash
node --version
# v20.x.x or newer

npm --version
# 10.x.x or newer
```

If Node.js is missing, install it from [nodejs.org](https://nodejs.org/) or with a version manager such as `nvm`.

---

## Installation methods

### Method 1: npm global install (recommended)

```bash
npm install -g vela
vela
```

The `vela` command is a launcher. It starts the gateway, waits for the port to answer, and opens the dashboard. Flags worth knowing:

```bash
vela                    # start on the default port, open the browser
vela --port 8080        # a different port
vela --host 127.0.0.1   # this machine only (the default binds 0.0.0.0)
vela --no-browser       # do not open a browser
vela --log              # show server logs in the terminal
vela --tray             # run in the system tray
vela --skip-update      # skip the update check on start
vela --help             # everything else
```

**Why this is the default choice:**
- ✅ Run it from any directory
- ✅ One command: `vela`
- ✅ `npm update -g vela` keeps it current
- ✅ The launcher restarts a crashed server and keeps its runtime binaries in `~/.vela/runtime`, away from the install directory

### Method 2: run without installing

If you only want to try it:

```bash
npx vela
```

This downloads the launcher into npm's cache and runs it. Nothing is installed globally, but the data directory (`~/.vela`) is still created, and your settings survive between runs.

### Method 3: Docker

Good for a server, a NAS, or anything where you would rather not install Node.js.

```bash
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  ghcr.io/yumamax3/vela:1.2.4
```

Then open **http://localhost:32060/dashboard**.

- The image is **public**. You do not need a GitHub login, a personal access token, or any credentials to pull it.
- The image is multi-architecture: it runs natively on both ordinary servers (`linux/amd64`) and ARM machines such as a Raspberry Pi or an Apple Silicon Docker host (`linux/arm64`).
- **Pin the tag.** `ghcr.io/yumamax3/vela:1.2.4` is the current release. `:latest` moves whenever a new version is published, and a restart can then silently put you on a version you did not choose.
- **Always mount `/app/data`.** Without the volume, your database lives inside the container and disappears with it.

The [cloud deployment guide](../deployment/cloud.md) covers Compose, reverse proxies and the environment variables in depth.

### Method 4: from source

For development, patching, or building your own image.

```bash
git clone https://github.com/YumamaX3/Vela.git
cd Vela
npm install
npm run build
npm run start
```

The project sits at the root of the clone — there is no nested `app/` folder. The scripts are:

```bash
npm run dev        # development server with hot reload, port 32060
npm run build      # production build
npm run start      # run the production build
```

`npm run dev` is for working on Vela itself. `npm run build` followed by `npm run start` is what a deployment should run.

> ⚠️ **A note on versions:** if what you built behaves differently from this documentation, check `package.json` — its `version` field is the truth. This documentation describes **1.2.4**.

---

## First run

### Starting the server

```bash
vela
```

What happens:

1. The gateway starts on `http://localhost:32060`.
2. The dashboard opens in your browser at `/dashboard`.
3. A data directory is created — `~/.vela` on macOS and Linux, `%APPDATA%\vela` on Windows — or the one named by `DATA_DIR` if you set it.
4. Nothing else. There is **no default password** and no pre-generated key.

### The dashboard password

This is where old tutorials disagree with modern Vela, so it is worth stating plainly:

- **There is no default password.** Not `123456`, not `admin`, not anything else.
- **Local access is open.** From the machine running Vela, the dashboard loads without asking for anything. That is deliberate: you should not need to log in to your own laptop.
- **Remote access is refused until you set one.** If someone opens the dashboard from another machine on the network, Vela will not let them in with a password that was never chosen.

To set a password: open the dashboard **from the machine running Vela**, go to **Settings → Access**, and set one there. The same screen lets you require a dashboard login, toggle whether API requests must carry a key, and see at a glance whether the gateway is "gated" — the checkmark you want before you expose it to a network.

Alternatively, set `INITIAL_PASSWORD` in the environment before the first start; Vela will accept it as the login password.

### Getting an API key for your tools

```
Dashboard → Endpoint & Key → Create Key
→ copy the key that appears (it is shown once)
```

A key looks like `vela-v1-<random>-<checksum>`. In the same dialog you can give it a narrower scope: which providers, models or combos it may reach; a rate limit; a daily/weekly/monthly token budget; and a spend ceiling. For a shared or long-running setup, set a ceiling — Vela answers with a clear 429 once it is reached instead of quietly spending.

---

## Verify the installation

### Check the server is alive

```bash
curl http://localhost:32060/api/health
```

Expected:

```json
{"ok":true}
```

The health route is intentionally unauthenticated, so it answers even when `REQUIRE_API_KEY` is on.

### List the models you can reach

```bash
curl http://localhost:32060/v1/models \
  -H "Authorization: Bearer vela-v1-your-key-here"
```

You will get every model from every provider you have connected. If the list is empty, no provider is connected yet — see step 3 of [Quick Start](quick-start.md).

### Send one real request

```bash
curl http://localhost:32060/v1/chat/completions \
  -H "Authorization: Bearer vela-v1-your-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm/glm-4.7",
    "messages": [{"role": "user", "content": "Say hello in five words."}]
  }'
```

A reply means everything — gateway, key, provider, routing — is working. If it fails, the error text names the reason; [Troubleshooting](../troubleshooting.md) maps the common ones to fixes.

---

## Configuration

### Environment variables

You can set these in your shell, in a `.env` file beside the app, or as container environment. The ones that matter first:

```bash
# Security — set these for any non-local deployment
export JWT_SECRET="$(openssl rand -hex 32)"   # signs dashboard sessions
export INITIAL_PASSWORD="your-password"       # optional first login password

# Storage
export DATA_DIR="$HOME/.vela"                 # where the database lives

# Server
export PORT="32060"                           # the default
export NODE_ENV="production"
```

`JWT_SECRET` deserves a warning: since October 2026, Vela **refuses to boot** if it is left at a placeholder or is shorter than 32 characters. Generate a real one. The full list of variables is in the repository's `.env.example` and `docs/ENVIRONMENT.md`.

### Data directory

Default: `~/.vela` (macOS/Linux) or `%APPDATA%\vela` (Windows).

```text
~/.vela/
  db/
    data.sqlite        # providers, combos, keys, settings
    backups/           # pre-migration safety copies and scheduled backups
  logs/                # request logs, if enabled
  runtime/             # launcher-managed binaries
```

To move it:

```bash
export DATA_DIR="/srv/vela-data"
vela
```

On Windows, a Unix-style path (starting with `/`) is ignored with a warning and the default is used — that path cannot exist there.

### Port configuration

The default is `32060`. Change it with the flag or the environment:

```bash
vela --port 8080
# or
PORT=8080 vela
```

If you use a different port, update every tool that points at `/v1` — and keep the trailing `/v1` in the base URL.

---

## Troubleshooting the install

### Port already in use

```
Error: listen EADDRINUSE: address already in use :::32060
```

Find and stop the process, or pick another port:

```bash
# macOS / Linux
lsof -i :32060
kill <PID>

# Windows
netstat -ano | findstr :32060
taskkill /PID <PID> /F

# or simply start elsewhere
vela --port 8080
```

### Permission denied

```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/...'
```

The fix is to give npm a directory it owns, not to use `sudo`:

```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g vela
```

### Node.js too old

```
Error: The engine "node" is incompatible with this module
```

Update Node.js — with `nvm` if you have it, otherwise from [nodejs.org](https://nodejs.org/):

```bash
nvm install 20
nvm use 20
```

### The dashboard does not open

Open `http://localhost:32060/dashboard` yourself. If that does not load either, check the process is running (`vela --log` shows its output), and check your firewall: on macOS, allow the Node process in System Settings → Network → Firewall; on Linux, check `ufw` or `iptables`; on Windows, allow it through Windows Defender Firewall.

### A provider will not connect

- Check that you are online (`ping 1.1.1.1`).
- Check the provider's status page before assuming a local fault.
- For OAuth providers, try **Providers → [provider] → Disconnect → Connect** again; an expired session often looks exactly like a broken install.

### High memory use

Restart the gateway (`Ctrl+C`, then `vela`). For a long-running install, use a process manager:

```bash
npm install -g pm2
pm2 start vela --name vela
pm2 save
```

---

## Deployment options

### On your own machine

```bash
npm install -g vela
vela
```

**Good for:** personal coding, trying providers out, keeping everything local.

### On a server

```bash
docker run -d --name vela --restart unless-stopped \
  -p 127.0.0.1:32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="choose-a-password" \
  ghcr.io/yumamax3/vela:1.2.4
```

Binding to `127.0.0.1` means only a reverse proxy on the same machine can reach the dashboard — the safe default for an internet-facing host. [Cloud deployment](../deployment/cloud.md) has the full Nginx configuration, with the streaming settings that matter.

### Behind a reverse proxy

Streaming responses (server-sent events) need buffering turned off, or they will arrive in one lump at the end:

```nginx
location / {
    proxy_pass http://127.0.0.1:32060;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 86400;
}
```

---

## Uninstalling

```bash
npm uninstall -g vela      # remove the launcher
rm -rf ~/.vela             # remove data, keys and settings — this is irreversible
```

On Windows the data directory is `%APPDATA%\vela`. Then delete any exports you added to your shell profile.

If you ran Docker instead:

```bash
docker stop vela && docker rm vela
docker rmi ghcr.io/yumamax3/vela:1.2.4
# and remove the volume or host directory you mounted
```

---

## Next steps

- [Quick start](quick-start.md) — connect providers and point your tools at Vela
- [Providers](../providers/subscription.md) — which lane to use when
- [Features](../features/smart-routing.md) — routing, combos, quota tracking
- [Troubleshooting](../troubleshooting.md) — when something will not connect

---

## Need help?

- **Website**: [vela.my.id](https://vela.my.id)
- **GitHub**: [github.com/YumamaX3/Vela](https://github.com/YumamaX3/Vela)
- **Issues**: [github.com/YumamaX3/Vela/issues](https://github.com/YumamaX3/Vela/issues)
