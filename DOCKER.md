# 🐳 Docker

> *"The ship that sails in a bottle — same hull, same sails, no harbor
> required. This chart covers the published image, volumes, the compose
> chart, storage postures in a container, and the update rite."*

**Covers:** quick start · authentication to GHCR · volumes · compose chart ·
storage postures · Headroom sidecar · upgrades · local builds.

---

## Table of Contents

- [Quick Start](#-quick-start)
- [The Image](#-the-image)
- [Volumes & Data](#-volumes--data)
- [The Compose Chart](#-the-compose-chart)
- [Storage Postures in Docker](#-storage-postures-in-docker)
- [Headroom Sidecar](#-headroom-sidecar)
- [Upgrading](#-upgrading)
- [For Developers](#-for-developers)

---

## 🚀 Quick Start

```bash
# 1. Authenticate — the image is PRIVATE (it inherits the repo's visibility).
#    Use a GitHub PAT with read:packages + repo access.
docker login ghcr.io

# 2. Pull and sail
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:0.9.21
```

Then open **http://localhost:32060/dashboard**.

Manage the container:

```bash
docker logs -f vela        # view logs
docker stop vela           # stop
docker start vela          # start again
docker rm -f vela          # remove
```

> ⚠️ **Note:** there is no default password. When `INITIAL_PASSWORD` is
> unset, the dashboard admits the local console without a password but
> refuses remote logins until one is set. Set `INITIAL_PASSWORD` (or set a
> password under Profile → Security) to enable remote access.

---

## 📦 The Image

- **Registry:** `ghcr.io/yumamax3/vela:<tag>` — built by
  `.github/workflows/docker-publish.yml` on every `v*` git tag
  (multi-arch `linux/amd64` + `linux/arm64`).
- **Pin a tag, not `latest`.** Tags map 1:1 to releases (`:0.9.21`);
  `latest` follows the newest build and can surprise you.
- **What ships inside:** the Next.js standalone server, `open-sse/`, the
  `cli/` launcher bits, and — deliberately — the full runtime closure of
  `mysql2` (pure-JS, loaded via dynamic import the file tracer can't follow,
  so the Dockerfile copies its 9 transitive packages explicitly). MariaDB
  support works out of the box; no native build step, ever.
- **Runtime hygiene:** the image carries a `HEALTHCHECK` (`wget /api/health`
  on 32060, 30s interval, 30s start-period), `STOPSIGNAL SIGTERM` (pairs
  with the custom server's graceful drain), full OCI metadata labels
  (source/revision/version), and drops to the `node` user via `su-exec` after
  fixing the mounted data dirs' ownership.

---

## 💾 Volumes & Data

```bash
-v "$HOME/vela-data:/app/data" \
-e DATA_DIR=/app/data
```

Without `DATA_DIR`, the app falls back to `~/.vela/` inside the
container — which is lost when the container is removed. Always mount.

Data layout under `$DATA_DIR/`:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite       # the SQLite harbor
│   └── backups/          # sealed backup artifacts (when enabled)
└── …                     # certs, logs, runtime configs
```

> 📌 **Note:** usage logs (`usage.json`, `log.txt`) live under `~/.vela`
> inside the app and do **not** follow `DATA_DIR` — treat them as ephemeral.

---

## 📋 The Compose Chart

The repo ships a **template**, not a live chart:

| File | Tracked in git? | Purpose |
|-|-|-|
| `docker-compose.example.yml` | ✅ yes | Sanitized template — every knob documented, `set-me` placeholders |
| `docker-compose.yml` | ❌ no (gitignored) | **Your** live chart — real secrets inline, no `.env` indirection |

First deploy:

```bash
cp docker-compose.example.yml docker-compose.yml
# fill in every `set-me` placeholder (secrets, MySQL URL if used)
docker compose up -d
```

The template defines up to three services:

- ⛵ **`vela-gateway`** — the gateway + dashboard (always)
- 🪞 **`vela-twin`** — OPTIONAL bundled MariaDB for `mysql`/`mirror` postures
- 💨 **`vela-headroom`** — OPTIONAL request-compression sidecar (internal-only)

Everything rides **inline in the chart** — environment block per service.
Keep your filled-in chart out of git; it carries real credentials.

---

## 🪞 Storage Postures in Docker

`VELA_DB_MODE` selects the harbor — set it in the gateway's environment
block (see [STORAGE.md](./docs/STORAGE.md) for the full covenant):

```yaml
environment:
  VELA_DB_MODE: "mirror"                    # sqlite | mysql | mirror
  VELA_MYSQL_URL: "mysql://user:pass@twin-host:3306/vela"
```

- `sqlite` — default; the mounted volume IS the harbor.
- `mysql` — point `VELA_MYSQL_URL` at your MariaDB (or use the bundled
  `vela-twin` service). An unreachable twin refuses boot LOUD.
- `mirror` — SQLite serves, writes pump to the twin. With a fresh empty
  twin, the divergence sweep seeds it within ~10 seconds (auto-resync ON).

Switching posture = edit the chart, then recreate the container
(`docker compose up -d` recreates changed services automatically).

---

## 💨 Headroom Sidecar

The Vela image does not bundle Python or Headroom. Run it as a separate
service and point Vela at it:

```yaml
services:
  vela-gateway:
    environment:
      HEADROOM_URL: http://vela-headroom:8787
    depends_on: [vela-headroom]
  vela-headroom:
    image: ghcr.io/chopratejas/headroom:latest
    ports: ["8787:8787"]
```

Then in the dashboard: **Endpoint → Token Saver → Headroom** → confirm the
URL → enable. If Headroom runs on the Docker *host* instead, use
`http://host.docker.internal:8787` (macOS/Windows) or add
`extra_hosts: ["host.docker.internal:host-gateway"]` (Linux).

---

## 🔄 Upgrading

```bash
# 1. Bump the pinned tag in docker-compose.yml
#    image: ghcr.io/yumamax3/vela:0.9.20  →  ghcr.io/yumamax3/vela:0.9.21
# 2. Pull and recreate
docker compose pull
docker compose up -d
```

Plain `docker run` equivalent:

```bash
docker pull ghcr.io/yumamax3/vela:<new-tag>
docker rm -f vela
# re-run the quick start command with the new tag
```

> 💡 **Tip:** the Storage Covenant's backup engine makes upgrades safe —
> enable scheduled backups before major version jumps, and keep
> `VELA_BACKUP_ENCRYPTION_KEY` stored offline.

---

## 🛠️ For Developers

### Build the image locally

```bash
docker build -t vela:local .
docker run --rm -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET=dev-secret -e INITIAL_PASSWORD=dev \
  vela:local
```

### Docker smoke test (MariaDB posture)

`scripts/docker-smoke-mysql.sh` builds the image, spins up a throwaway
MariaDB, boots Vela with `VELA_DB_MODE=mysql`, waits for healthy, and tears
everything down:

```bash
bash scripts/docker-smoke-mysql.sh
```

### Publishing (automatic via CI)

Push a git tag `v*` → GitHub Actions builds multi-platform and pushes
`ghcr.io/yumamax3/vela:v{version}` + `:latest`. The workflow trims its own
runtime to stay inside the free Actions budget (private repos: 2,000
minutes/month — a multi-arch build costs ~16 min).

---

## 🔗 See Also

- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — install paths beyond Docker
- [docs/STORAGE.md](./docs/STORAGE.md) — the Storage Covenant
- [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md) — the env contract
- [docker-compose.example.yml](./docker-compose.example.yml) — the template chart

— *Vela · The Sail of the Ship* ⛵
