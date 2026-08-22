# ⛵ Vela — The AI Gateway

> *Every harbor needs a chart. These are the Shores' navigational papers — where the currents run, which rocks to mind, how the fleet sails. Read them before you touch the helm.* 🪞💜

**Vela** (v0.9.21) — a local AI routing gateway + dashboard. One OpenAI-compatible endpoint (`/v1`) routing traffic across **143 upstream providers** — format translation, model-combo fallback (with operator fallback rules), multi-account fallback, OAuth credential management, token refresh, quota tracking, per-key ACL, and prompt injectors.

- **Language**: Node.js + Next.js (App Router, standalone output)
- **Runtime**: Node ≥ 22.5 (node:sqlite) — Bun compatible
- **Storage**: SQLite (primary) + optional MariaDB mirror (`VELA_DB_MODE`)
- **Package**: `vela-app`, image `ghcr.io/yumamax3/vela:<tag>`

---

## 🪞 The Shorekeeper's Voice

This codebase is sailed with intent. When you work here, the voice carries:

- **The Shores' metaphor is welcome but never required** — code comments may speak of harbors and tides, but identifiers stay precise. A variable named `connections` is a list of connections, not a fleet.
- **Ship nothing that is not worth shipping** — every change must carry a written reason. If you cannot say in one line why a change exists, it does not ship.
- **The Covenant of Truth** — never fabricate. If a number, path, or behavior is uncertain, verify it against the code before asserting it. The Mirror reflects honestly or not at all.
- **The Covenant of Voice** — the dashboard speaks with one voice: warm, calm, deliberate. The coral accent (`#E56A4A`) is the single accent; warm neutrals are the ground.

---

## 🗺️ The Layout of the Shores

```
vela/
├── custom-server.js          # The helm — wraps Next standalone: IP derivation, h2c, drain
├── next.config.mjs           # Standalone output, rewrites, external packages, perf knobs
├── Dockerfile                # Multi-stage, multi-arch (amd64 + arm64), HEALTHCHECK
├── docker-compose.yml        # Live chart (gitignored — holds the Shores' secrets)
├── docker-compose.example.yml# Template chart (tracked)
├── package.json              # v0.9.21 — bump with every release
├── CHANGELOG.md              # Every minor's covenant entry
├── cli/                      # The `vela` npm CLI — bin `vela`, full purge
├── open-sse/                 # The gateway engine — providers, RTK, executors, handlers
├── src/
│   ├── app/                  # Next App Router — dashboard pages + 181 API routes
│   ├── lib/                  # The deep current — db, network, oauth, auth, updater, headroom
│   ├── sse/                  # Server-sent-event services — keyGate, budget, token refresh
│   ├── shared/               # Shared components, hooks, utils, constants
│   ├── mitm/                 # The MITM proxy child process
│   └── instrumentation.js    # Server init — outbound proxy, deferred startup
├── tests/                    # 243 unit test files (vitest)
├── scripts/                  # Migration, changelog, i18n seed, docker smoke
└── .github/workflows/        # docker-publish, cache-warm, gitbook-pages
```

---

## 🏛️ The Architecture — How the Currents Flow

### The Request Path

```
Client ──> custom-server.js (IP stamp, h2c, hop-by-hop strip)
     ──> Next.js /v1 rewrite ──> /api/v1/:path*
     ──> keyGate (per-key ACL: kinds/providers/combos/models)
     ──> budgetGate (daily/spend caps)
     ──> provider selection (combo / fallback rules / circuit breaker)
     ──> open-sse/executors (format translation per provider)
     ──> upstream provider ──> response ──> RTK savers ──> client
```

### The Two Engines

| Engine | Path | Responsibility |
|-|-|-|
| **Dashboard** | `src/app/` | The UI — 20+ pages, 181 API routes |
| **Gateway** | `open-sse/` | The proxy engine — providers, executors, RTK, handlers |

---

## 🧭 The Deep Current — `src/lib/`

### Database (`src/lib/db/`)

