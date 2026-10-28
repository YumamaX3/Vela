# 🏠 Localhost Deployment

Running Vela on your own machine is the default, the easiest, and the one with the fewest ways to go wrong. This page covers the day-to-day: starting it, stopping it, moving its data, updating it, and the two or three problems that come up most.

If you have not installed it yet, start with [Installation](../getting-started/installation.md).

---

## 📦 Installation

```bash
npm install -g vela
```

**Requirements:**
- Node.js 20 or newer
- npm 10 or newer (ships with Node.js)

---

## 🚀 Starting the server

```bash
vela
```

The dashboard opens by itself at **http://localhost:32060/dashboard**.

**Default configuration:**

| What | Where |
|-|-|
| **Dashboard** | `http://localhost:32060/dashboard` |
| **API endpoint** | `http://localhost:32060/v1` |
| **Default port** | `32060` |
| **Data directory** | `~/.vela` (macOS/Linux) · `%APPDATA%\vela` (Windows) |
| **Dashboard password** | none by default — see below |

One process serves both the dashboard and the API. There is no second port to remember.

### About the password

There is **no default password** in current Vela. From the machine itself, the dashboard opens without one. Remote browsers are refused until you set a password under **Settings → Access** — a direct answer to everyone who ever shipped `123456` as a default and regretted it.

If you want a login even locally, set one in **Settings → Access** (or set `INITIAL_PASSWORD` before the first start) and turn on **Require dashboard login**.

### About the network

By default the launcher binds to `0.0.0.0`, which means other machines on your network can reach the port. For a purely local setup:

```bash
vela --host 127.0.0.1
```

---

## 🔧 Configuration

### A custom data directory

```bash
DATA_DIR=/path/to/data vela
```

On Windows, use a native path such as `D:\vela-data`; a Unix-style path there is ignored with a warning.

### A custom port

```bash
vela --port 8080
# or
PORT=8080 vela
```

Everything that talks to Vela — your editor, your scripts — must then use `http://localhost:8080/v1`.

### A custom host

```bash
vela --host 127.0.0.1    # this machine only
vela --host 0.0.0.0      # all interfaces (the default)
```

---

## 🛑 Stopping the server

Press `Ctrl+C` in the terminal running it. The gateway drains in-flight requests before exiting, so a streaming reply finishes rather than being cut in half.

If it was started in the background or through a process manager:

```bash
pm2 stop vela         # if you used PM2
pkill -f vela         # last resort
```

---

## 🔄 Restarting

```bash
vela
```

Providers, keys, combos, budgets and usage history all survive — they live in the data directory, not in memory.

---

## 📊 Updating

```bash
npm update -g vela
```

Check what you are running:

```bash
npm list -g vela
```

For the Docker route, pull the newer tag explicitly:

```bash
docker pull ghcr.io/yumamax3/vela:1.2.5
docker stop vela && docker rm vela
# re-run the same docker run command with the new tag
```

Database migrations run automatically on start, with a safety copy taken first under `~/.vela/db/backups/`. Still, back up before a major update.

---

## 🔍 Troubleshooting

### Port already in use

```bash
# macOS / Linux
lsof -i :32060
kill <PID>

# Windows
netstat -ano | findstr :32060
taskkill /PID <PID> /F
```

Or just run on another port: `vela --port 8080`.

### Permission errors on install

```bash
# Give npm a directory it owns (recommended)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g vela
```

### The data directory is not writable

```bash
ls -la ~/.vela
chmod 755 ~/.vela
```

If it still fails, point `DATA_DIR` at a directory you own.

### The dashboard will not load from another machine

That is the password gate doing its job. Either open it on the Vela machine and set a password under **Settings → Access**, or keep it local with `vela --host 127.0.0.1` and reach it through an SSH tunnel:

```bash
ssh -L 32060:localhost:32060 you@the-vela-machine
# then open http://localhost:32060/dashboard
```

---

## 📁 The data directory

```text
~/.vela/
├── db/
│   ├── data.sqlite     # providers, keys, combos, settings, usage
│   └── backups/        # pre-migration copies and any scheduled backups
├── logs/               # request logs, when enabled
└── runtime/            # binaries the launcher manages
```

**Backing up is just copying the directory** — ideally while Vela is stopped, so SQLite's write-ahead log has settled:

```bash
# While Vela is stopped:
cp -r ~/.vela ~/.vela.backup

# Restore (with Vela stopped):
rm -rf ~/.vela && cp -r ~/.vela.backup ~/.vela
```

For scheduled, encrypted backups, Vela has a built-in engine — see the backup variables in `.env.example` (`VELA_BACKUP_*`). Keep `VELA_BACKUP_ENCRYPTION_KEY` somewhere you will still have it in a year; losing it makes the backups unreadable forever.

---

## 🔗 Next steps

- [Connect providers](../providers/subscription.md)
- [Build a fallback chain](../features/combos.md)
- [Point your editor at Vela](../integration/cursor.md)
- [Going remote: cloud deployment](cloud.md)
