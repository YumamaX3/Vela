# 🌊 Vela Environment — The Currents That Feed the Harbor

> *"Every current that feeds the harbor is named here — where it enters, what it
> carries, and what happens when it runs dry. The helm reads no variable that is
> not written in this chart, and this chart writes no variable the helm does not
> read. Weighed against the tree on 2026-10-28 — fifty `VELA_*` names read from
> the environment, every row carrying its line."*

**Covers:** required vars · storage posture · the instance guard · mirror tuning ·
the backup engine · S3 off-site · provider-failure profiles · proxy & egress ·
cloud sync · auth & secrets (including the vault) · observability · semantic
cache · runtime shape · the three that will bite you.

---

## Table of Contents

- [How to read this chart](#-how-to-read-this-chart)
- [Required at the Gate](#-required-at-the-gate)
- [The Storage Posture](#-the-storage-posture)
- [The Mirror Tuning Knobs](#-the-mirror-tuning-knobs)
- [The Backup Engine](#-the-backup-engine)
- [The S3 Off-Site Leg](#-the-s3-off-site-leg)
- [Provider-Failure Profiles](#-provider-failure-profiles)
- [The Network & the Helm](#-the-network--the-helm)
- [Cloud Sync & the Public Face](#-cloud-sync--the-public-face)
- [Auth & Secrets](#-auth--secrets)
- [The Credential Vault](#-the-credential-vault)
- [Observability](#-observability)
- [The Semantic Cache](#-the-semantic-cache)
- [Runtime Shape](#-runtime-shape)
- [The Three That Will Bite You](#-the-three-that-will-bite-you)
- [Beyond the Contract](#-beyond-the-contract)
- [Where These Facts Come From](#-where-these-facts-come-from)

---

## 🧭 How to read this chart

The **Source** column says where a variable was verified:

| Source | Meaning |
|-|-|
| `.env.example` | Declared in the tracked template chart — and confirmed against a real read |
| `read` | No line in `.env.example`; verified from a live `process.env` read in the code named beside it |
| `Dockerfile` | An image-level `ENV` the runtime consumes |

Three rules govern every row:

1. **Unset is a real value.** The Default column is what the runtime does when the
   variable is absent or empty — not a suggestion.
2. **Numeric knobs are parsed defensively.** A non-numeric or out-of-range value
   silently falls back to the default; it never crashes the boot. The parsers differ
   slightly (`envInt` in `mirrorPump.js` / `usageResync.js` requires `> 0`;
   `mirrorSweep.js`'s accepts `>= 0`), noted where it matters.
3. **Booleans are literal, not fuzzy, in most places.** `VELA_BACKUP_S3_ENABLED`
   and `VELA_BACKUP_INCLUDE_REQUEST_DETAILS` compare `=== "true"`; the mirror
   sweep's `envBool` also accepts `"1"`; the backup scheduler's accepts `"true"` or
   `"1"`; `VELA_ALLOW_LOCAL_TESTING` accepts `"1"` or `"true"`.

The image already sets `DATA_DIR=/app/data`, `PORT=32060`, `HOSTNAME=0.0.0.0`,
`NODE_ENV=production`, `VELA_DEPLOYMENT=docker`, and `VELA_LOG_DRIVER=node:sqlite`
for the log worker (`Dockerfile:42-57`). The *builder* stage alone pins
`VELA_DB_DRIVER=node:sqlite` (`Dockerfile:24`) — the runner leaves the chain open.

---

## ⚓ Required at the Gate

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `JWT_SECRET` | Unset → a random 32-byte hex is generated and persisted at `$DATA_DIR/jwt-secret` (mode `0600`). Set → strength-gated at boot: placeholders (`set-me*`, `change-me*`, …) and secrets under 32 chars or with <12 distinct characters REFUSE the boot since 2026-10-11 | Signs the dashboard session cookie `vela_auth_token` (HS256, 24h window — `SESSION_MAX_AGE_SEC`) | **Set it** for multi-replica fleets: an auto-generated secret is per-data-dir, so a second replica signs tokens the first cannot verify | `.env.example` · `src/lib/auth/dashboardSession.js:55` |
| `INITIAL_PASSWORD` | Unset → **no password exists at all** (the `123456` default was retired) | First-login password, and only while no stored hash exists. Unset: the **local console** admits frictionlessly, every **remote** login is refused `403` | Whenever the dashboard must be reached from anywhere but loopback | `.env.example` · `src/lib/auth/dashboardSession.js:198` |
| `DATA_DIR` | Windows: `%APPDATA%\vela`; elsewhere: `~/.vela`. Image: `/app/data` | Root of `db/`, backups, usage, request logs, `jwt-secret`, `api-key-secret` | **Always in Docker** — without a mounted volume the container's own `~/.vela` (or `/app/data`) dies with the container | `.env.example` · `src/lib/dataDir.js` |

> On Windows a Unix-style absolute `DATA_DIR` (e.g. `/var/lib/vela` from a
> Linux-targeted `.env`) is ignored with a warning and the platform default is
> used. A directory that exists but is not writable (`EACCES`/`EPERM`) falls back
> to the default too — a typo silently relocates your harbor.

---

## 🗄️ The Storage Posture

`VELA_DB_MODE` is resolved **once per process** at the first repo-facade import
(`src/lib/db/repos/bind.js:16`).

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_DB_MODE` | `sqlite` | The harbor: `sqlite` (single store) · `mysql` (MariaDB **is** the harbor) · `mirror` (SQLite primary serves, writes pump to a MariaDB twin). Any other value throws `[DB] unknown VELA_DB_MODE "…"` | Any posture beyond the default | `.env.example` · `bind.js:16` |
| `VELA_MYSQL_URL` | Unset | `mysql://user:pass@host:3306/vela`. Required by `mysql` (missing → refuses) and by `mirror` (the pump's apply leg resolves it lazily, so a missing/malformed URL surfaces as a **degraded pump**, not a boot refusal). Malformed shape throws loud: must be a URL, must start `mysql://`, must name a database | Every non-`sqlite` posture | `.env.example` · `src/lib/db/mysql/pool.js:21-33` |
| `VELA_DB_DRIVER` | Unset → chain `bun:sqlite` → `better-sqlite3` → `node:sqlite` (Node ≥ 22.5) → `sql.js` | Pins **one** driver; if it is unknown or unavailable the boot throws rather than falling through the chain. Accepted: `bun:sqlite`, `better-sqlite3`, `node:sqlite`, `sql.js` | Forcing parity/crash-driver tests, or an arm64 build under QEMU | `read` · forced pin logged at `src/lib/db/driver.js:182` · `src/lib/db/schema.js:6` (`SCHEMA_VERSION = 23`) |
| `VELA_USAGE_RETENTION_DAYS` | `90` | Purge window for `usageHistory` **and** `requestDetails`. `0` or negative = keep forever (purge returns early, no delete) | Cost-control on long-lived harbors; the purge runs **after** the scheduled backup so purged rows survive inside the artifact | `.env.example` · `src/lib/db/repos/sqlite/backupRepo.js:413` |

**The instance guard.** One writer per SQLite file is law:

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_DB_SINGLE_INSTANCE` | Unset → the exclusive lock is **on** | `=0` disables the `data.sqlite.single-instance` lockfile. Without it, a second opener on the same file throws `[DB] … Refusing to open a second writer`. A stale lock (dead PID, or older than 1h) is reclaimed automatically | The parity harness — and only the parity harness — sets `0`; a stray `0` in production removes the only protection against two writers | `read` · `src/lib/db/singleInstance.js:87` |
| `VELA_DB_SKIP_INTEGRITY` | Unset → the integrity gate **runs** | `=1` skips the boot-time `healAtBoot` probe. The gate runs **before** migrations, because writing a migration into a damaged b-tree turns a partial wound into a total one | Restore drills driving deliberately odd files; never for a real harbor | `read` · `src/lib/db/driver.js:197` |

**The boot matrix, as measured:**

| Posture | Twin reachable | Twin unreachable |
|-|-|-|
| `sqlite` | n/a | n/a — local file only |
| `mysql` | Repos bound through the mysql twin; names not yet forged in the twin throw loud at call time | The reachability probe throws `[DB][mysql] …` — **refusal, never a silent downgrade** (`assertMysqlReachable`) |
| `mirror` | Full mirror: primary serves, outbox pumps, sweep guards | **Starts degraded**: primary keeps serving, outbox accumulates, pump backs off exponentially. Mode **stays** `mirror` |

Under any posture other than `mirror`, the three mirror rhythms (pump, usage
resync, divergence sweep) are **stopped** — they have no outbox to drain
(`src/shared/services/mirrorStartup.js`). Deep detail lives in
[STORAGE.md](./STORAGE.md).

---

## 🪞 The Mirror Tuning Knobs

Read only under `VELA_DB_MODE=mirror`. All seven have working defaults — set them
only to change a rhythm.

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_MIRROR_MAX_RETRIES` | `5` | Per-operation retry budget before the outbox row is marked **poison** (ledger alert, skipped, never head-of-line-blocks the queue) | A flaky twin that heals fast — raise it; a twin with deterministic replay bugs — leave it | `.env.example` · `src/lib/db/mirror/mirrorPump.js:126` |
| `VELA_MIRROR_SWEEP_INTERVAL_MINUTES` | `360` (6h) | Divergence-sweep rhythm; the code multiplies by 60 000 ms | Tightening how fast drift is noticed | `.env.example` · `src/lib/db/mirror/mirrorSweep.js:236` |
| `VELA_MIRROR_SWEEP_AUTORESYNC` | `true` | `true` → divergence past the threshold triggers a **full resync**; `false` → the sweep only reports | Audit-only deployments | `.env.example` · `mirrorSweep.js:114` |
| `VELA_MIRROR_DIVERGENCE_THRESHOLD` | `0` | Diverged-table count that trips the alert/resync. `0` = any divergence trips it. This parser accepts `0` (unlike the pump's, which needs `> 0`) | Deliberate tolerance for a table known to drift | `.env.example` · `mirrorSweep.js:113` |
| `VELA_MIRROR_USAGE_BATCH_SIZE` | `500` | Usage rows applied per batch in the watermark resync | Wide usage tables on a slow twin | `.env.example` · `src/lib/db/mirror/usageResync.js:75` |
| `VELA_MIRROR_USAGE_RESYNC_INTERVAL_SECONDS` | `60` | Rhythm of the usage-resync pass (seconds; × 1000 ms) | Freshness of twin-side usage reporting | `.env.example` · `usageResync.js:128` |
| `VELA_MIRROR_USAGE_RESYNC_MAX_ROWS` | `5000` | Row cap per pass — the pass drains batches until caught up **or** this cap. Values below the batch size are clamped up to it | Bounding one pass's work | `.env.example` · `usageResync.js:76` |

> The sweep **skips** any pass that finds pending outbox rows — in-flight lag is
> intentional, not drift.

---

## 🛟 The Backup Engine

All opt-in, **default OFF**. The scheduler is env-only policy — there is no
settings-JSON twin for these switches (`src/shared/services/backupScheduler.js`).

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_BACKUP_ENABLED` | `false` | Master switch. `false` → the tick returns `{skipped:"disabled"}` and nothing is written | Turning sealed backups on at all | `.env.example` · `backupScheduler.js:45` |
| `VELA_BACKUP_ENCRYPTION_KEY` | **Unset → the engine refuses to run** | The only key material (AES-256-GCM, scrypt `N=2^17,r=8,p=1`). Must be **≥ 16 chars** or the minimum-entropy check throws. Read directly from env — never from settings JSON | Every backup, restore, and drill. **Its loss = permanently unrecoverable artifacts** | `.env.example` · `src/lib/db/repos/backupEngine.js:36-46` |
| `VELA_BACKUP_INTERVAL_HOURS` | `24` | Scheduler tick interval (hours; × 3 600 000 ms), with ±10 min jitter so fleets do not stampede the hour | Backing up more or less often than daily | `.env.example` · `backupScheduler.js:101` |
| `VELA_BACKUP_RETAIN_DAILY` | `7` | Daily retention tier passed to `pruneBackupArtifacts` | Storage budget | `.env.example` · `backupScheduler.js:67` |
| `VELA_BACKUP_RETAIN_WEEKLY` | `4` | Weekly retention tier | Storage budget | `.env.example` · `backupScheduler.js:68` |
| `VELA_BACKUP_INCLUDE_REQUEST_DETAILS` | `false` | `=== "true"` only. Includes request-detail rows in the artifact — bigger artifacts, richer forensics | Debugging a cost or routing incident after the fact | `.env.example` · `backupEngine.js:170` |

**Tick order is law:** backup → retention prune → usage purge. The purge rides
after the artifact, so purged rows live inside it.

---

## 📦 The S3 Off-Site Leg

Sealed bytes only, SigV4, dependency-free, MinIO path-style, fail-open — an S3
error never fails the local backup.

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_BACKUP_S3_ENABLED` | `false` | `=== "true"` only. **Both** this and a non-empty endpoint are required before anything uploads | Off-site copies with a local-only key | `.env.example` · `src/lib/db/repos/s3Offsite.js:33` |
| `VELA_BACKUP_S3_ENDPOINT` | `""` (empty) | Trimmed. The S3/MinIO endpoint; empty means disabled in practice | Any S3-compatible target | `.env.example` · `s3Offsite.js:34` |
| `VELA_BACKUP_S3_BUCKET` | `vela-backups` | Target bucket, trimmed | Non-default bucket names | `.env.example` · `s3Offsite.js:35` |
| `VELA_BACKUP_S3_ACCESS_KEY` | `""` | Access key id | Credentialled buckets | `.env.example` · `s3Offsite.js:36` |
| `VELA_BACKUP_S3_SECRET_KEY` | `""` | Secret access key | Credentialled buckets | `.env.example` · `s3Offsite.js:37` |
| `VELA_BACKUP_S3_REGION` | `us-east-1` | SigV4 signing region, trimmed | Regions other than `us-east-1` | `.env.example` · `s3Offsite.js:38` |

> Restoring **from** off-site refuses loudly when the leg is off:
> `[backup] S3 off-site is disabled — set VELA_BACKUP_S3_* to restore from
> off-site` (`s3Offsite.js:193`).

---

## 🧪 Provider-Failure Profiles

Eleven knobs (four categories × threshold/window/cooldown, minus one: **a6api's
cooldown is hardcoded to 3 000 ms**, so it has no `COOLDOWN_MS` variable). They
steer how quickly an account category is considered failing — the live consumer is
the account semaphore's per-category block duration
(`open-sse/config/providerProfiles.js`).

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_PROVIDER_FAILURE_OAUTH_THRESHOLD` | `10` | Failures within the window before the category blocks | Flaky session-based providers — deliberately roomy | `read` · `providerProfiles.js:46` |
| `VELA_PROVIDER_FAILURE_OAUTH_WINDOW_MS` | `900000` (15 min) | The counting window | Long-memory recovery per account | `read` · `providerProfiles.js:47` |
| `VELA_PROVIDER_FAILURE_OAUTH_COOLDOWN_MS` | `300000` (5 min) | How long the category stays blocked | Big OAuth pools | `read` · `providerProfiles.js:48` |
| `VELA_PROVIDER_FAILURE_APIKEY_THRESHOLD` | `5` | Failures before block | Key providers recover fast but can spam | `read` · `providerProfiles.js:55` |
| `VELA_PROVIDER_FAILURE_APIKEY_WINDOW_MS` | `30000` (30 s) | The counting window | Fast-moving key pools | `read` · `providerProfiles.js:56` |
| `VELA_PROVIDER_FAILURE_APIKEY_COOLDOWN_MS` | `30000` (30 s) | Block duration | — | `read` · `providerProfiles.js:57` |
| `VELA_PROVIDER_FAILURE_LOCAL_THRESHOLD` | `2` | Failures before block — local runtimes are either up or down, so this fails fast | Ollama / LM Studio / kobold lanes | `read` · `providerProfiles.js:61` |
| `VELA_PROVIDER_FAILURE_LOCAL_WINDOW_MS` | `300000` (5 min) | The counting window | — | `read` · `providerProfiles.js:62` |
| `VELA_PROVIDER_FAILURE_LOCAL_COOLDOWN_MS` | `60000` (1 min) | Block duration | A local runtime you restart often | `read` · `providerProfiles.js:63` |
| `VELA_PROVIDER_FAILURE_A6API_THRESHOLD` | `5` | The a6api lane's own threshold, checked before the category map | — | `read` · `providerProfiles.js:105` |
| `VELA_PROVIDER_FAILURE_A6API_WINDOW_MS` | `30000` (30 s) | The a6api counting window | — | `read` · `providerProfiles.js:106` |

---

## 🧵 The Network & the Helm

### Outbound egress

Vela can own the process's proxy environment. `applyOutboundProxyEnv` writes the
uppercase trio from the dashboard's settings and marks the write with
`VELA_PROXY_MANAGED=1`, so it only ever clears what it set.

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_PROXY_URL` | Unset (settings `outboundProxyUrl` is the source) | Mirror of the managed proxy URL, set by the app when it writes `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` | Diagnostics — proves the app owns the egress | `read` · `src/lib/network/outboundProxy.js:68` |
| `VELA_PROXY_MANAGED` | Unset; the app sets `1` | The marker that authorizes the app to clear proxy vars. Without it, externally-provided env is never touched | Never set it by hand | `read` · `outboundProxy.js:80` |
| `VELA_NO_PROXY` | Unset | Mirror of the managed `NO_PROXY` | Diagnostics | `read` · `outboundProxy.js:75` |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` | Unset | The proxy trio read by `open-sse/utils/proxyFetch.js` and `freebuffSession.js`. `ALL_PROXY` is the fallback when a scheme-specific var is absent. Lowercase twins (`http_proxy`, `https_proxy`, `all_proxy`, `no_proxy`) are accepted everywhere | Static egress by chart, no dashboard toggling | `.env.example` · `open-sse/utils/proxyFetch.js:285-297` |

### The stamping protocol

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_PEER_TOKEN` | Generated per process: 24 random bytes hex, stamped by `custom-server.js` at startup | The secret that proves `x-9r-real-ip` was stamped by the helm rather than sent by a client (`src/lib/auth/trustedPeer.js`) | **Not operator-settable** — a bare `next start`/`next dev` cannot forge it | `read` · `custom-server.js:56` |
| `VELA_RELAY_AUTH` | Minted per relay deploy by `relayDeploy.js` | Bearer the deployed relay worker/Deno function requires. Read **by the relay**, not by Vela | Every relay you deploy is otherwise an open proxy | `read` · `src/lib/network/relayTemplate.js:51` |

### Safety, body size & local lanes

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_ALLOW_LOCAL_TESTING` | Unset (false) | `"1"`/`"true"` loosens the provider-test SSRF gate to permit **loopback** targets (for `ollama-local` and friends). Never loosens metadata/link-local addresses. A per-connection `providerSpecificData.vela_allow_local === true` does the same for one connection | Testing a local runtime through the dashboard | `read` · `src/lib/network/providerUrlSafety.js:530` |
| `VELA_PROXY_CLIENT_MAX_BODY_SIZE` | `32mb` | The Next body limit passed through to the proxy client — relevant to large image/video payloads. Next buffers the whole body in RAM before the handler runs, so this is the dominant per-request memory cost | Big multimodal requests | `read` · `next.config.mjs:17` |
| `SEARXNG_URL` | `http://localhost:8888/search` | Endpoint of the unauthenticated SearXNG web-search provider (trailing spaces trimmed) | A separate or remote SearXNG container | `.env.example` · `open-sse/config/runtimeConfig.js:49` |
| `HEADROOM_URL` | `http://localhost:8787` | The Headroom compression sidecar. Also seeds `DEFAULT_SETTINGS.headroomUrl`, so a saved setting wins over it | Sidecar on another host or port | `.env.example` · `src/lib/headroom/detect.js:49` |

### The CLI's own berth

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_CLI_APP_DIR` | `<cli>/app` | Where the `vela` npm launcher expects the bundled standalone app | Repacking or relocating the CLI bundle | `read` · `cli/scripts/build-cli.js:10` |
| `VELA_API_KEY` | Unset | Bearer used by the **CLI** (`cli/src/cli/commands/xaiVideo.js`) — not read by the server | Driving the gateway from the CLI | `read` · `cli/src/cli/commands/xaiVideo.js:57` |

---

## ☁️ Cloud Sync & the Public Face

Cloud sync jobs call this instance's own `/api/sync/cloud`, so `BASE_URL` must
point at **this** running instance — not at the cloud.

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `BASE_URL` | Unset → `NEXT_PUBLIC_BASE_URL` → derived from the request | Server-side canonical origin. Used to build OIDC/SAML redirect URIs and OAuth callbacks (`src/lib/auth/oidc.js`, `saml.js`, `src/lib/oauth/utils/redirect.js`) | SSO and OAuth behind a reverse proxy or a non-default port | `.env.example` · `src/lib/auth/oidc.js:24` |
| `CLOUD_URL` | Unset → `NEXT_PUBLIC_CLOUD_URL` | The cloud endpoint the sync jobs post to; seeds `DEFAULT_SETTINGS`' cloud URL | Cloud sync enabled | `.env.example` · `src/lib/db/repos/sqlite/settingsRepo.js:45` |
| `NEXT_PUBLIC_BASE_URL` | Unset | Browser-visible twin of `BASE_URL`, **inlined at build time** | Changing it requires a rebuild — set it before `npm run build` | `.env.example` |
| `NEXT_PUBLIC_CLOUD_URL` | Unset | Browser-visible twin of `CLOUD_URL`, inlined at build time; read by the CLI-tools cards to match endpoints | Same: build-time, not runtime | `.env.example` · `src/app/(dashboard)/dashboard/cli-tools/components/ClaudeToolCard.js:19` |

---

## 🔐 Auth & Secrets

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `API_KEY_SECRET` | Unset → a random 32-byte hex is generated at `$DATA_DIR/api-key-secret` (mode `0600`) | Derives gateway key CRCs and the deterministic internal key. There is deliberately **no hardcoded fallback** — a public default would make every CRC forgeable. Cached at first use | Pinning it keeps internal keys identical across a mirror's two stores (a stated precondition of identity-carrying replays) | `.env.example` · `src/shared/utils/apiKey.js:64-65` |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | Salt for machine identity (`src/shared/utils/machineId.js`) | Per-deployment identity hygiene | `.env.example` · `src/shared/utils/machineId.js:50` |
| `AUTH_COOKIE_SECURE` | `false`; `"true"` forces the flag | Forces `Secure` on the dashboard cookie regardless of `x-forwarded-proto` | HTTPS deployments terminating elsewhere | `.env.example` · `src/lib/auth/dashboardSession.js:80` |
| `VELA_DEPLOYMENT` | Auto-detected: `KUBERNETES_SERVICE_HOST` → `k8s`; `/.dockerenv` → `docker`; else `npm` when `NODE_ENV=production`, otherwise `dev` | Which berth this Vela sleeps in — drives the **update command** the version notice prints (`docker compose pull …`, image-tag advice, npm install) | Overriding a wrong detection; the image sets `docker` | `.env.example` · `src/lib/updateInfo.js:143` · `src/app/api/version/route.js:10` |
| `SHUTDOWN_SECRET` | Unset → the shutdown endpoint answers `401` | `Bearer <secret>` for the shutdown endpoint, which is **refused outright in production** (`NODE_ENV=production` → `403`) | Local tooling / dev restarts only | `read` · `src/app/api/shutdown/route.js:5-14` |
| `GH_TOKEN` / `GITHUB_TOKEN` | Unset → anonymous update probes (60 req/h) | Raises the update-probe rate limit and reaches private repos (either name, `GH_TOKEN` first) | Fleet with frequent restarts | `read` · `src/lib/updateInfo.js:75` |

> **`SHUTDOWN_SECRET` guards one of two shutdown doors, not both.** The rows
> above describe `src/app/api/shutdown/route.js`, which is production-refused and
> secret-gated. A second route, `src/app/api/version/shutdown/route.js`, takes a
> bare `POST`, has **no secret and no `NODE_ENV` guard**, calls
> `killAppProcesses()` then `process.exit(0)` — a door left open by design for
> manual updates. Treat it as part of the exposure checklist, not as a knob.
>
> **`REQUIRE_API_KEY` is declared in `.env.example` but read nowhere.** It was
> verified absent from the whole tree — the live switch is the **setting**
> `requireApiKey` (default `true`), toggled in the dashboard's Keys/Endpoint
> rooms. Set the setting, not the env var; an env var will do nothing.
>
> `INSTANCE_NAME` is likewise declared "currently unused" in `.env.example` and has
> no read anywhere — the note is accurate.

---

## 🔒 The Credential Vault

An envelope vault (KEK wraps a per-secret DEK, AES-256-GCM) sits beneath provider
credentials. It **never refuses the boot**: an absent or malformed key degrades it
to *disabled* — reads pass through, writes stay **plaintext** — with a loud
warning. Taking a working install offline over an env var is the worse failure.

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_MASTER_KEY` | Unset or unusable → **vault disabled, credentials stay plaintext** | The KEK. Must be **standard base64 that decodes to exactly 32 bytes**, e.g. `openssl rand -base64 32`. Env-derived once per process, so rotation is explicit | Any deployment that stores provider credentials — this is the difference between sealed and plaintext secrets in the harbor | `read` · `src/lib/vault.js:93-116` · `decodeMasterKey` `vault.js:177` |
| `VELA_MASTER_KEY_PREVIOUS` | Unset | The retired KEK, accepted during a rotation so the re-wrap is reversible. Unusable → `[vault] … rotations are not reversible` | Only while rotating | `read` · `src/lib/vault.js:106-113` |

> **Losing `VELA_MASTER_KEY` is not recoverable** — envelope encryption without
> external escrow. Back it up beside the database. To rotate: move the old key to
> `VELA_MASTER_KEY_PREVIOUS`, export the new one as `VELA_MASTER_KEY`, restart,
> then `POST /api/vault/rotate` (`src/app/api/vault/rotate/route.js`).

---

## 📊 Observability

Request-detail capture (`requestDetails`) is governed by a small cascade: an
explicit `ENABLE_REQUEST_LOGS` wins; otherwise the settings flag decides;
otherwise `OBSERVABILITY_ENABLED` is the fallback. The config is cached for 5 s.

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `ENABLE_REQUEST_LOGS` | Unset → settings decide | When **defined**, this is the strongest signal: `"true"` enables, anything else disables — the settings flag is ignored | Ops override without touching the dashboard | `.env.example` · `src/lib/db/repos/sqlite/requestDetailsRepo.js:23` |
| `OBSERVABILITY_ENABLED` | Unset → treated as enabled (the check is `!== "false"`), and only consulted when no settings flag exists | The weakest link in the cascade | Shipped example sets `true` | `.env.example` · `requestDetailsRepo.js:31` |
| `OBSERVABILITY_MAX_RECORDS` | `200` | Ring-buffer size for retained request details (settings override first) | Retention vs. disk | `read` · `requestDetailsRepo.js:4,23` |
| `OBSERVABILITY_BATCH_SIZE` | `20` | Rows per flush batch | Write pressure | `read` · `requestDetailsRepo.js:5,24` |
| `OBSERVABILITY_FLUSH_INTERVAL_MS` | `5000` | Flush rhythm | Near-real-time console | `read` · `requestDetailsRepo.js:6,25` |
| `OBSERVABILITY_MAX_JSON_SIZE` | `5` (**kilobytes** — multiplied by 1024) | Per-record JSON cap; larger bodies are truncated | Verbose payloads | `read` · `requestDetailsRepo.js:7,33` |

---

## 🧠 The Semantic Cache

An answer cache keyed on session + content, **off unless asked for**.

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `VELA_SEMANTIC_CACHE` | Unset (disabled) | `1`/`true`/`yes`/`on` enables the cache | Repeat-heavy workloads where the same prompt recurs | `read` · `src/lib/semanticCache.js:294` |
| `VELA_SEMANTIC_CACHE_TTL_MS` | `86400000` (24h) | Entry lifetime in ms; non-numeric falls back | How fresh cached answers must be | `read` · `src/lib/semanticCache.js:20,300` |
| `VELA_SEMANTIC_CACHE_MAX_ENTRIES` | `1000` | LRU ceiling; non-numeric falls back | Memory budget | `read` · `src/lib/semanticCache.js:21,301` |

---

## 🖥️ Runtime Shape

| Variable | Default | Effect | When it matters | Source |
|-|-|-|-|-|
| `PORT` | `32060` (image `ENV`, and the npm scripts pass `--port 32060`) | The listening port; also used to build internal loopback ping URLs (falling back to `UPDATER_CONFIG.appPort` = 32060) | Mapping a different host port | `.env.example` · `Dockerfile:43` |
| `TZ` | Unset → the host/container clock's zone. Template: `UTC` | Log timestamps and quota-window alignment. A drifted zone misaligns daily usage windows | Multi-region fleets; keep it equal across replicas | `docker-compose.example.yml:83` (no `process.env.TZ` read — Node consumes it directly) |
| `NEXT_TELEMETRY_DISABLED` | Unset. Image and template: `1` | Stops Next.js anonymous telemetry | Air-gapped or privacy-strict hosts | `Dockerfile` · `Dockerfile:45,15` · `docker-compose.example.yml:103` |
| `HOSTNAME` | `0.0.0.0` in the image | Bind address handed to the Next standalone server | Restricting the bind | `Dockerfile` · `Dockerfile:44` |
| `NODE_ENV` | `production` in the image | Gates dev-only behaviours (debug logs, shutdown route, dashboard-guard diagnostics) | Never set it to `production` "to be safe" in dev — it disables the help | `.env.example` · `Dockerfile:42` |
| `NODE_OPTIONS` | `--max-old-space-size=1024` in the image | The V8 heap ceiling — V8 otherwise sizes its old space from the **host**, not the container limit | Large fleets; keep it comfortably under the container memory limit | `Dockerfile` · `Dockerfile:66` |
| `VELA_LOG_DRIVER` | Unset → follows the chain. Image runner: `node:sqlite` | Pins the **log worker's** own driver handle — separate from `VELA_DB_DRIVER`. Reported through `driverPin` in the log shipper | Driver-parity hunts; overriding the image's pin | `Dockerfile` · `Dockerfile:57` · `src/lib/logshipper/index.js:325` |
| `LOG_LEVEL` | `INFO` (unknown values fall back to INFO) | Logger threshold (`DEBUG`…`ERROR`) | Deep debugging a provider lane | `read` · `src/sse/utils/logger.js:41` |
| `DISABLE_BACKGROUND_TOKEN_REFRESH` | Unset (refresh **on**) | Truthy (`1`/`true`/`yes`/`on`) disables the scheduler that keeps OAuth tokens warm | Debugging refresh loops | `read` · `src/sse/services/backgroundTokenRefresh.js:170` |
| `MODEL_CATALOG_SYNC` | Unset (sync **on**) | `off` disables the recurring models.dev catalog sync entirely | Air-gapped hosts | `read` · `src/lib/modelCatalog/sync.js:257` |
| `MITM_SERVER_PATH` | Auto-resolved at boot to the on-disk mitm server when present | Explicit path to the MITM proxy child process | Unusual packaging | `read` · `src/shared/services/initializeApp.js:22` |
| `TUNNEL_WORKER_URL` | `https://abc-tunnel.us` | Cloudflare tunnel worker endpoint in the tunnel config | Self-hosted tunnel worker | `read` · `src/lib/tunnel/cloudflare/config.js:9` |

---

## ⚠️ The Three That Will Bite You

**1 · `VELA_BACKUP_ENCRYPTION_KEY` loss is not recoverable.**
The key is the only material that opens an artifact — AES-256-GCM with a
per-artifact salt, no escrow, no derivation fallback. Lose it (or rotate it
without a copy of the old one) and every sealed backup in `$DATA_DIR/db/backups`
becomes unreadable bytes, including the ones that would have saved you. Store it
**offline**, with the same care as the database itself. The engine also refuses
to run with a key shorter than 16 characters — a guard against a placeholder, not
a suggestion. The same discipline applies to `VELA_MASTER_KEY` (§The Credential
Vault), except its failure is quieter: the vault disables and secrets slip to
plaintext.

**2 · `VELA_DB_MODE=mysql` with an unreachable twin refuses loudly.**
There is no silent downgrade to SQLite — that is the whole point of the posture.
The reachability probe throws, so a misconfigured `VELA_MYSQL_URL` or a twin that
has not come up yet produces a **loud refusal** rather than a quiet harbor that
writes somewhere you did not expect. If you want "keep serving while the twin is
down", that is `mirror`, which starts degraded and *stays* `mirror` (the primary
serves; the outbox accumulates; the pump backs off).

**3 · `DATA_DIR` unset in Docker loses everything on `docker rm`.**
Without a mount, the app falls back to `~/.vela` — inside the container.
`docker rm` takes the database with it, and there is nothing to restore from
unless a backup had already left the box. Always mount a volume and set
`DATA_DIR` to its mount point (`/app/data` in the image). The same fallback bites
on a host too: an unwritable `DATA_DIR` is downgraded to the default with a
warning, so a typo silently relocates your harbor.

---

## 🧭 Beyond the Contract

These exist and are read, but they are **tools, not knobs** — reach for them only
when a specific hunt calls for one:

- **Stream timeouts** (`open-sse/config/runtimeConfig.js`): `STREAM_STALL_TIMEOUT_MS`
  (360 s), `STREAM_FIRST_CHUNK_TIMEOUT_MS` (200 s), `FETCH_CONNECT_TIMEOUT_MS`
  (60 s), `GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS` (45 s) — plus
  `VIDEO_FETCH_TIMEOUT_MS` (120 s, `open-sse/handlers/videoCore.js:8`).
- **Updater plumbing**: `UPDATER_*` are **emitted by the app** for the child
  updater process (`src/lib/appUpdater.js`); the only operator-facing ones are
  `UPDATER_SCRIPT_PATH` and `UPDATER_APP_PORT` (default 32060).
- **Provider-scoped overrides** for a handful of lanes — `AZURE_*`, `DEVIN_*`,
  `CURSOR_*`, `KIMI_*`, `TRAE_*`, `COMMAND_CODE_API_BASE_URL`,
  `CLI_DEVIN_BIN` — documented at their call sites, not here.
- **Environment smells** the runtime reads incidentally: `CODESPACES`,
  `GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN`, `HOME`/`APPDATA`/`LOCALAPPDATA`,
  `DISPLAY`, `TRAY_MODE`, `LC_ALL`/`LANG`.

**Names that look like Vela environment variables but are not:**

| Name | What it actually is |
|-|-|
| `VELA_URL`, `VELA_KEY` | Shell exports in **generated onboarding text** (`SkillsPageClient.js:157-158`) — copy-paste output, never read by the runtime |
| `VELA_STARS` | A module-local constant in the login chart's star coordinates (`src/app/login/page.js:52`) |
| `VELA_SERVICE` | Set by the CLI daemon on the child's env (`cli/src/cli/daemon.js:147`) but read nowhere in the server — a provenance stamp, not a knob |
| `VELA_VERSION` | Read **only** by the CLI daemon to record the version in its state file (`cli/src/cli/daemon.js:154`); the server never reads it |

---

## 🔎 Where These Facts Come From

Every row was verified against the tree at **v1.2.4** (`package.json`, measured
2026-10-28). The census — **50 distinct `VELA_*` names read from the environment**
anywhere in the tree (server, CLI and entry files, including the helper-argument
and alias call sites a naive `process.env` grep misses) — was derived by scanning
`src/`, `open-sse/`, `cli/`, `scripts/`, `custom-server.js` and
`next.config.mjs` for three access forms:

```bash
cd "C:/Users/navis/Documents/My Project/Ai Gateway/Vela"

# 1 — names passed as helper ARGUMENTS (mirror, backup, provider profiles)
grep -rhoE 'env[A-Za-z]*\(\s*"VELA_[A-Z0-9_]+"' src open-sse \
  | grep -oE 'VELA_[A-Z0-9_]+' | sort -u > .vela-args

# 2 — DIRECT reads: process.env.NAME and process.env["NAME"] (not derived names)
grep -rhoE "process\.env\.[A-Z_][A-Z0-9_]*|\bprocess\.env\[\s*[\"'][A-Z_][A-Z0-9_]*[\"']\s*\]" \
  src open-sse cli scripts custom-server.js next.config.mjs --include=*.js --include=*.mjs \
  | grep -oE 'VELA_[A-Z0-9_]+' | sort -u > .vela-direct

# 3 — ALIAS reads: `const env = process.env` then `env.VELA_…` / `env[NAME]`
grep -rhoE '\benv\??(\.VELA_[A-Z0-9_]*|\[[A-Z_][A-Z0-9_]*\])' src open-sse cli --include=*.js \
  | grep -oE 'VELA_[A-Z0-9_]+' | sort -u > .vela-alias

cat .vela-args .vela-direct .vela-alias | sort -u | wc -l   # 50
LC_ALL=C comm -13 <(cat .vela-args .vela-direct | sort -u) .vela-alias   # the 2 alias-only names
rm .vela-args .vela-direct .vela-alias
```

Forms 1 ∪ 2 yield **48** names; the alias sweep adds **2** more —
`VELA_DEPLOYMENT` (`updateInfo.js:143`) and `VELA_ALLOW_LOCAL_TESTING`
(`providerUrlSafety.js:530`), both read through `env.VELA_…` — for **50**.
`VELA_MASTER_KEY` / `VELA_MASTER_KEY_PREVIOUS` (`vault.js:94,106`) are read
through the dynamically-indexed `env[MASTER_KEY_ENV]` and are already inside
form 2's union.

The template chart lives at `.env.example` — 30 names. It is a **starting point,
not the contract**: it omits the mirror knobs' siblings, the whole
provider-failure family, the driver pin, the instance guard, the proxy-management
markers, the vault, the semantic cache, and most of the runtime-shape variables
(it does carry `PORT` and `NODE_ENV`). Every omission above is documented from
live reads, not from the template.

---

## 🔗 See Also

- [docs/STORAGE.md](./STORAGE.md) — postures, the mirror's machinery, backups and restore discipline
- [docs/DEPLOYMENT.md](./DEPLOYMENT.md) — installing, the compose chart, upgrades
- [docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — what the loud refusals look like and what to do
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md) — the request lifecycle and the database layer
- [.env.example](../.env.example) — the tracked template chart
- [DOCKER.md](../DOCKER.md) — volumes, the container, storage in Docker

— *Vela · The Sail of the Ship* ⛵