- **`driver.js`** — adapter resolution: `better-sqlite3` → `node:sqlite` (≥22.5) → `sql.js`. `VELA_DB_DRIVER` pins one; failure is loud.
- **`migrate.js`** — versioned migration chain + additive schema sync. `SCHEMA_VERSION = 12`, migrations `001–013`.
- **`schema.js`** — `TABLES` is the single source of truth for both harbors.
- **`repos/`** — per-entity facades bound by posture (`bind.js`): sqlite verbatim, mysql twins, mirror decorator.
- **`mirror/`** — `VELA_DB_MODE=mirror`: sqlite primary serves, outbox pump carries writes to the MariaDB twin.
- **`mysql/`** — `VELA_MYSQL_URL` harbor. **Never runs versioned migrations** — `bootstrap.js` brings the twin forward by additive diff against `TABLES` (create tables, add columns, add indexes; never drop).
- **`adapters/`** — `betterSqliteAdapter`, `nodeSqliteAdapter`, `bunSqliteAdapter`, `sqljsAdapter`.

> **⚠️ THE ADAPTER CONTRACT (learned the hard way, v0.9.20)**: the adapter interface exposes `run/get/all/exec/transaction` — **NO raw `prepare()`**. The sql.js adapter (Docker runner's fallback) and the mysql/mirror adapters have no public `.prepare`. A migration using `db.prepare(...)` crashed every DB API at boot (the 0.9.19 boot storm). **Use `db.all("PRAGMA table_info(...)")` + `db.exec(...)`** — exactly like migration 002 documents.

**Migrations** (`src/lib/db/migrations/`):
| # | Name | What it sealed |
|-|-|-|
| 001 | init | Base schema |
| 002 | apikey-governance | keyHash/keyPrefix/allowlists, tombstone + scrub, UNIQUE index |
| 003–010 | (ascension) | Budget, combos, quotas, usage enrichers |
| 011 | proxy-fitness | Circuit-breaker state |
| 012 | fallback-rules | Operator fallback rules |
| 013 | key-acl | `allowedKinds`/`allowedProviders`/`allowedCombos` (tri-state) |

### Network (`src/lib/network/`)

- **`circuitBreaker.js`** — cooldown → exhausted escalation, exponential backoff. Woven into `proxyFleet.js` pool selection.
- **`proxyFleet.js`** — the pool engine. **`poolGeo.js` + `poolEgressProbe.js`** — shared egress registry + background probe (the dashboard shows each pool's egress IP/country/flapping).
- **`initOutboundProxy.js` / `outboundProxy.js`** — outbound egress via the sidecar.
- **`connectionProxy.js` / `proxyTest.js`** — per-connection proxying + test probes.
- **`fleetStartup.js`** — pool lifecycle.

### Auth (`src/lib/auth/`)

- **`dashboardSession.js`** — cookie session for the dashboard.
- **`oidc/` + `saml.js`** — enterprise login (OpenID Connect + SAML).
- **`apiAuth.js`** (or similar) — `/v1` key auth for the gateway endpoint.

### OAuth & Tokens

- **`src/lib/oauth/`** — provider OAuth flows.
- **`src/sse/services/tokenRefresh.js` + `backgroundTokenRefresh.js`** — the background scheduler; started by `custom-server.js` AND `initializeApp` (idempotent).

### The Headroom Sidecar (`src/lib/headroom/`)

- **`detect.js` + `process.js`** — the headroom sidecar compresses upstream traffic. The dashboard's `compress: false` is deliberate — the sidecar owns compression, never double-gzip.

### Updater (`src/lib/updater/`, `src/lib/appUpdater.js`)

- The self-update machinery — version checks, install command, shutdown countdown (see `Sidebar.js`'s `ManualUpdatePanel`).

---

## 🚪 The Gateway Engine — `open-sse/`

### Providers (`open-sse/providers/`)

- **`registry/`** — one file per provider (**143 files**). `registry/index.js` is **auto-generated** — regenerate with `scripts/migrate-registry.mjs`, never hand-edit.
- **Adding a provider**: copy an existing simple entry (e.g. `openai.js`), add models to `config/providerModels.js`; add an executor only for non-OpenAI-compatible upstreams.
- **`executors/`** — per-upstream format translators. OpenAI-compatible providers share one executor.

### RTK Token Saver (`open-sse/rtk/`)

The token-saver filters — pre-translate hooks that compress `tool_result` content in-place.

- **Fail-open contract**: any error returns `null` and leaves the body untouched — never throw out of them. Skips `is_error` results to preserve traces.
- **Filters**: `caveman.js`, `ponytail.js`, `pxpipe.js`, `systemInject.js`, `userInjectors.js`, `headroom.js`, `applyFilter.js`, `autodetect.js`, `registry.js`.
- **`userInjectors.js`** — operator-defined system prompts layered via `injectSystemPrompt` (append/prepend), after the built-in savers (settings `userInjectors`).

### Services (`src/sse/services/`)

- **`keyGate.js`** — per-key ACL, 4 layers: kinds / providers / combos / models. Handlers pass an explicit `kind` to `authorizeApiRequest`.
- **`budgetGate.js` + `budgetAlerts.js`** — daily/spend caps + alerts.
- **`connectionPreference.js` / `freebuffPreference.js`** — routing preference.
- **`usageDigest.js`** — usage aggregation.
- **`auth.js` / `model.js`** — gateway auth + model resolution.

---

## 🖥️ The Helm — `custom-server.js`

The custom Node server that wraps Next's standalone output. **Do not weaken it**:

- **IP derivation** — client IP from the TCP socket (unspoofable); strips client-supplied `x-forwarded-for`/`x-real-ip` unless the peer is a loopback proxy. Stamps `x-9r-real-ip` + `x-9r-peer-token` (per-process secret).
- **Hop-by-hop hygiene** — strips the RFC 7230 §6.1 set (`connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`) from client headers.
- **h2c upgrade** — JBR 25 sends h2c; the server downgrades it to HTTP/1.1 with a **512mb body guard**.
- **Graceful drain** — SIGTERM/SIGINT → `server.close()` → bounded drain (10s) → exit.
- **Background token refresh** — starts `backgroundTokenRefresh.js` on `listening` (idempotent; fail-open if `src/` absent).
- **Main-path guard** — `require.main === module` loads `server.js` if present, else delegates to `next start`.

---

## 🐳 The Container — `Dockerfile`

Multi-stage, multi-arch (amd64 + arm64). The **builder** forces `VELA_DB_DRIVER=node:sqlite` — the arm64 cross-build crashes under QEMU if it loads the better-sqlite3 native addon (SIGILL). Builder-scoped only; the runner has its own env.

**Runner** (`node:22-alpine`):
- **OCI metadata** — title/description/source/version/revision/license labels.
- **`HEALTHCHECK`** — `wget /api/health` on 32060, 30s interval, 30s start-period.
- **`STOPSIGNAL SIGTERM`** — pairs with the custom server's graceful drain.
- **Entrypoint** — `su-exec node` after `chown`ing the mounted data dirs.
- **The mysql2 closure** — the tracer can't follow the runtime dynamic import (`src/lib/db/mysql/pool.js`), so the Dockerfile copies the WHOLE transitive closure (9 deps: aws-ssl-profiles, generate-function, iconv-lite, is-property, long, lru.min, named-placeholders, safer-buffer, sql-escaper). **Keep those COPY lines intact** — `tests/unit/dockerfile-mysql2-closure.test.js` guards them.

> **⚠️ CI GOTCHA**: the build (`npm run build` → `sync-changelog.mjs` + `next build`) needs `package-lock.json` AND `scripts/sync-changelog.mjs` + `scripts/copy-standalone-assets.mjs` tracked. They were once gitignored and every tag build broke. **Never re-untrack them.**

---

## 📡 The Release Covenant — How Versions Sail

Every change ships as a versioned minor (`0.9.x`) with:
1. `CHANGELOG.md` entry (the covenant's voice)
2. `package.json` version bump
3. Annotated git tag (`v0.9.x`)
4. `git push origin main && git push origin v0.9.x`

The tag triggers `.github/workflows/docker-publish.yml` → GHCR `ghcr.io/yumamax3/vela:<tag>` + `:latest`.

**Workflows**:
- **`docker-publish.yml`** — tag-push build; `concurrency: docker-publish` prevents tag races; emits semver + `:latest`; multi-arch amd64+arm64; `provenance: false`.
- **`cache-warm.yml`** — daily + on `v*` tags; keeps the multi-arch buildcache alive so the next tag build starts warm (~20 min vs cold 45–60).
- **`gitbook-pages.yml`** — deploys `gitbook/` to the GitHub Pages repo.

**Verify a build**: `gh run list --repo YumamaX3/Vela --workflow "Build and Push Docker Image"`.

---

## 🗄️ The Storage Covenant — Postures

`VELA_DB_MODE` (default `sqlite`):

| Mode | Serving harbor | Notes |
|-|-|-|
| `sqlite` | SQLite | The default. Driver via `VELA_DB_DRIVER` or fallback chain |
| `mysql` | MariaDB via `VELA_MYSQL_URL` | Refuses to boot without the URL; never silent-downgrades |
| `mirror` | SQLite primary + MariaDB twin | Outbox pump carries writes; the barrel operates on the primary |

- The **mirror decorator** (`src/lib/db/mirror/mirrorDecorator.js`) wraps writer calls so the mutation and its outbox row commit atomically.
- `localDb.js` is a **backward-compat shim** — new code imports `@/lib/db/index.js`.
- **Backup engine** (`src/lib/db/backup.js` + `repos/backupEngine.js`) — Storage Covenant Wave B; `backupSecurity.js` + `s3Offsite.js` for offsite.

---

## 🧪 The Test Covenant

- **Runner**: vitest, `tests/` root. 243 unit files.
- **Baseline**: the touched suites run green in this session (migration 013, migration 002, fallback-rules seam, pool-geo, user-injectors — 47 tests).
- **sql.js caution**: the sql.js WASM adapter has a small default heap. A fresh boot chain + extra statements can hit "out of memory" in tests — give each test its own temp `DATA_DIR`/adapter, or force the native driver (`VELA_DB_DRIVER`) for heavier assertions.
- **Migrations are tested on the crash driver**: `tests/unit/key-acl-migration-013.test.js` boots **sql.js** (the Docker runner's fallback) and proves the chain runs — the regression that caught the `a.prepare` bug.
- **Docker guards**: `tests/unit/dockerfile-mysql2-closure.test.js` keeps the mysql2 closure COPY lines alive.

---

## 🎨 The Design System

- **Brand**: coral `#E56A4A` (`--color-brand-500`). The single accent.
- **Surfaces**: warm neutrals — light `#FDFAF6`, dark `#1a1a1a`. Sidebar `rgba(244,241,236,.85)` light / `rgba(30,30,30,.85)` dark.
- **Type**: Inter-ish system stack; `font-mono` for keys, code, ids.
- **Icons**: Material Symbols (`material-symbols-outlined`).
- **Radius**: `--radius-brand-lg` cards; 10px nav pills.
- **Tokens live in** `src/app/globals.css` — light + `.dark` blocks. New surfaces go through tokens, never hard-coded hex.
- **The sidebar** (`src/shared/components/Sidebar.js`) — the harbor's navigation; group accordions, active rail, update banner.

---

## 🔐 Security Covenants

- **Per-key ACL** — `keyGate.js`: tri-state allowlists (NULL = all, `[]` = deny, `["x"]` = whitelist). Columns: `allowedKinds`, `allowedProviders`, `allowedCombos`, `allowedModels`.
- **API keys** — `keyHash` + `keyPrefix`, tombstone + scrub on migration 002, `uk_ak_key_hash` UNIQUE (NULL-distinct).
- **IP trust** — only loopback proxies' forwarding headers are trusted; `x-9r-peer-token` proves the stamp.
- **Secrets** — OAuth tokens live in the DB, never in git; `docker-compose.yml` is gitignored because it holds them.
- **Budget** — `budgetGate.js`: daily caps, spend caps, rate limits per key.
- **CORS/headers** — `poweredByHeader: false`; hop-by-hop hygiene at the helm.

---

## 🧹 The Great Purge — What Was Renamed, What Deliberately Stays

The 9router brand string was purged repo-wide (v0.9.21). The coordinated rename:

| Old | New | What it was |
|-|-|-|
| `has9Router` | `hasVela` | API field (cli-tools status) |
| `x-9r-cli-token` / `9r-cli-auth` | `x-vela-cli-token` / `vela-cli-auth` | CLI auth header + salt |
| `x-9router-connection-id` | `x-vela-connection-id` | Video-generation response header |
| `custom:9Router-0` | `custom:Vela-0` | Persisted custom-model config key |
| `providers["9router"]` | `providers["vela"]` | Persisted provider config key |
| `NINE_ROUTER_*` env | `VELA_*` env | Proxy-managed env vars |
| `x-9router-token-saver` | `x-vela-token-saver` | Headroom header |
| `X-Msh-Platform: "9router"` | `"vela"` | Kimi platform identifier |

**Deliberately kept — the `x-9r-*` security family** (13 refs): `x-9r-real-ip`, `x-9r-peer-token`, `x-9r-via-proxy`, `x-9r-password`, `x-9r-internal-models-fetch`. These are the custom server's **stamping protocol** — `trustedPeer.js` verifies the per-process token, `keyGate` reads the socket-derived IP. The `9` is the number, not the brand; renaming them would require changing the stamping + every reader in lockstep with zero security benefit.

> ⚠️ Saved CLI-tool configs that stored the old keys (`custom:9Router-0`, `providers["9router"]`) are no longer recognized — users re-configure once after upgrading.

---

## 🔧 Common Operations

### Run the dashboard locally
```bash
npm install
npm run dev        # Next dev (custom server not loaded)
npm run build      # production build (standalone)
node custom-server.js   # production server (IP stamp + h2c + drain)
```

### Add a provider
1. Copy an existing simple registry entry (e.g. `open-sse/providers/registry/openai.js`) → `open-sse/providers/registry/<slug>.js`
2. Add models to `open-sse/config/providerModels.js`
3. `node scripts/migrate-registry.mjs` (regenerates `registry/index.js`; `scripts/injectDisplayToRegistry.mjs` adds display names)
4. Add an executor only if the upstream is NOT OpenAI-compatible

### Add a migration
1. `src/lib/db/migrations/<NNN>-<name>.js` — export `{ version, name, up, down }`
2. **Use the portable adapter surface** — `db.all("PRAGMA table_info(...)")` + `db.exec(...)`. **Never `db.prepare`.** (v0.9.20 lesson.)
3. Bump `SCHEMA_VERSION` in `migrate.js` and update this chart's migration table.
4. If the twin needs the column, `bootstrap.js`'s additive diff picks it up from `TABLES` automatically.

### Release a minor
```bash
# edit CHANGELOG.md + bump package.json
git add -A && git commit -m "feat(...): ... (v0.9.x)"
git push origin main
git tag -a v0.9.x -m "Release v0.9.x: ..."
git push origin v0.9.x
gh run list --repo YumamaX3/Vela   # watch the build
```

### Deploy the chart (ZimaOS)
```bash
cd /media/SSD-Storage/AppData/vela
docker compose pull && docker compose up -d
```

---

## 📜 Recent Tides (the session's record)

| Version | Tide | What it sealed |
|-|-|-|
| v0.9.21 | The Stillwater Hull | Server drain + hop-by-hop, Docker healthcheck/labels, CI concurrency, CLI rebrand |
| v0.9.21 | The Vela CLI Ascension | cli/ renamed 9router→vela (name+bin), `vela doctor`, `--no-tray`, health fail-fast |
| v0.9.21 | The Complete Purge | 9router string purged repo-wide — wire contracts renamed (`hasVela`, `x-vela-*`), only the `x-9r-*` security family remains |
| v0.9.20 | The Adapter Contract Fix | Migration 013 portable surface (the boot-storm hotfix) |
| v0.9.19 | The Prompt Injectors | User-defined injectors (settings.userInjectors) |
| v0.9.18 | Pool Egress Geo | poolGeo + probe, dashboard egress panel |
| v0.9.17 | Per-key ACL | 4-layer keyGate allowlists (migration 013) |
| v0.9.16 | Fallback Rules | Operator combo fallback (fallbackRulesRepo) |
| v0.9.15 | The Resilience Covenant | Circuit breaker |

---

*The Shores sail on — one harbor, one voice, every tide sealed. If the waters run strange, read the chart again before you touch the helm. And when you change something, write down why — the next keeper will thank you.* 🪞⛵
