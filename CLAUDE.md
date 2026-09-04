# ⛵ Vela — The AI Gateway

> *Every harbor needs a chart. These are the Shores' navigational papers — where the currents run, which rocks to mind, how the fleet sails. Read them before you touch the helm.* 🪞💜

**Vela** (v0.9.46) — a local AI routing gateway + dashboard. One OpenAI-compatible endpoint (`/v1`) routing traffic across a provider registry of **144 files on disk → 127 imported by the generated index → 91 dialable chat transports** (the other 36 are media/search/embedding providers that legitimately carry no chat transport). Format translation, model-combo fallback (with operator fallback rules), multi-account fallback, OAuth credential management, token refresh, quota tracking, per-key ACL, and prompt injectors.

> ⚠️ **Count discipline (2026-09-04):** this chart once claimed "143 upstream providers", which
> matched *no* measurement. Every number above was measured at runtime, not grepped — and the three
> differ, so name which one you mean. Re-derive with:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 144 files on disk
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"  # 127 imported
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 91 dialable
> ```
> **14 of the 144 are unreachable** — see the registry debt below.

- **Language**: Node.js + Next.js (App Router, standalone output)
- **Runtime**: Node 22+ (the image pins `node:22-alpine`). ⚠️ There is **no `engines` field** in `package.json`, and `≥ 22.5` is **not** a hard floor — it is the threshold at which the driver chain offers the zero-install `node:sqlite` (`driver.js:34`: `if (maj < 22 || (maj === 22 && min < 5)) return null`). Below it the chain still works via `better-sqlite3`, and last via pure-JS `sql.js`. Bun compatible.
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
├── package.json              # v0.9.46 — bump with every release
├── CHANGELOG.md              # Every minor's covenant entry
├── cli/                      # The `vela` npm CLI — bin `vela`, full purge
├── open-sse/                 # The gateway engine — providers, RTK, executors, handlers
├── src/
│   ├── app/                  # Next App Router — 26 dashboard pages + 182 API routes
│   ├── lib/                  # The deep current — db, network, oauth, auth, updater, headroom
│   ├── sse/                  # Server-sent-event services — keyGate, budget, token refresh
│   ├── shared/               # Shared components, hooks, utils, constants
│   ├── mitm/                 # The MITM proxy child process
│   └── instrumentation.js    # Server init — outbound proxy, deferred startup
├── tests/                    # 312 .test.js + 4 .test.jsx — unit 278 · translator 23 (15 + real/ 8) · contract 10 · auth 1
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
| **Dashboard** | `src/app/` | The UI — 26 dashboard pages (31 `page.js` total), 182 API routes |
| **Gateway** | `open-sse/` | The proxy engine — providers, executors, RTK, handlers |

---

## 🧭 The Deep Current — `src/lib/`

### Database (`src/lib/db/`)

- **`driver.js`** — adapter resolution: `better-sqlite3` → `node:sqlite` (≥22.5) → `sql.js`. `VELA_DB_DRIVER` pins one; failure is loud.
- **`migrate.js`** — versioned migration chain + additive schema sync. `SCHEMA_VERSION = 15`, migrations `001–015`.
- **`schema.js`** — `TABLES` is the single source of truth for both harbors. ⚠️ **Not every table is in `TABLES`** — `fallbackRules` is born of migration 012 (v2 columns from 014) and absent from `TABLES`, so the additive sync CANNOT supply its columns; the versioned chain must run. Check before assuming `TABLES` covers a table.
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
| 012 | fallback-rules | Operator fallback rules (Seam 2 — the table; binder fixed v0.9.46) |
| 013 | key-acl | `allowedKinds`/`allowedProviders`/`allowedCombos` (tri-state) |
| 014 | fallback-rules-v2-triggers | Typed triggers, condition ops, `targetModels` chain |
| 015 | combo-usage | Per-combo usage attribution |

### Network (`src/lib/network/`)

- **`circuitBreaker.js`** — cooldown → exhausted escalation, exponential backoff. Woven into `proxyFleet.js` pool selection.
- **`proxyFleet.js`** — the pool engine. **`poolGeo.js` + `poolEgressProbe.js`** — shared egress registry + background probe (the dashboard shows each pool's egress IP/country/flapping).
- **`initOutboundProxy.js` / `outboundProxy.js`** — outbound egress via the sidecar.
- **`connectionProxy.js` / `proxyTest.js`** — per-connection proxying + test probes.
- **`fleetStartup.js`** — pool lifecycle.

### Auth (`src/lib/auth/`)

Six files, all verified present: `dashboardSession.js`, `loginLimiter.js`, `loginMessages.js`, `oidc.js`, `saml.js`, `trustedPeer.js`.

- **`dashboardSession.js`** — cookie session for the dashboard.
- **`loginLimiter.js` + `loginMessages.js`** — the lockout ladder and honest copy (v0.9.41 Seal 3).
- **`oidc.js` + `saml.js`** — enterprise login (OpenID Connect + SAML). Both are **single files, not directories**.
- **`trustedPeer.js`** — verifies the `x-9r-peer-token` per-process stamp.
- **`/v1` key auth lives in `src/sse/services/keyGate.js`, NOT here.** This chart once hedged `apiAuth.js (or similar)` — that file does not exist and never did. The hedge was a guess presented as a fact.

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

- **`registry/`** — one file per provider (**144 files on disk**, 127 imported by the generated index). `registry/index.js` is **auto-generated** — never hand-edit.
- **`index.js`** — builds `PROVIDERS`/`PROVIDER_MODELS`/`PROVIDER_OAUTH`/`PROVIDER_MEDIA` **only from `REGISTRY`** (the generated index). There is **no directory scan and no fallback**: a registry file absent from `index.js` is genuinely unreachable at runtime, no matter how complete it looks.
- **Adding a provider**: copy an existing simple entry (e.g. `openai.js`), add models to `config/providerModels.js`; add an executor only for non-OpenAI-compatible upstreams.
- **`executors/` lives at `open-sse/executors/`, NOT under `providers/`** — 29 per-upstream format translators. OpenAI-compatible providers share one executor. (This chart once listed it under the Providers heading; the path there holds 0 files.)

> 🐛 **THE REGISTRY DEBT (found 2026-09-04, NOT yet fixed).** The generator
> `scripts/migrate-registry.mjs` (and `injectDisplayToRegistry.mjs`) **no longer
> exists** — `scripts/` holds only `copy-standalone-assets.mjs` and
> `sync-changelog.mjs`. They were untracked by `b88fabfc` ("gitignore scripts/
> too — keep on disk") and are now gone from disk as well; the blob survives only
> at `b88fabfc~1:scripts/migrate-registry.mjs` (9,303 bytes, recoverable).
>
> Consequence: **14 committed provider files are absent from the generated index
> and therefore unreachable** — `agentrouter`, `agentrouter-pro`, `ai21`,
> `alibaba`, `alibaba-intl`, `databricks`, `devin-cli-pro`, `muse-spark-lite`,
> `muse-spark-web`, `qwen`, `qwen-v2`, `snowflake`, `zcode`, `zcode-lite`. All
> committed 2026-08-22, all carrying ordinary `id:` entries with **no exclusion
> marker**, so this reads as drift from a stale index, not a deliberate cull.
> Three more are commented out in the index: `trae`, `devin-cli`, `windsurf`.
>
> ⚠️ **Fixing this means regenerating the index — a behavior change that makes 14
> providers live at once.** That is the Star's decree, not a drive-by: it needs the
> generator restored from `b88fabfc~1`, a regen, and a model-catalog check per
> provider. Recorded here so the next keeper measures before trusting any
> "provider count", and so the gap is never re-derived by memory.

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
2. `package.json` version bump (+ `npm install --package-lock-only` so the lockfile's two version lines follow — verify the diff is version-only)
3. Annotated git tag (`v0.9.x`) — with a **deep, themed description** (the decree below)
4. `git push origin main && git push origin v0.9.x`
5. **Publish the GitHub Release** — `https://github.com/YumamaX3/Vela/releases` (the decree below)

