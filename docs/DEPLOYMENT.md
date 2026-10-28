# ⚓ Vela Deployment — The Four Berths

> *"Every harbor is entered by a channel, and every channel is marked. This chart
> names the four berths — the published image, the npm launcher, the raw source,
> exposed front door — and what each demands before you tie off. Eight pins,
> one version: `1.2.5`, weighed against `package.json` on 2026-10-28."*

**Covers:** the four berths · image pin discipline · volumes & `DATA_DIR` · the
compose chart · storage posture · the security gate · the reverse-proxy contract ·
the upgrade rite · verification.

**Pinned at `1.2.5`** — measured 2026-10-28, `grep '"version"' package.json`.
The image is **PUBLIC**; the pin is guarded by
`tests/unit/docker-compose-pin.test.js`, which fails if a tracked chart's tag
drifts from `package.json`.

---

## Table of Contents

- [The Berths at a Glance](#-the-berths-at-a-glance)
- [Path A — The Published Image](#-path-a--the-published-image)
- [The Compose Chart](#-the-compose-chart)
- [Path B — The npm CLI](#-path-b--the-npm-cli)
- [Path C — From Source](#-path-c--from-source)
- [Path D — Storage Posture](#-path-d--storage-posture)
- [Exposure & The Front Door](#-exposure--the-front-door)
- [Client IP & The Reverse Proxy](#-client-ip--the-reverse-proxy)
- [The Upgrade Rite](#-the-upgrade-rite)
- [Deploy Verification](#-deploy-verification)

---

## 🧭 The Berths at a Glance

| Berth | Best for | Entry command | Data lives in |
|-|-|-|-|
| **A · Published image** | Servers, VPS, NAS, any container runtime | `docker run … ghcr.io/yumamax3/vela:1.2.5` | A mounted volume at `/app/data` |
| **B · npm CLI** | A desktop box where you want one command | `npm install -g vela && vela` | `~/.vela` · `%APPDATA%\vela` on Windows |
| **C · From source** | Development, patching, air-gapped builds | `npm install && npm run dev` | `$DATA_DIR`, else the same as B |
| **D · Exposed** | Reaching the dashboard from outside | *(any of A–C, plus the gate)* | — |

One process serves both engines — the dashboard (`src/`) and the routing engine
(`open-sse/`) — on **32060**, answering `GET /api/health` with `{"ok": true}`.
There is **no `engines` field** in `package.json`; the image pins
`node:22.23.4-alpine` (`Dockerfile:2`), and Bun runs too. The surface this
process serves, measured 2026-10-28:

```bash
find src/app/api -name route.js | wc -l        # 258 API routes
find "src/app/(dashboard)/dashboard" -name page.js | wc -l   # 31 dashboard pages
```

---

## 📦 Path A — The Published Image

```bash
docker run -d --name vela \
  -p 32060:32060 \
  -v "$HOME/vela-data:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/yumamax3/vela:1.2.5
```

Then open **http://localhost:32060/dashboard**. The image is **PUBLIC** — it
inherits the Vela repository's visibility, so anonymous pulls work, and it
carries no secrets: every secret arrives as environment, which is why the
compose chart is the only place credentials live.

**Pin the tag, never `latest`.** `ghcr.io/yumamax3/vela:1.2.5` is production;
`:latest` moves, and a restart on it can land you on a version you never chose.
Tags map 1:1 to git tags, cut by `.github/workflows/docker-publish.yml` on every
`v*` tag, multi-arch (`linux/amd64` + `linux/arm64`), with `:latest` emitted
alongside. The pin is **guarded**: `tests/unit/docker-compose-pin.test.js` fails
if the tracked chart's tag drifts from `package.json`'s version, and asserts
`docker-compose.yml` stays gitignored — once a release shipped with `package.json`
already bumped while both charts still carried the previous release's tag. The
guard exists because that wound was real, not hypothetical.

**The census you can dial.** The registry has three honest numbers, and none of
them is a marketing figure (measured 2026-10-28):

```bash
ls open-sse/providers/registry/*.js | grep -v index.js | wc -l   # 189 files on disk
node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"  # 186 imported
node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 145 dialable
```

**What ships inside.** Base `node:22.23.4-alpine`; the Next.js **standalone**
output plus `open-sse/`, `public/` and `.next/static`, and the transitive
`mysql2` closure copied explicitly (9 packages) — so `mysql`/`mirror` postures
work out of the box, with no native build.

| Directive | Value |
|-|-|
| `EXPOSE` | `32060` |
| `STOPSIGNAL` | `SIGTERM` — pairs with the custom server's graceful drain |
| `HEALTHCHECK` | `wget -qO- http://127.0.0.1:32060/api/health` · interval `30s` · timeout `5s` · start-period `30s` · retries `3` |
| `ENTRYPOINT` | `["/sbin/tini", "--", "/entrypoint.sh"]` |
| `CMD` | `["node", "custom-server.js"]` |

`tini` is PID 1, forwarding `SIGTERM` cleanly. The entrypoint `chown -R node:node
/app/data /app/data-home`, then drops to the **non-root `node` user** via
`su-exec`.

**Volumes & `DATA_DIR`.** Always mount: without it the app falls back to `~/.vela/`
**inside the container**, which dies with it. Use
`-v "$HOME/vela-data:/app/data" -e DATA_DIR=/app/data`.

```text
$DATA_DIR/db/
├── data.sqlite          # the SQLite harbor (WAL siblings alongside it)
└── backups/
    ├── schema-N-to-M/   # pre-migration safety backups (auto, before a schema change)
    └── artifacts/       # sealed scheduled backups — *.velabak
```

`DATA_DIR` resolution (`src/lib/dataDir.js`), in order: the env var if set and
writable → on Windows a Unix-style path such as `/var/lib/…` is **ignored** with a
warning → an unwritable directory (`EACCES`/`EPERM`) falls back with a warning →
else `~/.vela` on Linux/macOS, `%APPDATA%\vela` on Windows. Backups are sealed with
AES-256-GCM; `VELA_BACKUP_ENCRYPTION_KEY` loss is **permanently unrecoverable
backups** — keep it offline, with the same care as the database.

---

## 📋 The Compose Chart

| File | Tracked? | Purpose |
|-|-|-|
| `docker-compose.example.yml` | ✅ yes | Sanitized template — every knob documented, `set-me` placeholders, image pinned `1.2.5` (`:67`) |
| `docker-compose.yml` | ❌ no (`gitignore` line 44) | **Your** live chart — real secrets inline, no `.env` indirection |

```bash
cp docker-compose.example.yml docker-compose.yml
# fill in every `set-me` placeholder
docker compose up -d
```

| Service | In the template | Image | Notes |
|-|-|-|-|
| ⛵ **`vela-gateway`** | **active** | `ghcr.io/yumamax3/vela:1.2.5` | The gateway + dashboard — always present |
| 🪞 **`vela-twin`** | **commented out** | `mariadb:11` | Optional bundled MariaDB for `mysql`/`mirror`; internal-only, no host port |
| 💨 **`vela-headroom`** | **active** | `ghcr.io/headroomlabs-ai/headroom:0.35.0-slim-nonroot` | Optional compression sidecar; internal-only, fail-open |

Uncomment `vela-twin` only when you want the twin **inside** the stack; otherwise
point `VELA_MYSQL_URL` at an existing MariaDB. Headroom ships enabled because the
gateway's client fails open — with no reachable sidecar it compresses nothing.

| Key | Template value | Why |
|-|-|-|
| `TZ` · `NODE_ENV` | `UTC` · `production` | Log/quota-window alignment · Next production runtime |
| `DATA_DIR` | `/app/data` | Must match the mounted volume |
| `PORT` · `HOSTNAME` | `32060` · `0.0.0.0` | Bind inside the container; the publish mapping decides exposure |
| `VELA_DEPLOYMENT` | `docker` | Tells the update notice which command to hand you |
| `BASE_URL` | `http://localhost:32060` | **Set this to your real address** — internal sync jobs call back through it |
| `NEXT_TELEMETRY_DISABLED` · `HEADROOM_URL` | `1` · `http://vela-headroom:8787` | No Next telemetry · names the sidecar by compose service name |
| `JWT_SECRET` · `INITIAL_PASSWORD` | placeholder · `set-me` | Signs dashboard session cookies · first-login password. **JWT_SECRET must be generated fresh** (`openssl rand -hex 32`): a placeholder or sub-32-char secret REFUSES TO BOOT since 2026-10-11 |
| `API_KEY_SECRET` · `MACHINE_ID_SALT` | `set-me` · `set-me` | Derives endpoint key hashes · salts the machine identity |

Three further blocks sit commented: storage posture (`VELA_DB_MODE`,
`VELA_MYSQL_URL`), the sealed backup engine (`VELA_BACKUP_*`), and the S3
off-site leg (`VELA_BACKUP_S3_*`). Also commented: `GH_TOKEN` (raises the
update-probe rate limit), `NODE_OPTIONS` (the heap ceiling — the image sets
`--max-old-space-size=1024`), and `VELA_PROXY_CLIENT_MAX_BODY_SIZE` (default
`32mb`, `next.config.mjs:17`).

```yaml
stop_grace_period: 30s                              # > the server's 10s drain
healthcheck: {interval: 30s, timeout: 10s, retries: 3, start_period: 40s}
logging: {driver: json-file, options: {max-file: "3", max-size: "10m"}}
deploy: {resources: {limits: {cpus: "2", memory: 2G}, reservations: {memory: 512M}}}
security_opt: ["no-new-privileges:true"]
```

`VELA_DEPLOYMENT` is read by `src/lib/updateInfo.js:143`; unset, detection falls
back to `KUBERNETES_SERVICE_HOST` → `/.dockerenv` → `NODE_ENV`. The recognised
values are `docker`, `k8s`, `npm` and `dev`. The advice each gets from the update
notice differs — `docker` → `docker compose pull && docker compose up -d`, `k8s`
→ update the image tag, `npm` → the installer command, `dev` → nothing. The
template also carries an `x-casaos` block (`main: vela-gateway`, `port_map:
"32060"`) for the ZimaOS app model — the Shores' own berth runs there, at
`/media/SSD-Storage/AppData/vela` (verified in `docker-compose.yml:101`).

---

## ⌨️ Path B — The npm CLI

```bash
npm install -g vela && vela      # or: npx vela
```

The launcher (`cli/`, package name `vela`, bin `vela`) spawns the standalone
server as a child with `--dns-result-order=ipv4first --max-old-space-size=6144`,
waits for the port to accept, then opens the dashboard.

| Flag | Effect |
|-|-|
| `-p`, `--port <port>` | Listen port — default `32060` |
| `-H`, `--host <host>` | Bind address — default `0.0.0.0` |
| `-n`, `--no-browser` · `-l`, `--log` | Do not open a browser · show server logs (hidden by default) |
| `-t`, `--tray` · `--no-tray` | Run in the system tray · disable the icon (headless/CI) |
| `--skip-update` · `-h`, `--help` · `-v`, `--version` | Skip the auto-update check · usage · version |

> ⚠️ **The default host is `0.0.0.0` — network-exposed.** The launcher says so
> itself on finding a LAN address: *"⚠ Network-exposed: reachable at
> http://<lan-ip>:<port> (bound 0.0.0.0). Use --host 127.0.0.1 for local-only."*
> Take that advice unless you have read
> [Exposure & The Front Door](#-exposure--the-front-door) and set the gate.

- `vela doctor` diagnoses the local install (Node, build, data dir, port).
- Crash recovery: the launcher restarts an exited server, resetting its counter once
  the child lives past 30s; after **2** consecutive crashes it disables the MITM
  proxy before retrying.
- Runtime binaries live under `~/.vela/runtime`, not the install directory — so
  `npm i -g vela@latest` never hits Windows `EBUSY` locks.
- Default `DATA_DIR`: `~/.vela` on Linux/macOS, `%APPDATA%\vela` on Windows.

> The CLI also starts the MITM proxy and the cloudflared tunnel as **separate
> child processes on their own ports** — they are not children of the gateway's
> crash loop, and a gateway crash does not take them down with it.

---

## 🛠️ Path C — From Source

```bash
npm install
npm run dev              # next dev --port 32060 — the custom server is NOT loaded
npm run build            # sync-changelog.mjs + next build --webpack (standalone)
npm run start            # node custom-server.js --port 32060
```

`dev:webpack`, `build` and `start` carry the same shape; `dev:bun`, `build:bun` and
`start:bun` are their Bun equivalents. `postbuild` runs
`scripts/copy-standalone-assets.mjs`. `next.config.mjs` sets `output: "standalone"`, so
`npm run build` leaves a self-contained server under `.next/standalone`.

> ⚠️ **`npm run dev` is not the deployed shape.** `custom-server.js` is what wraps
> the server to stamp the client IP and strip forwarding headers; a bare `next dev`
> / `next start` never loads it. Its main-path guard handles that — with no
> `server.js` beside it, it delegates to `next start` and the wrapper still
> sanitizes every request (`custom-server.js:245-256`) — but run `npm run start`
> (or the image) in production.

---

## 🗄️ Path D — Storage Posture

`VELA_DB_MODE` chooses the harbor at boot; the full covenant lives in
[STORAGE.md](./STORAGE.md).

| Posture | Serving store | Boot behavior |
|-|-|-|
| `sqlite` *(default)* | The SQLite file in `$DATA_DIR/db/` | Always starts; a missing file is created and migrated |
| `mysql` | MariaDB via `VELA_MYSQL_URL` | **Refuses to boot** without a reachable URL — never a silent downgrade |
| `mirror` | SQLite primary + MariaDB twin | SQLite serves every read/write; an outbox pump carries writes to the twin |

The SQLite driver chain is `bun:sqlite` → `better-sqlite3` → `node:sqlite`
(Node ≥ 22.5) → `sql.js` (pure-JS, always works).
**`SCHEMA_VERSION = 23`**, migrations `001`–`023`
(`src/lib/db/schema.js:6`; `ls src/lib/db/migrations/` — 24 files including
`index.js`). For `mysql`/`mirror`, set the twin URL **inline in the
chart** — never a `.env` indirection:

```yaml
VELA_DB_MODE: "mirror"
VELA_MYSQL_URL: "mysql://vela:set-me@vela-twin:3306/vela"
```

Twin tuning, read only under `mirror`: `VELA_MIRROR_MAX_RETRIES` (poison budget);
`VELA_MIRROR_SWEEP_INTERVAL_MINUTES` + `VELA_MIRROR_SWEEP_AUTORESYNC` +
`VELA_MIRROR_DIVERGENCE_THRESHOLD` (divergence sweep); `VELA_MIRROR_USAGE_BATCH_SIZE`
/ `VELA_MIRROR_USAGE_RESYNC_INTERVAL_SECONDS` / `VELA_MIRROR_USAGE_RESYNC_MAX_ROWS`
(usage watermark resync).

Backups default **off**: `VELA_BACKUP_ENABLED=false`,
`VELA_BACKUP_INTERVAL_HOURS=24`, `VELA_BACKUP_RETAIN_DAILY=7`,
`VELA_BACKUP_RETAIN_WEEKLY=4`, `VELA_BACKUP_INCLUDE_REQUEST_DETAILS=false`, and
`VELA_BACKUP_ENCRYPTION_KEY` unset — required once you enable the engine.
`VELA_USAGE_RETENTION_DAYS=90` (`0` = keep forever) purges **after** the scheduled
backup, so purged rows live in the artifact. The off-site leg is `VELA_BACKUP_S3_*`
(`_ENABLED`, `_ENDPOINT`, `_BUCKET`, `_ACCESS_KEY`, `_SECRET_KEY`, `_REGION`).
Switching posture is an edit plus a recreate — `docker compose up -d` recreates
changed services automatically.

---

## 🌐 Exposure & The Front Door

Nothing here is optional if the dashboard is reachable by anyone but you.

**1 · A password must exist.** There is **no default password** — the old `123456`
fallback is retired. `verifyDashboardPassword` accepts a stored bcrypt hash, else
compares `INITIAL_PASSWORD` in constant time; with neither it returns `false` and
never authenticates. The dashboard says so plainly:

> *"No dashboard password is configured. Remote login is disabled until one is
> set: on the Vela host, open the dashboard locally and set a password under
> Dashboard → Profile → Security → Change password — or set the INITIAL_PASSWORD
> environment variable and restart. Loopback (local) access stays open."*

**2 · `requireLogin` must stay on.** `DEFAULT_SETTINGS` ships `requireLogin: true`,
`requireApiKey: true`, `tunnelDashboardAccess: true`, `authMode: "password"`. With
`requireLogin: false` the dashboard admits the local console frictionlessly and
`isAuthenticated` returns `true` for the deny-by-default `/api/*` branch's **READ**
pass — a real posture, but only behind a trusted door. Since 2026-10-11 (C1) the
branch's **mutations are fail-closed by class**: every `POST`/`PUT`/`PATCH`/`DELETE`
needs a JWT, the local CLI token, or the loopback console, `requireLogin` regardless
— a credential-less remote caller can no longer mint the dashboard's first password.

**3 · The tunnel is opt-in and independently gated.** Cloudflare and Tailscale
exposure are dashboard features (`/dashboard/endpoint`, backed by `src/lib/tunnel/`).
`tunnelDashboardAccess: false` redirects requests whose `Host` matches the configured
`tunnelUrl` or `tailscaleUrl` straight to `/login`, even when login is not required.

**4 · The API surface has a second, separate gate.** `REQUIRE_API_KEY` is
**documented in `.env.example` but read by no code** — measured across `src/`,
`open-sse/`, `custom-server.js` and `cli/`, its only mentions are in the changelog.
The real switch is the stored **`requireApiKey` setting** (default `true`), flipped
from the dashboard's keys room.

**5 · SSO** can replace password auth: OIDC and SAML under `/api/auth/*`
(`oidc.js`, `saml.js`, plus callbacks exempt from the cross-site mutation lock, since
an IdP posts a signed assertion cross-site by protocol).

**The first-exposure checklist:**

- [ ] `JWT_SECRET`, `API_KEY_SECRET`, `MACHINE_ID_SALT` generated fresh, unique to this deployment.
- [ ] `INITIAL_PASSWORD` set, or a password already set under Profile → Security.
- [ ] `requireLogin` still `true` for anything publicly reachable.
- [ ] `BASE_URL` set to the real external address — internal sync jobs call it.
- [ ] `AUTH_COOKIE_SECURE=true` once TLS terminates in front of the dashboard.
- [ ] `VELA_BACKUP_ENABLED=true`, with `VELA_BACKUP_ENCRYPTION_KEY` stored offline.
- [ ] `VELA_MASTER_KEY` set (32 random bytes, base64) — with it unset, provider credentials stay **plaintext** in the harbor.
- [ ] The published port bound to loopback (`127.0.0.1:32060:32060`) when a reverse proxy is the only intended entrance.
- [ ] Known: `POST /api/version/shutdown` is secret-less and production-unguarded — a remote caller who can reach the port can stop the process. Bound to loopback or shielded by the proxy, that door is closed to the outside.

---

## 🔐 Client IP & The Reverse Proxy

`custom-server.js` wraps the Next server and owns the trust boundary:

- **The socket is the truth** — the peer address comes from
  `req.socket.remoteAddress`, unspoofable.
- **Forwarding headers are trusted only from a loopback TCP peer** — the accepted
  set is `127.0.0.1`, `::1`, `::ffff:127.0.0.1`. Only then does `x-real-ip`, or
  the first hop of `x-forwarded-for`, become the client IP; from any other socket
  the headers are discarded and the socket address wins.
- **The stamp proves itself** — inbound `x-9r-real-ip`, `x-forwarded-for`,
  `x-9r-via-proxy` and `x-9r-peer-token` are deleted, then `x-9r-real-ip` is set
  to the derived IP and `x-9r-peer-token` to a per-process
  `crypto.randomBytes(24)` secret (`custom-server.js:56`). `src/lib/auth/trustedPeer.js`
  verifies that token with a constant-time compare — so the header cannot be
  forged, and a bare `next start` (which never loads this file) cannot produce a
  matching one.
- **A proxy hop is recorded** — when forwarding headers were present the server
  also sets `x-9r-via-proxy: 1`, which the dashboard guard treats as *not local*:
  correct, since the loopback socket is the proxy, not the end user.

> ⚠️ **The topology consequence.** Because trust requires a **loopback** TCP peer,
> a reverse proxy in a *different container or host* will not have its forwarding
> headers honored. Every client then appears to be the proxy's IP and the
> dashboard will not treat the request as local. Either terminate the proxy such
> that Vela sees a loopback peer, or accept the shared-IP posture knowingly.

| Also at the helm | Value |
|-|-|
| **Hop-by-hop hygiene** | Strips the RFC 7230 §6.1 set before forwarding: `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade` |
| **Security headers** | `x-content-type-options: nosniff` · `x-frame-options: DENY` · `referrer-policy: strict-origin-when-cross-origin` · `permissions-policy: camera=(), microphone=(), geolocation=(), payment=()` — the handler's own values win |
| **Keep-alive** | `keepAliveTimeout` 65s · `headersTimeout` 66s (must exceed the former) · h2c upgrades are downgraded to HTTP/1.1 and replayed under the proxy client's body ceiling |
| **Drain** | `SIGTERM`/`SIGINT` → `server.close()` → exit after at most **10s** (`DRAIN_TIMEOUT_MS`, `custom-server.js:17`) |

For a front proxy: forward `Host` and `X-Forwarded-For`/`X-Real-IP`, **disable
response buffering** for the `/v1` SSE streams, and allow long-lived connections.
`poweredByHeader` is already off at the Next layer.

---

## 🔄 The Upgrade Rite

The image is a single pinned tag; the rite is always **bump → pull → recreate**.
The pair below is illustrative — substitute your own *current → next*.

```bash
# compose — bump the pin in docker-compose.yml first
#   image: ghcr.io/yumamax3/vela:1.2.5  →  ghcr.io/yumamax3/vela:<next>
docker compose pull && docker compose up -d

# plain docker — pull, remove, then re-run the quick-start command with the new tag
docker pull ghcr.io/yumamax3/vela:<next> && docker rm -f vela

curl -s http://localhost:32060/api/health     # verify
```

The bump–pull–recreate order matters: `up -d` alone reuses the local image. Keep
`docker-compose.yml` out of git — it holds the real credentials.

**Back up before a major jump.** The migration chain is versioned and additive, and it
takes a **pre-schema safety backup automatically** before any schema change, into
`$DATA_DIR/db/backups/schema-<from>-to-<to>/` — a boot-time net, not a strategy.
The chain now stands at schema **23** (`src/lib/db/schema.js:6`).

- Turn on the sealed engine (`VELA_BACKUP_ENABLED=true`) **before** the jump and keep
  `VELA_BACKUP_ENCRYPTION_KEY` offline.
- One-command insurance:
  `docker run --rm -v "$HOME/vela-data:/app/data" alpine tar czf - -C /app/data . > vela-backup.tgz`.
- Rolling back the image does **not** roll back the schema — restoring is a restore
  from an artifact, not a downgrade. Read [STORAGE.md](./STORAGE.md) before pointing
  an older tag at a newer database.

---

## ✅ Deploy Verification

```bash
curl -s http://localhost:32060/api/health                       # → {"ok":true}
docker inspect --format '{{.State.Health.Status}}' vela         # → healthy
docker compose ps                                               # STATUS shows (healthy)
docker logs -f vela        # plain docker; or: docker compose logs -f vela-gateway
docker exec vela ls -la /app/data/db                            # data.sqlite + backups/
curl -s -H "Authorization: Bearer <key>" http://localhost:32060/v1/models | head
vela doctor                                                     # npm CLI berth
```

A `starting` health status that never becomes `healthy` is almost always the data
directory or a refused MariaDB boot — both loud in the logs.
[TROUBLESHOOTING.md](./TROUBLESHOOTING.md) carries symptom → cause → fix.

---

## 🔗 See Also

- [DOCKER.md](../DOCKER.md) — the container chart: image internals, volumes, local builds
- [docs/ENVIRONMENT.md](./ENVIRONMENT.md) — every environment variable and its default
- [docs/STORAGE.md](./STORAGE.md) — the Storage Covenant, the mirror, backups and restore
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md) — the request's voyage through the ship
- [docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — symptom, cause, fix
- [docs/API.md](./API.md) — the gateway surface and the dashboard REST
- [docs/VERSIONING.md](./VERSIONING.md) — the release rite that produces the tags you pin
- [docker-compose.example.yml](../docker-compose.example.yml) — the template chart

— *Vela · The Sail of the Ship* ⛵
