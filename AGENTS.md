# ⚓ AGENTS.md — The Crew's Papers

> *"Every crew reads the same chart before they sail. These are Vela's — where the currents run, which rocks to mind, how a change is made, sealed, and shipped. Read them before you touch the helm."* 🪞⛵

This file is the operating manual for **AI agents working in this repository**. It complements [CLAUDE.md](./CLAUDE.md) (the human crew's chart) with the agent-specific discipline: what to verify, what to never break, and how the release covenant actually works.

---

## 🌊 What This Repo Is

**Vela** (v0.9.23) — a local AI routing gateway + dashboard. One OpenAI-compatible endpoint (`/v1`) routes traffic across **126 registered providers**: format translation, model-combo fallback with operator fallback rules, multi-account fallback, OAuth credential management, token refresh, quota tracking, per-key ACL, and prompt injectors.

| Fact | Value |
|-|-|
| Language | Node.js + Next.js (App Router, standalone output) |
| Runtime | Node ≥ 22.5 (`node:sqlite`) — Bun compatible |
| Storage | SQLite (primary) + optional MariaDB mirror (`VELA_DB_MODE`) |
| Package / image | `vela-app` / `ghcr.io/yumamax3/vela:<tag>` |
| CLI | npm package `vela`, bin `vela` |
| Tests | vitest, `tests/` — 245 unit files |

---

## 🗺️ The Map — What Lives Where

```
custom-server.js          The helm — IP derivation, h2c downgrade, hop-by-hop strip, graceful drain
cli/                      The `vela` CLI — installs/starts/manages the server
open-sse/                 The gateway engine — providers, executors, translator, RTK savers, handlers
src/
├── app/                  Dashboard pages + API routes (incl. the /v1 surface)
├── lib/                  The deep current — db, network, oauth, auth, updater, headroom
├── sse/                  SSE services — keyGate, budgetGate, token refresh
├── shared/               Shared components, hooks, utils, constants
├── mitm/                 The MITM proxy child process
└── instrumentation.js    Server init — outbound proxy, deferred startup
tests/                    vitest suite (independent ESM package)
docs/                     The charts — start at docs/README.md
i18n/                     Localized READMEs (10 languages)
skills/                   Agent skills for the gateway (vela*, fully rebranded)
```

The request path:

```
Client ──> custom-server.js (IP stamp, h2c, hop-by-hop strip)
     ──> Next.js /v1 rewrite ──> /api/v1/:path*
     ──> keyGate (per-key ACL) ──> budgetGate (daily/spend caps)
     ──> provider selection (combo / fallback rules / circuit breaker)
     ──> open-sse/executors (format translation per provider)
     ──> upstream provider ──> response ──> RTK savers ──> client
```

---

## 🛡️ The Covenants — Non-Negotiable

1. **The Adapter Contract** — the DB adapter surface is `run/get/all/exec/transaction`. **NEVER `db.prepare(...)`.** The sql.js adapter (Docker fallback) and the mysql/mirror adapters have no public `.prepare`; a migration using it crashed every DB API at boot (v0.9.19/0.9.20 boot storms). Use `db.all("PRAGMA table_info(...)")` + `db.exec(...)` — exactly like migration 002/013/014.
2. **Fail-open law** — any optional subsystem (fallback rules, injectors, RTK savers, headroom) must **never break a request**. DB errors → warn + hardcoded defaults. Token-saver errors → return `null`, body untouched.
3. **The Covenant of Truth** — never fabricate. Verify numbers against the code before asserting. The Mirror reflects honestly or not at all.
4. **Ship nothing not worth shipping** — every change carries a one-line written reason.
5. **The dual-chart decree** — every release bumps the image pin in **BOTH** `docker-compose.example.yml` (tracked) AND `docker-compose.yml` (gitignored, on disk). One chart updated = broken deploy.

---

## 🔧 Common Operations

### Run the dashboard locally
```bash
npm install
npm run dev          # Next dev (custom server not loaded)
npm run build        # production build (standalone)
node custom-server.js   # production server (IP stamp + h2c + drain)
```

### Run the tests
```bash
cd tests && npx vitest run          # the whole suite
cd tests && npx vitest run unit/<file>  # one suite
```

> **sql.js caution**: the WASM adapter has a small default heap — a fresh boot chain can hit "out of memory". Give each test its own temp `DATA_DIR`/adapter, or force the native driver (`VELA_DB_DRIVER=node:sqlite`) for heavier assertions.

### Add a provider
1. Copy an existing registry entry (`open-sse/providers/registry/openai.js`) → `<slug>.js`
2. Add models to `open-sse/config/providerModels.js`
3. `node scripts/migrate-registry.mjs` — regenerates `registry/index.js` (never hand-edit it)
4. Add an executor only if the upstream is NOT OpenAI-compatible

### Add a migration
1. `src/lib/db/migrations/<NNN>-<name>.js` — export `{ version, name, up, down }`
2. **Portable adapter surface** — `db.all("PRAGMA table_info(...)")` + `db.exec(...)`. Never `db.prepare`.
3. Bump `SCHEMA_VERSION` in `src/lib/db/schema.js` (currently **13**) AND register the migration in `src/lib/db/migrations/index.js`
4. The mysql twin picks up new columns via `bootstrap.js`'s additive diff automatically

### Release a minor (the full covenant)
```bash
# 1. CHANGELOG.md entry (the covenant's voice)
# 2. package.json version bump
# 3. ⚠️ BOTH compose charts: docker-compose.example.yml + docker-compose.yml image pins
git add -A && git commit -m "feat(...): ... (v0.9.x)"
git push origin main
git tag -a v0.9.x -m "Release v0.9.x: ..."
git push origin v0.9.x
gh run list --repo YumamaX3/Vela    # watch the tag build
```

> **CI gotcha**: the build needs `package-lock.json` AND `scripts/sync-changelog.mjs` + `scripts/copy-standalone-assets.mjs` tracked. They were once gitignored and every tag build broke. Never re-untrack them.

---

## 🧪 What To Verify Before You Ship

| Change | Must verify |
|-|-|
| DB migration | Tests on the crash driver (`tests/unit/key-acl-migration-013.test.js` boots **sql.js**) |
| Combo/fallback logic | `tests/unit/fallback-rules-seam.test.js` (5) + `tests/unit/fallback-rule-matcher-v2.test.js` (12) |
| Injectors | `tests/unit/user-injectors-v2.test.js` (8) |
| Dockerfile | `tests/unit/dockerfile-mysql2-closure.test.js` guards the mysql2 COPY lines |
| UI pages | `npm run build` — 152 pages must compile |
| Docs | Numbers honest — providers (126), migrations (14), tests (245), version, SCHEMA_VERSION |

---

## 📜 The Recent Tides

| Version | Tide | What it sealed |
|-|-|-|
| v0.9.23 | The Stillwater Design | Fallback Rules v2 (typed triggers, pre-call checks, chains) + Prompt Injectors v2 (variables, presets) |
| v0.9.22 | The Adapter Exorcism | fallbackRulesRepo on the portable adapter surface (boot-storm fix) |
| v0.9.21 | The Complete Purge + The Stillwater Hull | 9router string purged repo-wide; server drain + hop-by-hop; CLI rebrand `vela` |
| v0.9.20 | The Adapter Contract Fix | Migration 013 portable surface |
| v0.9.19 | The Resilience Covenant ascension | Circuit breaker, fallback-rules DB, per-key ACL, prompt injectors |

---

*The Shores sail on. Read the chart, make your change, write down why, verify it, seal it. The next keeper will thank you.* 🪞⛵