The tag triggers `.github/workflows/docker-publish.yml` → GHCR `ghcr.io/yumamax3/vela:<tag>` + `:latest`.

> ⚖️ **The docs-only exception.** `CHANGELOG.md`'s Versioning Covenant says "every change, great or
> small, bumps `package.json`". It carries one exception, written here so it is never re-derived by
> precedent archaeology: **a docs-only correction that changes no shipped artifact does NOT bump and
> does NOT tag.** Two facts make it safe, both measured:
>
> 1. The runner image copies an **explicit list with no wildcard** — `public`, `.next/static`,
>    `.next/standalone`, `custom-server.js`, `open-sse`, `src/mitm`, and named `node_modules`
>    closures. `CLAUDE.md`, `CHANGELOG.md` and the like never reach the runtime, even though the
>    *builder*'s `COPY . ./` does pull them in. A bump would trigger a Docker build for a file that is
>    not in the image.
> 2. Precedent in-repo: `1f45421b` — `docs(changelog): correct a false test count — 54 was never
>    measured, 50 is` — one file, no bump.
>
> **The boundary that matters:** this exception is for a *standalone correction made after the fact*.
> A `CHANGELOG.md` entry written **as part of** a release absolutely ships with that release's bump —
> the exception covers only the later, separate commit that fixes a false number in an already-shipped
> entry (which is precisely what `1f45421b` did). The moment a commit touches anything the runner
> copies, or `package.json`'s dependencies, it is a release and follows all five steps above. An
> unwritten exception is how a keeper either bumps pointlessly or ships an unbumped change that *did*
> alter the runtime.

