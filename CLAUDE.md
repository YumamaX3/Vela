# ⛵ CLAUDE.md — The Crew's Papers

Guidance for Claude Code (and any engineer) working in this repository.
The full documentation harbor lives in [docs/README.md](./docs/README.md) —
read the relevant chart before working in an area, rather than re-deriving.

## What this is

**Vela** (`vela-app`, v0.6.80) — a local AI routing gateway + Next.js
dashboard, forked from [9Router](https://github.com/decolua/9router) and
sailing its own course from v0.6.0. It exposes one OpenAI-compatible
endpoint (`/v1/*`) and routes traffic across 40+ upstream providers with
format translation, model-combo fallback, multi-account fallback, OAuth /
API-key credential management, token refresh, quota/usage tracking, the RTK
token saver, and a three-posture storage layer with sealed backups.

Two published artifacts live in this one repo:

- The **dashboard + gateway** (root `package.json`, `vela-app`) — the
  Next.js server that does the actual routing.
- The **CLI launcher** (`cli/`, published to npm as `9router`) — a separate
  package that installs/starts the server and manages the tray. Own
  `package.json`, version, and build — the npm name is kept deliberately.

## Commands

Dashboard/gateway (run from repo root):

```bash
cp .env.example .env
npm install
PORT=32060 NEXT_PUBLIC_BASE_URL=http://localhost:32060 npm run dev
npm run build && PORT=32060 HOSTNAME=0.0.0.0 npm run start
```

- Bun variants: `npm run dev:bun` / `build:bun` / `start:bun`.
- Default runtime port is **32060** (dashboard at `/dashboard`, API at `/v1`).
- Lint: `npx eslint .` (config `eslint.config.mjs`).

Tests (vitest, in `tests/`, an **independent** ESM package — not wired into
root `npm test`):

```bash
npm install                    # ROOT deps first
cd tests && npm install        # then tests' own deps
npx vitest run                 # auto-discovers tests/vitest.config.js
npx vitest run unit/capabilities.test.js   # single file
```

> ⚠️ The committed `tests/package.json` `test` script hardcodes Unix paths —
> ignore it; use the `npx vitest` form above.
>
> **The suite is NOT expected to be all-green on a plain checkout**
> (~938 pass, ~64 fail). Judge regressions with
> `tests/__baseline__/verify-no-regression.mjs`, not a raw run. Expected red:
> the catalogued `tests/__baseline__/known-fails.txt`, the `cloud/` worker
> import (dir not in this repo), the xAI timeout without credentials, and
> `real/*.real.test.js` (live provider calls).

## Architecture

Two authoritative charts — read them before working in these areas:

- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — request lifecycle,
  translator engine, provider registry, DB layer, storage postures, backup
  engine, pricing covenant.
- [open-sse/AGENTS.md](./open-sse/AGENTS.md) — the routing/translation
  engine's own conventions. **Read before editing anything under `open-sse/`.**

### Request flow (understand this first)

```
src/app/api/v1/* route  (rewrite /v1/* → /api/v1/* in next.config.mjs)
→ src/sse/handlers/chat.js  (parse, combo expansion, account-selection loop)
→ open-sse/handlers/chatCore.js  (detect format, translate, dispatch, retry/refresh)
→ open-sse/executors/*  (per-provider upstream call; default.js = any OpenAI-compat)
→ open-sse/translator/*  (client format ⇄ provider format)
→ SSE back to client
```

`src/sse/` is app-side entry glue; `open-sse/` is the provider-agnostic
engine. Cross that boundary consciously.

### Translator engine (`open-sse/translator/`)

- Pivots through **OpenAI as the intermediate format**. A translator
  registered on an exact `source:target` pair runs as a **direct route**,
  skipping the lossy double-hop. Prefer direct routes for fragile pairs.
- Translators **self-register** via `register(from, to, reqFn, resFn)` as an
  import side effect — a new translator file MUST be imported in
  `open-sse/translator/index.js` or it never runs.
- Never hardcode role/block/model strings — use `translator/schema/` and
  `config/` constants.

### Provider registry (`open-sse/providers/registry/*`)

One file per provider (129 files). `registry/index.js` is **auto-generated**
— regenerate with `scripts/migrate-registry.mjs`, don't hand-edit. Add a
provider: copy `REGISTRY_TEMPLATE.js`, add models to
`config/providerModels.js`; add an executor only for non-OpenAI-compatible
upstreams.

### Persistence — IMPORTANT

State is **SQLite under `src/lib/db/`**, not `db.json` (that era is over).
Driver fallback chain (`driver.js`): `bun:sqlite` → `better-sqlite3`
(optional native dep) → `node:sqlite` (Node ≥ 22.5) → `sql.js` (pure-JS).
`src/lib/localDb.js` is a backward-compat shim — new code imports
`@/lib/db/index.js`; per-entity logic lives in `src/lib/db/repos/*`
(facades that bind by posture). Schema/migrations in `src/lib/db/migrations/`
(001–007, `SCHEMA_VERSION = 7`).

**Storage postures** (`VELA_DB_MODE`): `sqlite` (default) | `mysql`
(MariaDB is the harbor; unreachable twin refuses boot LOUD) | `mirror`
(SQLite serves, writes pump to the twin). Full covenant:
[docs/STORAGE.md](./docs/STORAGE.md). Usage/logs (`src/lib/usageDb.js`)
still live under `~/.9router` and do **not** follow `DATA_DIR`.

### RTK token saver (`open-sse/rtk/`)

Pre-translate hooks that compress `tool_result` content in-place.
**Fail-open**: any error returns `null` and leaves the body untouched —
never throw out of them. Skips `is_error` results to preserve traces.

## Conventions & gotchas

- Plain JavaScript (ESM), **no TypeScript**. `@/*` path alias → `src/*`
  (`jsconfig.json`).
- `custom-server.js` wraps the Next standalone server to derive client IP
  from the TCP socket and strip attacker-controlled `X-Forwarded-For` —
  trusting forwarding headers only from a loopback reverse proxy. Preserve
  this when touching request/IP/rate-limit code.
- Security-sensitive env: `JWT_SECRET`, `INITIAL_PASSWORD` (default
  `123456` — must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full
  contract in [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md) and `.env.example`.
- Binary/protobuf upstreams (Kiro EventStream, Cursor protobuf, CommandCode
  NDJSON) don't round-trip through the translator — handled inside their own
  executor.
- Versioning: root and `cli/` are versioned independently; changes are
  logged in `CHANGELOG.md`. Conventional Commits (`feat(translator): …`).
  The rite: [docs/VERSIONING.md](./docs/VERSIONING.md).
- Docker image: `ghcr.io/yumamax3/vela:<tag>`, built by
  `.github/workflows/docker-publish.yml` on `v*` tags. The Dockerfile copies
  mysql2's full transitive runtime closure (dynamic import the tracer can't
  follow) — keep those COPY lines intact
  (`tests/unit/dockerfile-mysql2-closure.test.js` guards them).

## Documentation map

| Need | Chart |
|-|-|
| Everything, one page | [docs/README.md](./docs/README.md) |
| How the ship is built | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| Install / compose / postures | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) |
| Docker deep | [DOCKER.md](./DOCKER.md) |
| Env-var contract | [docs/ENVIRONMENT.md](./docs/ENVIRONMENT.md) |
| Storage covenant | [docs/STORAGE.md](./docs/STORAGE.md) |
| Provider roster | [docs/PROVIDERS.md](./docs/PROVIDERS.md) |
| API surface | [docs/API.md](./docs/API.md) |
| When things break | [docs/TROUBLESHOOTING.md](./docs/TROUBLESHOOTING.md) |
