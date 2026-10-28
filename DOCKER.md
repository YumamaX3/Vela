# 🐳 Docker — The Ship in a Bottle ⛵

> *"Same hull, same sails — no harbor required. This chart covers the published
> image, the volume that carries the whole tree, the compose chart, storage
> postures in a container, the Headroom sidecar, the update rite, and the local
> builds. Every number below was weighed against the tree, and each carries the
> command that proved it."*

**Covers:** quick start · GHCR access · the image · volumes & `DATA_DIR` ·
compose · storage postures · Headroom · upgrades · local builds.

**Pinned at `1.2.4`** — the version in `package.json` (measured 2026-10-28,
`grep '"version"' package.json`). Tags map 1:1 to releases; the compose template
already carries this pin (`docker-compose.example.yml:67`).

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
# 1. Authenticate — OPTIONAL. The image is PUBLIC (it inherits the Vela repo's
#    visibility), so anonymous pulls work. Log in only for a rate limit or a
#    read:packages against a private mirror.
docker login ghcr.io

# 2. Pull and sail
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:1.2.4
```

Then open **http://localhost:32060/dashboard**.

Manage the container:

```bash
docker logs -f vela        # view logs
docker stop vela           # SIGTERM → graceful drain, at most 10s
docker start vela          # start again
docker rm -f vela          # remove (the volume survives — that is its purpose)
```

> ⚠️ **There is no default password.** With `INITIAL_PASSWORD` unset, the
> dashboard admits the **local console** without a password and refuses every
> **remote** login (`403`) until one is set — under Profile → Security, or via
> `INITIAL_PASSWORD` and a restart. And since 2026-10-11 the boot is
> **strength-gated**: a placeholder or sub-32-character `JWT_SECRET` refuses the
> boot rather than open a forgeable door (`src/lib/auth/dashboardSession.js`).

---

## 📦 The Image

- **Registry:** `ghcr.io/yumamax3/vela:<tag>` — **PUBLIC**; built by
  `.github/workflows/docker-publish.yml` on every `v*` git tag
  (multi-arch `linux/amd64` + `linux/arm64`), with `:latest` emitted alongside.
- **Pin a tag, not `latest`.** Current release: **`1.2.4`**. `latest` follows the
  newest build and can surprise you on a restart. The pin is guarded —
  `tests/unit/docker-compose-pin.test.js` fails if the tracked chart's tag drifts
  from `package.json`.
- **Base:** `node:22.23.4-alpine` (`Dockerfile:2`). **Runtime hygiene:** the
  image carries a `HEALTHCHECK` (`wget -qO- http://127.0.0.1:32060/api/health`,
  interval 30s · timeout 5s · start-period 30s · retries 3), `STOPSIGNAL SIGTERM`
  (pairs with the custom server's 10s drain), full OCI metadata labels
  (source/revision/version), `tini` as PID 1, and an entrypoint that
  `chown -R node:node /app/data /app/data-home` then drops to the **non-root
  `node`** user via `su-exec` (`Dockerfile:153-165`).
- **What ships inside:** the Next.js **standalone** server, `open-sse/`,
  `public/`, `.next/static`, the `cli/` launcher bits, and — deliberately — the
  full runtime closure of `mysql2`. It loads via a runtime dynamic import that
  the file tracer cannot follow, so the Dockerfile copies its **9 transitive
  packages** explicitly (`aws-ssl-profiles`, `generate-function`, `iconv-lite`,
  `is-property`, `long`, `lru.min`, `named-placeholders`, `safer-buffer`,
  `sql-escaper`). MariaDB works out of the box; no native build step, ever.
- **Driver postures are pinned deliberately, and asymmetrically.** The *builder*
  stage pins `VELA_DB_DRIVER=node:sqlite` (`Dockerfile:24`); the *runner* does
  **not** pin it, so the production chain stays open. What the runner does pin is
  `VELA_LOG_DRIVER=node:sqlite` (`Dockerfile:57`), the worker's own handle.
- **Heap ceiling is 1 GB:** the image sets
  `NODE_OPTIONS=--max-old-space-size=1024` (`Dockerfile:66`). Raise it in the
  chart, but keep it comfortably under the container memory limit.
- **The census** (measured 2026-10-28):

  ```bash
  ls open-sse/providers/registry/*.js | grep -v index.js | wc -l   # 189 files on disk
  node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"  # 186 imported
  node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 dialable
  find src/app/api -name route.js | wc -l                          # 258 API routes
  ```

  Three numbers, never one: a registry file is not an import, and an import is
  not a dialable lane.

---

## 💾 Volumes & Data

```bash
-v "$HOME/vela-data:/app/data" \
-e DATA_DIR=/app/data
```

Without a mounted volume, the app falls back to `~/.vela/` **inside the
container** — lost on `docker rm`. Always mount.

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite                 # the SQLite harbor (WAL siblings alongside)
│   └── backups/
│       ├── schema-N-to-M/          # pre-migration safety backups (auto)
│       └── artifacts/              # sealed scheduled backups — *.velabak
└── …                               # certs, logs, runtime configs
```

> 📌 **The whole tree travels with the volume.** The SQLite harbor, backups and
> MITM request dumps all resolve from `DATA_DIR` (`src/lib/db/paths.js`,
> `src/mitm/logger.js`). `usageDb.js` is a **shim** re-exporting the DB layer, so
> usage and request logs live in the harbor too — the old `db.json` / `usage.json`
> names survive only as `LEGACY_FILES`, read once for migration
> (`src/lib/db/migrate.js:322-323`).

`DATA_DIR` is also where `jwt-secret` and `api-key-secret` persist when you do
not supply them — including their loss, which is the argument for setting them
in the chart explicitly (see [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md)).

---

## 📋 The Compose Chart

The repo ships a **template**, not a live chart:

| File | Tracked in git? | Purpose |
|-|-|-|
| `docker-compose.example.yml` | ✅ yes | Sanitized template — every knob documented, `set-me` placeholders, image pinned `1.2.4` |
| `docker-compose.yml` | ❌ no (gitignored) | **Your** live chart — real secrets inline, no `.env` indirection |

First deploy:

```bash
cp docker-compose.example.yml docker-compose.yml
# fill in every `set-me` placeholder (secrets; MySQL URL if you use a twin)
docker compose up -d
```

The template defines up to three services:

| Service | In the template | Image | Notes |
|-|-|-|-|
| ⛵ **`vela-gateway`** | **active** | `ghcr.io/yumamax3/vela:1.2.4` | Gateway + dashboard; publishes `32060` |
| 🪞 **`vela-twin`** | **commented out** | `mariadb:11` | Optional bundled MariaDB for `mysql`/`mirror`; internal-only |
| 💨 **`vela-headroom`** | **active** | `ghcr.io/headroomlabs-ai/headroom:0.35.0-slim-nonroot` | Optional compression sidecar; internal-only, fail-open |

Everything rides **inline in the chart** — environment block per service. Keep
your filled-in chart out of git; it carries real credentials.

The gateway block pins the defaults you will *not* normally touch: `TZ: UTC`,
`DATA_DIR: /app/data`, `PORT: "32060"`, `HOSTNAME: "0.0.0.0"`,
`NODE_ENV: production`, `VELA_DEPLOYMENT: docker` (the update notice hands you
the compose command), `stop_grace_period: 30s` (> the 10s drain), a `healthcheck`,
`json-file` logging capped at 3 × 10 MB, resource limits (2 CPUs / 2 GB, 512 MB
reservation), and `security_opt: ["no-new-privileges:true"]`.

---

## 🪞 Storage Postures in Docker

`VELA_DB_MODE` selects the harbor — set it in the gateway's environment block
(the full covenant lives in [docs/STORAGE.md](./docs/STORAGE.md)):

```yaml
environment:
  VELA_DB_MODE: "mirror"                    # sqlite | mysql | mirror
  VELA_MYSQL_URL: "mysql://user:pass@vela-twin:3306/vela"
```

- `sqlite` — default; the mounted volume **is** the harbor.
- `mysql` — point `VELA_MYSQL_URL` at your MariaDB (or the bundled `vela-twin`).
  An unreachable twin **refuses the boot, loud** — never a silent downgrade.
- `mirror` — SQLite serves; writes pump to the twin. A fresh empty twin is seeded
  by the divergence sweep within roughly ten seconds (auto-resync is on by
  default). An unreachable twin starts **degraded** and stays `mirror`.

The schema is at **version 23**, migrations `001`–`023` (`src/lib/db/schema.js:6`;
`ls src/lib/db/migrations/`). Switching posture is an edit plus a recreate —
`docker compose up -d` recreates changed services automatically.

---

## 💨 Headroom Sidecar

Vela's image does not bundle Python or Headroom. Run it as a separate service
and point Vela at it:

```yaml
services:
  vela-gateway:
    environment:
      HEADROOM_URL: http://vela-headroom:8787
    depends_on: [vela-headroom]
  vela-headroom:
    image: ghcr.io/headroomlabs-ai/headroom:0.35.0-slim-nonroot
```

The chart is **internal-only** — no host port. Vela reaches it by compose
service name over the shared `vela` network, which is the only door it needs.
`HEADROOM_URL` also seeds `DEFAULT_SETTINGS.headroomUrl`
(`src/lib/headroom/detect.js`), so a saved dashboard setting wins over it.

Then in the dashboard: **Endpoint → Token Saver → Headroom** → confirm the URL →
enable. The gateway's client **fails open** — with no reachable sidecar it
compresses nothing and serves as usual.

If Headroom runs on the Docker *host* instead, use
`http://host.docker.internal:8787` (macOS/Windows) or add
`extra_hosts: ["host.docker.internal:host-gateway"]` (Linux).

> ⚠️ **Publish no port for a pinned image you did not choose.** An older copy of
> this chart showed `ports: ["8787:8787"]` against a `:latest` tag. Neither
> survives: the release-pinned slim tag is the honest pattern, and an
> internal-only sidecar needs no published door at all.

---

## 🔄 Upgrading

The rite is always the same shape: **bump → pull → recreate**. The tag pair
below is illustrative; substitute your own *current → next*.

```bash
# 1. Bump the pinned tag in docker-compose.yml
#    image: ghcr.io/yumamax3/vela:1.2.4   →  ghcr.io/yumamax3/vela:<next>
# 2. Pull and recreate (up -d alone reuses the local image)
docker compose pull
docker compose up -d
```

Plain `docker run` equivalent:

```bash
docker pull ghcr.io/yumamax3/vela:<next>
docker rm -f vela
# re-run the quick start command with the new tag
curl -s http://localhost:32060/api/health     # → {"ok":true}
```

> 💡 **Tip:** the backup engine makes upgrades safe — enable scheduled backups
> before major jumps (`VELA_BACKUP_ENABLED=true`) and keep
> `VELA_BACKUP_ENCRYPTION_KEY` offline, or the artifacts cannot be opened.
> A boot automatically writes a `schema-N-to-M` safety snapshot into
> `$DATA_DIR/db/backups/` before any schema change — a net, not a strategy.
> Rolling the image back does **not** roll the schema back.

---

## 🛠️ For Developers

### Build the image locally

```bash
docker build -t vela:local .
docker run --rm -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" -e INITIAL_PASSWORD=dev \
  vela:local
```

> ⚠️ `JWT_SECRET=dev-secret` will **refuse the boot** — the strength gate is not
> negotiable, local or not. Generate a real one even for a throwaway.

### Docker smoke test (MariaDB posture)

> ⚠️ **The old `scripts/docker-smoke-mysql.sh` is gone.** `scripts/` is
> gitignored except two build-critical files, so that harness was local-only
> and untracked — it will not run on a fresh clone. The recipe below is the
> manual equivalent.

```bash
docker run -d --name vela-smoke-db -e MARIADB_ROOT_PASSWORD=dev \
  -e MARIADB_DATABASE=vela -p 3306:3306 mariadb:11
# wait for it to accept connections, then:
docker run --rm --network host \
  -e VELA_DB_MODE=mysql \
  -e VELA_MYSQL_URL="mysql://root:dev@127.0.0.1:3306/vela" \
  -e DATA_DIR=/app/data -e JWT_SECRET="$(openssl rand -hex 32)" \
  vela:local
# expect {"ok":true} on /api/health; an unreachable twin refuses the boot
docker rm -f vela-smoke-db
```

### Publishing (automatic via CI)

Push a git tag `v*` → GitHub Actions builds multi-platform and pushes
`ghcr.io/yumamax3/vela:v{version}` + `:latest`. The workflow trims its own
runtime to stay inside the free Actions budget (private repos: 2,000
minutes/month — a multi-arch build costs roughly 16 minutes).

---

## 🔗 See Also

- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) — the four berths, exposure, the reverse proxy, upgrades
- [docs/STORAGE.md](./docs/STORAGE.md) — the Storage Covenant
- [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md) — the complete env contract
- [docker-compose.example.yml](./docker-compose.example.yml) — the template chart, pinned `1.2.4`

— *Vela · The Sail of the Ship* ⛵