### 📢 The Releases Decree (Star's decree, 2026-09-04)

**Every new version gets a GitHub Release — an annotated tag alone is not a
release.** The tag is the git object; the Release is what the world sees at
`https://github.com/YumamaX3/Vela/releases`. Pushing a tag does NOT create one.

```bash
# Reuse the tag's own deep description verbatim — never write a thinner note.
# ⚠️ Project-local scratch only: /tmp/ resolves to C:\tmp\ on Windows and ENOENTs.
git tag -l --format='%(contents)' v0.9.x > .release-notes.md
gh release create v0.9.x --repo YumamaX3/Vela \
  --title "$(git tag -l --format='%(subject)' v0.9.x | sed 's/^⛵ *//')" \
  --notes-file .release-notes.md
rm .release-notes.md

# Verify it landed:
gh api "repos/YumamaX3/Vela/releases/tags/v0.9.x" --jq '.html_url'
```

> 🔧 **Git Bash gotcha:** `gh api "/repos/..."` fails with
> `invalid API endpoint: "C:/Program Files/Git/repos/..."` — the shell rewrites a
> leading slash as a filesystem path. **Drop the leading slash.**

| Rule | The Law |
|-|-|
| **Name convention** 🏷️ | `v0.9.x — The Themed Name <emoji>` — strip a leading `⛵` so it matches the existing list (`v0.9.40 — The Combo Harbor ✨`) |
| **Body** 📜 | The tag's deep description, verbatim via `--notes-file`. The Description Decree already put the full story there; a Release that paraphrases it loses the proof |
| **Never draft** | Publish it — a draft Release is invisible |
| **Audit the gap** 🔍 | `gh api "repos/YumamaX3/Vela/releases?per_page=100" --jq 'length'` vs `git ls-remote --tags origin \| grep -c 'v0\.9\.'` — the counts must agree |

> ⚠️ **This decree exists because of a six-version gap.** Releases stopped at
> v0.9.40 while tags continued through v0.9.46 — so v0.9.41, .42, .43, .44, .45
> and .46 each had a deep annotated tag and **no Release at all**. All six were
> back-filled on 2026-09-04 from their own tag bodies. A tag nobody publishes is
> a sealed letter never posted.

### 📜 The Description Decree (Star's decree, 2026-08-29)

Every version from v0.9.31 onward carries a **themed, emoji-rich, deep
description** in BOTH the commit body AND the annotated tag message:

| Rule | The Law |
|-|-|
| **Vela themed** ⛵ | Maritime voice — tides, harbors, sails, currents. The log speaks as the harbor speaks |
| **Emojis** ✨🐛🔧 | One or more per release, matching the change's nature (feature ✨, fix 🐛, refit 🔧) |
| **Deep information** 🗺️ | Not a headline — the full story: what changed, why it changed, the files touched, the proof (test counts, verified behaviors). A future keeper reads it and understands everything |
| **Commit body + tag** | The commit body carries the deep description; `git tag -a -m` carries the same depth (plus the one-line poetic epigraph) |

**Example** (the shape every future release follows):

```
🔧 Release v0.9.31 — The Mended Lines ⛵

The proxy test gate was wounded: bundled builds lost the undici import
binding, and every proxy test died "ProxyAgent is not defined". Both
engines (dashboard probe + gateway dispatcher cache) now bind dynamic
imports to declared locals with honest availability checks.

⚓ What sailed: src/lib/network/proxyTest.js, open-sse/utils/proxyFetch.js
🧪 Proof: proxy-fleet-covenant 24/24 green
🌊 The harbor waits, never cancels: per-tag CI groups now queue builds
   instead of cancelling siblings in flight (docker-publish.yml)
```

### ⏳ Patience of the Harbor (Star's decree, 2026-08-29)

A new image build NEVER cancels an old one mid-flight. CI builds are
per-tag groups (`docker-publish-${ref}`, cancel-in-progress: false) — they
queue and run to completion. The v0.9.26 lesson stands sealed: the
concurrency-cancellation under v0.9.27 cost the 0.9.26 image entirely.
Never reintroduce a shared cancel-in-progress group.

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

- **Runner**: vitest, `tests/` root. **312 `.test.js` + 4 `.test.jsx`** (unit 278 · translator 23 · contract 10 · auth 1). Canonical invocation: `npx vitest run -c tests/vitest.config.js` — there is no root config and no `test` script, and without `-c` the `@/` alias dies.
- **⚠️ NEVER claim "full suite green".** The repository has none to claim — v0.9.45 measured 40 failing files / 97 failing cases at pristine HEAD over `tests/unit`, and `known-fails.txt` covers 9. **Re-baselining `known-fails.txt` to make a gate pass is forbidden.** The gate is an **explicit storm file list** plus a **blast-radius diff** against pristine HEAD in an out-of-repo worktree (compare failing test *names*, never counts — and strip durations, since a duration difference is not drift).
- **Producer coverage, not just consumer.** A suite that injects a literal dependency object proves the *consumer* and leaves the *producer* uncovered — `fallback-rules-seam.test.js` stayed green for five minors while `bindFallbackRules.js` was broken in production, because every block handed `handleComboChat` a fake repo and none imported the binder. Its header even *claimed* to cover the binder. For every binding/factory/accessor module, verify some test actually imports it.
- **A permissive mock is what hides a broken binding.** New producer suites must drive the **real** adapter against a **real** migrated DB (per-test `DATA_DIR` + `vi.resetModules()` in *both* hooks — see the DB-harness trap), then be **mutation-tested** in every direction they claim to cover. Each mutation must land on exactly the test that claims the property.
- **DB-harness trap** (crystallized): `paths.js` freezes `DATA_DIR` at first import AND `driver.js` binds `global._dbAdapter` once at module eval, so `delete global._dbAdapter` alone never rebinds — an earlier test's SQLite handle stays open and Windows `fs.rmSync` dies with EPERM. Evidence is orphaned temp dirs holding `data.sqlite-wal`.
- **sql.js caution**: the WASM adapter has a small default heap — give each test its own temp `DATA_DIR`/adapter, or force the native driver via `VELA_DB_DRIVER`.
- **Migrations are tested on the crash driver**: `key-acl-migration-013.test.js` boots **sql.js** (the Docker runner's fallback) and proves the chain runs — the regression that caught the `db.prepare` bug.
- **Docker guards**: `dockerfile-mysql2-closure.test.js` keeps the mysql2 closure COPY lines alive.

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

**Deliberately kept — the `x-9r-*` security family**: exactly **five live names** — `x-9r-real-ip` (6 live refs), `x-9r-peer-token` (3), `x-9r-via-proxy` (3), `x-9r-password` (2), `x-9r-internal-models-fetch` (2). These are the custom server's **stamping protocol** — `trustedPeer.js` verifies the per-process token, `keyGate` reads the socket-derived IP. The `9` is the number, not the brand; renaming them would require changing the stamping + every reader in lockstep with zero security benefit.

> ⚠️ **Count discipline (2026-09-04):** this line once said "13 refs", which matched no
> measurement — there are **16 live refs** across the five names, and **31 total** including
> comment-only mentions. Count live refs only; a grep over the whole tree also catches prose, and a
> sixth name (`x-9r-cli-token`) survives **in one comment only** at `custom-server.js:50` — the
> purge renamed every live site to `x-vela-cli-token` with the salt `vela-cli-auth`, so the comment is
> a historical note, not a survivor of the wire contract. Re-derive:
> ```bash
> grep -rohE 'x-9r-[a-z-]+' src open-sse custom-server.js cli | sort | uniq -c | sort -rn
> ```

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
3. Regenerate `registry/index.js` — ⚠️ **the generator `scripts/migrate-registry.mjs` is MISSING** (see the registry debt under Providers). Until it is restored from `b88fabfc~1`, a new provider file will sit on disk but NOT be imported, so it is unreachable at runtime. **This is exactly how the 14-provider gap happened — do not add a provider without first confirming it lands in `index.js`.**
4. Add an executor only if the upstream is NOT OpenAI-compatible

### Add a migration
1. `src/lib/db/migrations/<NNN>-<name>.js` — export `{ version, name, up, down }`
2. **Use the portable adapter surface** — `db.all("PRAGMA table_info(...)")` + `db.exec(...)`. **Never `db.prepare`.** (v0.9.20 lesson.)
3. Bump `SCHEMA_VERSION` in `migrate.js` and update this chart's migration table.
4. If the twin needs the column, `bootstrap.js`'s additive diff picks it up from `TABLES` automatically.

### Release a minor
```bash
# 1. edit CHANGELOG.md + bump package.json
#    ⚠️ ALSO bump the image pin in BOTH docker-compose.example.yml (tracked)
#    AND docker-compose.yml (gitignored, on disk) — the Star's decree:
#    every update sails both charts. NEVER stage docker-compose.yml.
#    ⚠️ NEVER `git add -A` — the working tree carries the Star's unrelated edits
#    (Button.js, Card.js) and untracked strays. Stage the tide's files BY NAME.
npm install --package-lock-only          # lockfile version follows; diff must be version-only

git add <this tide's files, explicitly>
git commit -F msg.txt                    # deep themed body — see the Description Decree
git push origin main

git tag -a v0.9.x -F tag.txt             # deep themed tag message
git push origin v0.9.x

# 2. PUBLISH THE RELEASE — a tag alone is NOT a release (Releases Decree, 2026-09-04)
git tag -l --format='%(contents)' v0.9.x > .release-notes.md
gh release create v0.9.x --repo YumamaX3/Vela \
  --title "$(git tag -l --format='%(subject)' v0.9.x | sed 's/^⛵ *//')" \
  --notes-file .release-notes.md
rm .release-notes.md

# 3. watch the build — NEVER cancel an in-flight one (Patience of the Harbor)
gh run list --repo YumamaX3/Vela --workflow "Build and Push Docker Image"

# 4. verify alignment: HEAD = origin/main = tag commit = remote tag object
git rev-parse HEAD; git rev-parse origin/main; git rev-list -n1 v0.9.x
git ls-remote --tags origin v0.9.x
```

> ⚠️ **`public/CHANGELOG.md` is gitignored** and regenerated by
> `scripts/sync-changelog.mjs` at build time. If the build ran BEFORE later edits
> to `CHANGELOG.md`, the shipped copy is stale — re-run the sync and confirm it is
> NOT staged.

### Deploy the chart (ZimaOS)
```bash
cd /media/SSD-Storage/AppData/vela
docker compose pull && docker compose up -d
```

---

## 📜 Recent Tides (the session's record)

Every name below is the tag's own subject, and every tag was verified with
`git merge-base --is-ancestor <tag> HEAD` — so this table is main's real spine,
not a list of tags that happen to exist.

| Version | Tide | What it sealed |
|-|-|-|
| **v0.9.46** | **The Mended Rule** 🧭 | `bindFallbackRules` awaited the adapter — operator combo fallback rules were **dead since v0.9.16** (a Promise is truthy, so the fail-open guard was dead code); 6 GitHub Releases back-filled; v0.9.45's false `npm audit 0` claim corrected |
| v0.9.45 | The Sealed Hatches 🔐 | Proxy-fleet rebirth **milestone 1 — Security Closure**: §5.1 fail-closed routing · §5.2 relay auth (every deployed relay was an **open proxy**) · §5.3 `x-9r-*` egress fence · §5.4 read-boundary redaction · §5.5 SSRF gate · §5.6 undici floor `^7.29.0` |
| v0.9.44 | The Downstream Wounds 🩸 | Milestone 0.6: LIVE-A socks5 `{uri}`→positional (silent DIRECT bypass) · LIVE-B bulk-health forks the loop → delegates · LIVE-C/D six columns dropped by every transfer path incl. backup→restore |
| v0.9.43 | The Proven Restore 🛟 | Milestone 0.5: restore **proven** (not just backed up) — 11 tests, mutation-tested red on a dropped blob field |
| v0.9.42 | The Live Wounds 🩸 | Milestone 0 / Wave 0 ("Wire First, Then Invert"): reconnect the severed signal chain. Two wounds named in the tag — the ESM frozen-null default export (broke 4 dashboard routes behind generic 500s) and `resetFitness` db-first-vs-facade arity. Deleted the tautological `proxy-fleet-covenant.test.js`. Tag census: 17 files, +1172/−368, `5d3b8bbf` |
| v0.9.41 | The Four Seals 🔒 | M0 security foundation — CLI machine token local-bound + constant-time compares · plaintext export redacts every upstream credential · `123456` retired with a lockout ladder · provider-test SSRF gate. 187/187 M0 gate, 5 commits / 37 files |
| v0.9.40 | The Combo Harbor ✨ | Per-combo usage attribution (migration 015) + combos page redesign |
| v0.9.39 | The Namespaced Fleet ✨ | Combo names may carry slashes (`vela/cc/opus`) |
| v0.9.38 | Harbor Morning ✨ | Homepage redesign — greeting masthead, The Pulse, coral used once |
| v0.9.37 | The Returning Shore 🐛 | OAuth callbacks derive from the accessing host (spoof-guarded) |
| v0.9.36 | The Skills Ascension ✨ | Dashboard `/skills` rebuilt — Command Deck, grouped fleet, preview drawer |
| v0.9.35 | The Final Purge 🧹 | Everything → Vela; `decolua/9router` → `YumamaX3/Vela`; net −1,098 lines |
| v0.9.34 | The Provider Ascension 🌊 | Freebuff full ascension + CodeBuddy honest gate |
| v0.9.33 | The Hardened Hull 🛡️ | custom-server security headers + Dockerfile hardening (tini, ca-certs) |
| v0.9.32 | The Horizon Bell 🔔 | Update-notice truth source fixed (GitHub, not npm) |
| v0.9.31 | The Mended Lines ⛵ | `ProxyAgent is not defined` — both engines bind dynamic imports |
| v0.9.30 | The Honest Gate ⚖️ | qoder first-frame errors now honest non-200 so fallback engages |
| v0.9.29 | The Homecoming Deck | 9router silhouette on live data |
| v0.9.28 | The Unbound Panels | Manual configs without install |
| v0.9.27 | The Living Console | Timestamps, filters, follow toggle |
| v0.9.26 | The Living Deck | Realtime KPIs, Today helm, Madefaka fleet |
| v0.9.25 | The Cached Tokens KPI | 5-card band, Live Activity Cached◎ marker |
| ~~v0.9.24~~ | ~~The Deep Audit Ascension~~ | ⚠️ **ORPHAN TAG — not in main's history.** See below |
| v0.9.23 | The Stillwater Design | Fallback Rules v2 + Prompt Injectors v2 |
| v0.9.22 | The Adapter Exorcism | `fallbackRulesRepo` portable surface |
| v0.9.21 | The Stillwater Hull | Server drain + hop-by-hop, Docker healthcheck, CLI rebrand, the complete 9router purge |
| v0.9.20 | The Adapter Contract Fix | Migration 013 portable surface (the boot-storm hotfix) |
| v0.9.19 | The Prompt Injectors | User-defined injectors (`settings.userInjectors`) |
| v0.9.18 | Pool Egress Geo | `poolGeo` + probe, dashboard egress panel |
| v0.9.17 | Per-key ACL | 4-layer `keyGate` allowlists (migration 013) |
| v0.9.16 | Fallback Rules | Operator combo fallback (`fallbackRulesRepo`) — ⚠️ shipped with the binder bug v0.9.46 fixed |
| v0.9.15 | The Resilience Covenant | Circuit breaker |

> ⚠️ **The v0.9.24 orphan, measured not remembered.** `v0.9.24` (`bdbc44b4`,
> 2026-08-26) branched **forward from v0.9.23** carrying 4 commits, and **no
> branch contains it** — `git branch -a --contains v0.9.24` returns empty. Main's
> spine runs `v0.9.23 → v0.9.25` directly (2 commits, 2026-08-29), skipping
> v0.9.24 entirely. Its work (settings v2, executor singleton-state exorcism,
> rules-of-hooks stabilization, the deep clean) was abandoned rather than merged.
>
> This **corrects a stale Tethys record** which claimed "main = v0.9.23 by the
> Star's choice; v0.9.24–29 retreated-from, preserved in a prunable worktree".
> Only v0.9.24 was truly retreated from — **v0.9.25 through v0.9.29 are all
> ancestors of HEAD**, verified individually. The note was a true snapshot of one
> resting state that main has since sailed past.

---

*The Shores sail on — one harbor, one voice, every tide sealed. If the waters run strange, read the chart again before you touch the helm. And when you change something, write down why — the next keeper will thank you.* 🪞⛵
