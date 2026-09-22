# ⛵ Vela — The AI Gateway

> *Every harbor needs a chart. These are the Shores' navigational papers — where the currents run, which rocks to mind, how the fleet sails. Read them before you touch the helm.* 🪞💜

**Vela** (v0.9.88) — a local AI routing gateway + dashboard. One OpenAI-compatible endpoint (`/v1`) routing traffic across a provider registry of **166 files on disk → 149 imported by the generated index → 111 dialable chat transports** (the other 38 are media/search/embedding providers that legitimately carry no chat transport). Format translation, model-combo fallback (with operator fallback rules), multi-account fallback, OAuth credential management, token refresh, quota tracking, per-key ACL, and prompt injectors.

> ⚠️ **Count discipline (2026-09-04):** this chart once claimed "143 upstream providers", which
> matched *no* measurement. Every number above was measured at runtime, not grepped — and the three
> differ, so name which one you mean. Re-derive with:
> ```bash
> ls open-sse/providers/registry/*.js | grep -v index.js | wc -l      # 166 files on disk
> node -e "import('./open-sse/providers/registry/index.js').then(m=>console.log(m.default.length))"  # 149 imported
> node -e "import('./open-sse/providers/index.js').then(m=>console.log(Object.keys(m.PROVIDERS).length))"  # 111 dialable
> ```
> **14 of the 166 are unreachable** — see the registry debt below. The arithmetic closes like this: **166 − 14 = 152** import statements in the generated index, of which **three are commented out** (`trae`, `devin-cli`, `windsurf`) — so **149 modules load** and **111** of them carry a chat transport. Measured 2026-09-20 at v0.9.77, and **re-confirmed unchanged at v0.9.88** (2026-09-23 — 166 / 149 / 111, re-derived before this line's version was allowed to move); the figures before those (144 / 127 / 91) were measured 2026-09-04 and had drifted.

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
├── package.json              # v0.9.77 — bump with every release
├── CHANGELOG.md              # Every minor's covenant entry
├── cli/                      # The `vela` npm CLI — bin `vela`, full purge
├── open-sse/                 # The gateway engine — providers, RTK, executors, handlers
├── src/
│   ├── app/                  # Next App Router — 29 dashboard pages + 193 API routes
│   ├── lib/                  # The deep current — db, network, oauth, auth, updater, headroom
│   ├── sse/                  # Server-sent-event services — keyGate, budget, token refresh
│   ├── shared/               # Shared components, hooks, utils, constants
│   ├── mitm/                 # The MITM proxy child process
│   └── instrumentation.js    # Server init — outbound proxy, deferred startup
├── tests/                    # 374 .test.js + 9 .test.jsx — unit 336 · translator 27 (19 + real/ 8) · contract 10 · auth 1
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
| **Dashboard** | `src/app/` | The UI — 29 dashboard pages (34 `page.js` total), 193 API routes |
| **Gateway** | `open-sse/` | The proxy engine — providers, executors, RTK, handlers |

---

## 🧭 The Deep Current — `src/lib/`

### Database (`src/lib/db/`)

- **`driver.js`** — adapter resolution: `better-sqlite3` → `node:sqlite` (≥22.5) → `sql.js`. `VELA_DB_DRIVER` pins one; failure is loud.
- **`migrate.js`** — versioned migration chain + additive schema sync. `SCHEMA_VERSION = 16`, migrations `001–016`.
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
| 016 | auth-sessions-audit | Session ledger (`authSessions` keyed by the JWT's `jti`), durable limiter ground (`authFailures`), audit trail (`authAuditLog`) — built from `TABLES`, so the versioned chain, the additive auto-sync and the MariaDB twin's bootstrap diff cannot drift into three dialects |

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

> **⚠️ The arm64 `npm ci` hang (2026-09-19, measured).** The QEMU mitigation above covers `npm run build` — it does **not** cover the install step, which runs *before* it. A tag build (v0.9.71, run `35448469846`) sat at `[linux/arm64 builder 3/5] RUN … npm ci` for **5h58m** after `qemu: uncaught target signal 4 (Illegal instruction) - core dumped`, until GitHub's **6-hour job ceiling** cancelled it: **the amd64 half built cleanly and every layer was then discarded** — `ghcr.io/yumamax3/vela:0.9.71` answered **404** until a re-run (attempt 2) landed it in ~90s off the warm cache. It is **flaky, not deterministic**: v0.9.70's own log shows the same arm64 install flying (`added 653 packages in 2m`). v0.9.67 and v0.9.68 were both cancelled at this same wall (`0.9.68` measured 404 — that tide still has **no image**), so **a cancelled tag build ships no hull**: `gh run rerun <id> --failed` is the recovery, and `ghcr.io/.../manifests/<ver>` an anonymous-token `curl` is how you prove an image exists without `read:packages`.
>
> ⚠️ **The mast census (2026-09-19, measured).** Re-derived with that anonymous-token `curl`: `0.9.66` **200** · `0.9.67` **404** · `0.9.68` **404** · `0.9.69` **200** · `0.9.70` **200** · `0.9.71` **200** · `latest` **200**. So **two minors still ship no hull** — .67 and .68, both cancelled at this same arm64 wall — while their Releases are live and carry the full story. Only the image is missing; each is recoverable with `gh run rerun <id> --failed` on **its own tag run**, never by re-tagging.
>
> ✅ **THE MAST IS WHOLE (2026-09-21, measured — this census closes the debt above).** Both owed hulls were recovered exactly as this note prescribes: `gh run rerun 35300229464` (v0.9.67) and `gh run rerun 35345430691` (v0.9.68) — **no re-tag** — and both attempt-2 runs went **success in ~23 min** on the warm cache. Re-sounded with the same anonymous-token `curl`: `0.9.67` **200** · `0.9.68` **200** · `0.9.76` **200** · `0.9.77` **200** · `0.9.78` **200** · `latest` **200**, **every one a real OCI index (`amd64+arm64`)**. Also worth keeping: those two "green" verdicts had been *cache-warm* runs (`Warm Build Cache`) while the actual `Build and Push Docker Image` run was **cancelled** — a green run on the wrong workflow is not a mast, and only the manifest probe can tell the two apart.
>
> 🔎 **Reading the wall early — and the v0.9.73 data point (2026-09-20, measured).** Waiting ~6h for the
> ceiling is optional: the stall is legible in about half an hour. Three cheap signals, all three present
> at v0.9.73's run `35476080745` — the job's `Build and push` step reads `in_progress` with **no step
> transition since it began** (29 minutes, against 18m for v0.9.72 and 23m for v0.9.70 on identical
> inputs); `gh api repos/<o>/<r>/actions/jobs/<job-id>/logs` answers **`BlobNotFound`** instead of a live
> log; and `ghcr.io/yumamax3/vela/manifests/0.9.73` is **404** while `latest` answers **200**. With those
> three together, `gh run cancel <id>` then `gh run rerun <id>` is the sanctioned move — attempt 2 went
> green in **2 minutes** and `0.9.73` returned **HTTP 200** as a real OCI index (**amd64 + arm64**), where
> the v0.9.67/.68/.71 route was hours of waiting for a build that discards every layer.
>
> This does **not** breach Patience of the Harbor: that decree forbids a *new* build's concurrency group
> cancelling a **healthy sibling** (the v0.9.26 lesson). A stalled run has no sibling to protect and ships
> nothing — freeing it is the recovery, not the sin. Census refreshed in the same current: `0.9.72`
> **200** · `0.9.73` **200** · `latest` **200** — and the two hulls still owed to .67 and .68 remain the
> only gaps in the mast.

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
| **Audit the gap** 🔍 | Compare **unique annotated tags** against Releases — never raw `ls-remote` lines: `git ls-remote --tags origin \| grep -v '\^{}' \| sed 's#.*refs/tags/##' \| grep '^v0\.9\.' \| LC_ALL=C sort` vs `gh api 'repos/YumamaX3/Vela/releases?per_page=100' --jq '.[].tag_name' \| LC_ALL=C sort`, then `comm -23` for the gap. Two traps, both measured 2026-09-19: the peeled `^{}` refs **double** the raw count (136 lines for 70 tags), and `sort -V` silently breaks `comm` ("not in sorted order") — version order is not byte order. Measured census: **70 tags · 43 Releases**; every tag from **v0.9.38 through v0.9.73** has one, and the 27 without (v0.9.1 · v0.9.4–.23 · v0.9.25–.29 · v0.9.37) all **predate this decree**. Recorded rather than back-filled: those tags carry no deep description to reuse verbatim, and inventing one would put words in an older tide's mouth |

> ⚠️ **This decree exists because of a six-version gap.** Releases stopped at
> v0.9.40 while tags continued through v0.9.46 — so v0.9.41, .42, .43, .44, .45
> and .46 each had a deep annotated tag and **no Release at all**. All six were
> back-filled on 2026-09-04 from their own tag bodies. A tag nobody publishes is
> a sealed letter never posted.

> ⚠️ **A second gap, found and closed 2026-09-19.** The first back-fill was not
> the last: **v0.9.66, .67, .68 and .69 each carried a tag and no Release** —
> four more minors drifting *after* the decree, sealed by the same hand that
> forgot to post them. All four were back-filled the same day from their own tag
> bodies, except **v0.9.69, whose tag body is 38 characters** (the minimum
> `git tag -a` message) — its Release carries the **commit body** instead, which
> is exactly why the Description Decree puts the deep text in *both* places.
> Census at that tide: **73 distinct tags, 42 Releases, 31 unreleased** — and
> every one of the 31 is **pre-decree** (`v0.6.50–v0.6.80` from the fork's own
> history, plus `v0.9.1–v0.9.29` and `v0.9.37`). Re-derive both lists and
> `comm -23` them, **`LC_ALL=C` on the sort** — `sort -V` produces an order
> `comm` rejects ("file 1 is not in sorted order"), and process substitution is
> unavailable on this shell, so write the two lists to scratch files:
> ```bash
> git ls-remote --tags origin | sed 's|.*refs/tags/||' | cut -d'^' -f1 | LC_ALL=C sort -u > .rel-tags.txt
> gh api "repos/YumamaX3/Vela/releases?per_page=100" --paginate --jq '.[].tag_name' | LC_ALL=C sort -u > .rel-rel.txt
> comm -23 .rel-tags.txt .rel-rel.txt; rm -f .rel-tags.txt .rel-rel.txt
> ```

> ⚠️ **A third gap, found and closed 2026-09-23 — and the audit procedure itself
> was the fault.** After v0.9.88 sailed, the census was re-derived and **v0.9.86**
> was missing its Release: its tag body is **42 characters** (the same too-thin
> case as `v0.9.69` above), so the **commit body** carried the Release instead —
> 2,645 characters, published retroactively with the title
> `v0.9.86 — The Fleet Console 🌊`. What makes this one worth recording is why it
> had gone unseen: the first pass *filtered* the gap list with
> `grep -E '^v0\.9\.(3[8-9]|[4-9][0-9])\.'` — a pattern whose **trailing `\.`
> demands a dot that no real tag has**, so it could never match anything, and it
> answered "none" while `v0.9.86` sat in plain sight in the list it had just
> built. **Print the entire gap; never filter it with a pattern you have not
> proven can match a real entry.** A filter that cannot match is not a negative
> result — it is a broken instrument, and it is indistinguishable from good news.
> Census now: **89 tags, 58 Releases, 31 unreleased**, every one of the 31 still
> pre-decree — the composition unchanged from the entry above, which is the point.

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

- **Runner**: vitest, `tests/` root. **374 `.test.js` + 9 `.test.jsx`** (unit 336 · translator 27 (19 + `real/` 8) · contract 10 · auth 1). Canonical invocation: `npx vitest run -c tests/vitest.config.js` — there is no root config and no `test` script, and without `-c` the `@/` alias dies.
- **⚠️ NEVER claim "full suite green".** The repository has none to claim — v0.9.45 measured 40 failing files / 97 failing cases at pristine HEAD over `tests/unit`, `known-fails.txt` covers 9, and the **2026-09-19 re-measure at `e4e013ad`, run over the whole suite in an isolated worktree, found 112 failing cases** — while a **2026-09-20 re-measure scoped to `tests/unit` alone** (the v0.9.71 port tide's own diff, same protocol: pristine worktree at `e4e013ad`, `npm ci` from the committed lock, identical invocation) measured **41 files / 98 cases at pristine → 40 files / 96 cases in the ported tree**, with **zero** failing names attributable to the port and `tests/unit/kiro-terminal-integrity.test.js` the single file the tide returned to green. **Name the scope whenever a count is quoted** — those two figures are `tests/unit` only; the 112 above is the whole suite, and comparing them without saying so is the drift this bullet exists to prevent. **Re-baselining `known-fails.txt` to make a gate pass is forbidden.** The gate is an **explicit storm file list** plus a **blast-radius diff** against pristine HEAD in an out-of-repo worktree (compare failing test *names*, never counts — and strip durations, since a duration difference is not drift).
- **Isolate the strays before blaming your own change.** A blast-radius diff will surface names that appear **only under full-suite load**. 2026-09-19: three names (`s3-offsite`, two `xai-oauth-service` cases) failed in the ported tree but not at pristine — and **passed 15/15 when run alone**, and had passed in an earlier full run of the *same* tree. Both suites touch `undici` mocking; the load is the variable, not the diff. Re-run the strays on their own; report "flaky under load, zero attributable" instead of either hiding them or chasing them.
- **Producer coverage, not just consumer.** A suite that injects a literal dependency object proves the *consumer* and leaves the *producer* uncovered — `fallback-rules-seam.test.js` stayed green for five minors while `bindFallbackRules.js` was broken in production, because every block handed `handleComboChat` a fake repo and none imported the binder. Its header even *claimed* to cover the binder. For every binding/factory/accessor module, verify some test actually imports it.
- **A permissive mock is what hides a broken binding.** New producer suites must drive the **real** adapter against a **real** migrated DB (per-test `DATA_DIR` + `vi.resetModules()` in *both* hooks — see the DB-harness trap), then be **mutation-tested** in every direction they claim to cover. Each mutation must land on exactly the test that claims the property.
- **DB-harness trap** (crystallized): `paths.js` freezes `DATA_DIR` at first import AND `driver.js` binds `global._dbAdapter` once at module eval, so `delete global._dbAdapter` alone never rebinds — an earlier test's SQLite handle stays open and Windows `fs.rmSync` dies with EPERM. Evidence is orphaned temp dirs holding `data.sqlite-wal`.
- **sql.js caution**: the WASM adapter has a small default heap — give each test its own temp `DATA_DIR`/adapter, or force the native driver via `VELA_DB_DRIVER`.
- **Migrations are tested on the crash driver**: `key-acl-migration-013.test.js` boots **sql.js** (the Docker runner's fallback) and proves the chain runs — the regression that caught the `db.prepare` bug.
- **Docker guards**: `dockerfile-mysql2-closure.test.js` keeps the mysql2 closure COPY lines alive.
- **Porting an upstream wave — three gates, in this order** (learned at v0.9.71, the 94-file wave). A suite cannot cover a file no test imports, so two of these gates are not tests at all:
  1. **Parse sweep** — push *every* file the tide touched through a real parser (`esbuild.transformSync(src, { loader: "jsx" })`, one file at a time). A merge between two harbours that both edited the same file breaks in exactly two shapes, both invisible to `grep` and to unimported-file suites: **an orphaned block tail** (upstream turns `const fn = useCallback(async () => { … }, [deps]);` into `const fn = async () => { … };` and the old `}, [deps]);` is left behind) and **an unclosed conditional** (`{cond && (` whose `)}` never crossed). 2026-09-19: `OAuthModal.js:463` and `QuotaTable.js:190` — found by the build, not by 363 test files. Sweep `git status --porcelain -uall` (the `-uall` matters: untracked directories are otherwise handed to the sweep as one path).
  2. **Presence check** — for every file taken, collect the lines upstream **added** in the range and look for each in our tree. Misses are always one of: a documented reconciliation (ours deeper, with the reason in a comment), a comment rewrite, a formatting dialect, or **a real silent miss**. Name every one; a bare count of "files taken" proves nothing about what landed inside them. Normalize by **stripping all whitespace** — collapsing runs to a single space still flags `"k": "v"` against `"k":"v"` and manufactures false positives.
  3. **Declaration check** — the same file's top-level `function`/`const` names must exist in ours or have a named counterpart. This is what catches a renamed-but-equivalent module (`cloakOpencodeTools` → `cloakChatTools` + `concealFingerprintTools`) without pretending the diff is clean.
  Only then run the build and the suites — the build is the last gate, not the first, but it is the one that *compiles the app*, so a green build after a 90-file port is the strongest single proof the tide can give.

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
#    The tracked chart's pin is GUARDED: `tests/unit/docker-compose-pin.test.js`
#    fails if it drifts from package.json, and asserts docker-compose.yml stays
#    gitignored. Skipped once (v0.9.75) before the guard existed — the five
#    tides before it all matched, so the rite was sound and only the instrument
#    was missing. Run that suite before you tag.
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
| **v0.9.88** | **The Keyring Manifest** 🗝️ | One room had been answering five questions at once and charging every visitor for all five. The keys card - a single scroll carrying posture, inventory, filing, cost and the acts that change them - is now a **manifest with one data current and four lenses**: masthead (the census, the require-key gate, four fleet acts) · rail (how it is filed) · toolbar (what am I looking at) · **Cards/Table** lenses · detail drawer · bulk bar. All of them read one `useKeyDeck`, so **no lens can hold a private opinion about a key's posture** - which was not true before, when the row and the delete button each carried their own copy of the confirm. Four new doors: `GET /api/keys/stats` (the census computed server-side **once**, so page, API and any future client cannot disagree on what "expiring" means) · `GET /api/keys/export` (**the fleet's SHAPE, never a credential** - keys are hash-at-rest and show-once, so the plaintext cannot leave even in principle; the row is enumerated through `redactKeyForExport` rather than spread, so a column added later cannot ride out) · `POST /api/keys/import` (even this harbor's own file is untrusted, through an `IMPORTABLE` allowlist; conflicts answer to `skip`/`overwrite`/`rename` by name) · `POST /api/keys/bulk` (200 items, one door, per-item verdicts). Five routes, one set of laws in `_lib/keysApi.js`. **And the wound v0.9.82 recorded is closed**: the shared `Input`/`Select` destructured `required` and never handed it to the element, so the red asterisk was a promise the browser never kept and native validation stayed disengaged on **every** form - the attribute is now spent on the control and the asterisk is `aria-hidden`, announced once by the element that carries it. **Proven, not asserted**: a throwaway probe drove all four doors through `dashboardGuard.proxy` - remote-no-credential **401** on each, local-with-machine-token passes on each, `requireLogin=false` byte-identical to `/api/keys`, and the CSRF lock still refusing a cross-site mutation on `/bulk` - 5/5, then released. **The build caught what no parser could**: ten files rooted `../lib/` from `components/keys/` where the law sits `../../lib/` - a parse sweep is green on a mis-rooted specifier. **Proof**: build green 128s · 18 new files (2,700 lines) parse-clean · 64 specifiers resolved by a **self-tested** scanner · eslint 0 · 7 suites / 104 cases green |
| **v0.9.87** | **The Closing Gate** 🔒 | Five gates stood open and every one was a name somebody forgot to add, so the naming stopped and the classes closed. `CLI_TOOL_WRITER_RE = /^\/api\/cli-tools\/[a-z0-9-]+-settings$/` closes **thirteen** home-writing routes by shape (a list of names guarantees the fourteenth is forgotten) - each writes `~/.claude/settings.json`, `~/.codex/config.toml`… with caller-shaped content, so a caller arriving through a tunnel could edit the box's own agent configuration - plus `/api/pxpipe/{install,start,stop,restart}` (each spawns or kills a host child) and the two headroom entries missed while their siblings were named. `PATCH /api/settings` stopped mass-assigning (**CWE-915**): it stripped two secrets and handed the rest of caller JSON to `updateSettings`, and settings is a **trusted store** - a planted `outboundProxyUrl` silently re-routes every upstream call; the writable roster is **derived** from `DEFAULT_SETTINGS` plus nine located keys, undeclared keys dropped loudly. The login gate stopped answering anonymous callers with the operator's own `tunnelUrl`/`tailscaleUrl`. The proxy-test probe was **its own SSRF** and now refuses with **422, never 400** - 400 sits inside `DETERMINISTIC_FAILURE_STATUSES`, so a refused pool would have classified DEAD and been disabled (the v0.9.42 self-liquidation class, new trigger). **And the instrument was found unplugged**: `docker-compose-pin` was **red** at HEAD - `package.json` said 0.9.86 while both charts and both lockfile lines still said 0.9.85 |
| **v0.9.86** | **The Fleet Console** 🌊 | The providers page was five stacked sections of fifty disconnected tiles - to learn whether anything was unwell you scrolled a page four times. It is now a **console**: a health strip (healthy / degraded / cooling / down, derived from `isActive`, `testStatus`, `lastErrorType` and the model cooldown locks) that answers *is anything broken* before a row is read; then **one scan line** - provider, auth, model count, live activity, status, last error, routing priority - replacing five sections and four scrolls. The 60s activity meter is funded by the already-memoized `getPerProviderFrame()` through a new `GET /api/usage/providers/activity` (**one request for the fleet** - a per-row fan-out would have been fifty requests and a throttle risk on the metrics rail); model counts ride one `/api/models` call grouped client-side; the old three per-section "Test All" buttons collapsed to one. The rail gained the motion its compaction was missing - labels rise 4px as it opens, each following the one above it on the `--rail-stagger` cadence, with the delays in the open rule rather than the base one, so arriving is the ceremony and leaving is not |
| **v0.9.85** | **The Compact Rail** 🌊 | The desktop sidebar was a fixed 288px - a fifth of a 1440px deck spent on chrome read once per navigation. It is now a **rail**: 76px of icons at rest, expanding to the full 288px on hover **or** keyboard focus (`:focus-within`), so the labels cost a pointer nothing and are never withheld from a keyboard. It is **compaction, not disclosure** - every label stays in the DOM at every width, hidden with `max-width: 0` + `opacity`, never `display: none`, so a screen reader reads the full nav with no pointer and the rail rightly claims **no `aria-expanded`**. **Desktop only**, because hover does not exist on touch: below `64rem` the rail IS the full sidebar, the same breakpoint the shell already uses to pick the mobile drawer. The section headers ("Gateway", "Analytics") become short centred hairlines at rest, which is what keeps the rail reading as grouped sections. `--rail-width` · `--rail-width-expanded` · `--rail-label-max` minted on `:root`. The logo holds the axis (left 20 → centre **40**, measured equal to the icon column) and carries `shrink-0`, because flex was quietly shrinking the 40px mark to 35px inside the 75px brand box. Live: rest **76** / hover **288** / blur **76**; 15 routes land on their own href; Media `0 → 6` and Proxy `6 → 10` on click; 375px `docW = winW`; reduced-motion still reaches 288 without the slide; console clean |
| **v0.9.84** | **The Ledger Spent** ⚙️ | v0.9.83 minted the `--motion-*` ledger and welded the deck to it - and the ledger had **no spenders**: a `duration-*` class cannot reach a custom property, because Tailwind v4 declares no `--duration-*` namespace (verified against the installed 4.3.3 `theme.css`, which carries `--ease-*` and `--animate-*` and nothing else). So **126 files** spoke Tailwind's own ladder - `150/200/300/500ms`, a dialect with no relation to this file's `120/180/320/560` - and the deck arrived at 320ms while every hover answered at 150. Three rungs now bind them: `.motion-control` (INSTANT - hover, press, focus) · `.motion-enter` (QUICK - a popover or drawer arriving) · `.motion-fill` (BASE, the one place geometry animates **on purpose**). The login gate carries no Tailwind ladder at all, so its bespoke `0.5s` stagger and three `0.15s`/`0.3s` flips now ride the tokens too. **Live measurement caught a third false claim, in my own mend**: the dot's comment paired `7.64:1` with `#1a1a1a`, and neither held - the gate's `::before` sky gradient is **opaque and paints over the page**, so the dot never touches `--color-bg`. The browser then showed the fill as `rgb(34,197,94)`: `--color-success` is declared **twice** (`#10B981` light, `#22c55e` dark). Set right: `#22c55e` on the gradient - **8.34:1** crown, **7.92:1** footer. **Proof**: `deck-motion` + `globals-css-tokens` + `docker-compose-pin` → **71 cases green**; 127 touched files parse-swept clean; `eslint` 172 findings in touched files, **0** on a line this tide wrote |
| **v0.9.83** | **The Deck Assembles** 🌊 | Twenty-nine rooms each simply appeared. One `--motion-*` token family on `:root` plus a single `deckEnter` keyframe now gives the whole deck an entrance - welded into the shell's content wrapper and keyed on `pathname`, because a CSS animation runs on MOUNT and React would reuse the same `<div>` across a route change (**no page file was touched**). Two child selectors cover the two page shapes (twelve routes return a single root element, where `> *` would match one node and sequence nothing). **The stillness wound**: the `prefers-reduced-motion` block clamped `animation-duration` but **not** `animation-delay` - so a user who asked for stillness watched each block sit invisible at `opacity: 0` for its full delay; the animation was gone, the **waiting** was not. Both delays now clamp, and `0ms` was struck from the choreography. **Proof**: `deck-motion` **22 cases**, the load-bearing one being `backwards` **never** `forwards`/`both` - a filled animation leaves `transform` live forever, making the wrapper a containing block for the **29 `<Modal` mounts** that render `fixed inset-0` with no portal to escape through; measured live (settled → every sequenced element `transform: none`, a real modal's backdrop spans the full 1440×900) |
| **v0.9.82** | **The Harbor Gate Reborn** ⚓ | The gate was beautiful and broken in one quiet place: `.login-constellation` was `position: absolute` with **no offsets**, so it never left the flow - the coral sail-lines were drawn straight across "forty-plus upstreams" and the feature rows. A panel with no berth. `.login-berth` (relative, 288px) now anchors it (header ends 275 · chart begins 307 · features begin 659). The square graph-paper grid is gone, replaced by a **celestial chart** (orbits + spokes), an aurora current, a horizon arc, and one rare shooting star - all declared in CSS, never inline. Every login colour became a `--login-*` token (`docs/design/login-tokens.dtcg.json`), and **both contrast ledgers cleared**: CTA `3.23:1 → #c04e30 4.80:1` · field border `1.19:1 → 3.47:1` · 11px footer `2.52/3.37:1 → 4.65/6.86:1` · the shared `Input`'s own error slot overridden **login-scoped** rather than editing the shared component; five em dashes swept from rendered UI text. **Recorded, not hidden**: the shared `Input` destructures `required` and never spreads it, so native validation never engages on **any** form (pre-existing); the app-wide white-on-`brand-500` CTA ratio still stands outside the gate |
| **v0.9.77** | **The Muster Roll** 📜 | v0.9.76 laid the ledger's keel; this tide brought it to life — **one writer per surface** (`sessionLedger.js` records the row from all three mint paths: password login, SAML ACS, OIDC callback; `authAudit.js` the trail; `authStoreRepo.js` + its SQLite harbour the store) and **the durable ladder** (`loginLimiter.js` +182 keeps the escalation and the fixed window in `authFailures`, one row per caller key, so a lockout survives a restart, a redeploy and a second process — the public contract stays **synchronous**, resolving the store with `getAdapterSync()`, never `getAdapter()`, because opening a harbour as a side effect of an import is a wound, not a feature). **Sessions with names, and a way to strike them**: `createDashboardAuthToken` mints a `jti`; the verifier consults the ledger *after* the signature proves the token is ours; `GET /api/auth/sessions` lists every seat (own flagged/revoked rows shown, exhausted pruned on the read path), `DELETE /api/auth/sessions/[id]` kills one and clears the cookie when the caller strikes their own, `POST /api/auth/sessions/revoke-all` is logout-everywhere with `keepCurrent` — all three in `ALWAYS_PROTECTED`, because a session list is reconnaissance and a revocation is a kill switch. **The trail** is metadata-only **by construction**: a key that even smells of a credential is dropped, strings truncate at 200, the encoded detail caps at 1,000. **The proof was lying, and the run's own output said so** — the 016 suite's first case mocks *both* native adapters away to exercise the sql.js crash driver, and vitest keeps `doMock` registrations for the whole **file**, so every later "native" case fell through to sql.js and returned early at its guard: three wounded runs looked green against a proof that never executed. Mended with `liftNativeAdapterMocks()` in `bootNative()`/`reboot()`, the silent guard replaced by a loud `expect(adapter.driver).not.toBe("sql.js")`. **A dialect limit found by reading**: the durable arm is SQLite-posture-only (`upsertFailureRow` writes SQLite's `INSERT … ON CONFLICT … excluded.*`, which MariaDB does not parse, and the mysql adapter's run/get are async while this limiter is sync) — the header now says so and names the mysql twin + binder as the owed wave. **Proof**: auth+guard sweep **9 files / 85 cases green**; the durability case mutation-tested both ways (deleting the veto reddens **exactly one** case — 1 failed \| 6 passed — and restoring it returns 7/7); `npm run build` green; `eslint` exit **0** unpiped across twelve files. **Owed**: A7's login-page rebuild, then Design B's motion across 35 surfaces. |
| **v0.9.76** | **The Second Lock** 🔐 | Three crossings, all about **what a gate says when it fails**. **The session ledger's keel** — migration `016-auth-sessions-audit` lays three tables (`authSessions` keyed by the JWT's own `jti`, so a stateless token finally has something to list and to revoke; `authFailures`, the limiter's durable ground; `authAuditLog`, what the gate decided and when), built from `TABLES` so the versioned chain, the additive auto-sync and the MariaDB twin's bootstrap diff cannot drift into three dialects; `SCHEMA_VERSION` 15 → 16. **The CSRF second lock** — a request the browser itself labels `sec-fetch-site: cross-site`, carrying a mutating method, is refused **403 at the top of `proxy()`**, above every auth branch: placed below the `ALWAYS_PROTECTED` branch it would have left `/api/backup`, `/api/shutdown` and `/api/usage/views` — the routes most worth forcing — leaning on SameSite alone. Its exemptions are named, never positional: `/api/auth/saml` and `/api/auth/oidc` (an IdP posts a signed assertion cross-site *by protocol*, and the assertion is the credential), the LLM prefixes (`/v1`, `/v1beta`, `/api/v1`, `/api/v1beta`, `/codex`, `/responses` — browser clients call the gateway cross-origin on purpose, bearing a bearer key), every safe method, and any caller sending no `Sec-Fetch-Site` at all (curl, the CLI, another agent). **A 500 no longer describes its own shape** — `/api/auth/login` (a PUBLIC path) and `/api/auth/reset-password` returned `error.message` verbatim to an unauthenticated caller; both now answer one stable line and send the detail to `console.error`, where `consoleLogBuffer` keeps it readable to the operator. **Proof**: `auth-error-hygiene` + the standing login queue → **5 files / 50 cases green**; the 016 chain reaches v16 on **sql.js** — the driver that once caught the `db.prepare` boot-storm — → **2 files / 8 cases green**; `csrf-second-lock` + `dashboard-guard` + `proxy-storm-security-gate` + `local-request-peer-trust` → **4 files / 107 cases green**; `eslint` exit **0**. **Recorded**: `dashboardGuard.js` lives at `src/dashboardGuard.js`, not under `lib/auth/` — a chart that misplaces a gate sends the next keeper to the wrong shore. |
| **v0.9.75** | **The Four Lenses** 🔭 | Two rooms watched one fleet through their own slits — `dashboard/proxy-pools` (1116 lines) held every pool, `dashboard/proxy-fitness` (357 lines) every block — and neither could answer a question that needed both. Now one console at **`/dashboard/proxy`**: four lenses over one shared current (`useProxyFleet`) — **Fleet** (every CRUD/test/toggle/delete/batch-import/bulk the old page had, preserved not rewritten) · **Fitness** (block ledger, clear-one/all, filters, geo toggle) · **Egress** (per-pool IP/country/flapping/ipHistory — new) · **Relay** (three edge deploys as first-class rows + forms — new). Both old routes kept as redirects. **Two wounds closed**: `handleHealthCheck` fired one client `/test` per pool — now **one** bulk POST (pinned: 1 bulk POST, 0 per-pool `/test`); and a probe yielded two states — now **three** (`ok`/`dead`/`indeterminate`), only a **proven-dead** pool offered for disable, `indeterminate` reads *"unknown, left active"* (pinned: PUT for dead, NONE for unsure). The census is **count-only by construction** (`GET /api/proxy-pools/stats` spreads counts only, so no `proxyUrl` can cross; a thrown dependency returns 500, never a zeroed census). **The build found what no test did**: `buildUsageMap` exported from a Next route module failed `next build` ("incompatible with index signature") → moved to `src/lib/network/poolUsage.js`. The endpoint room's private `TabBar` promoted to `src/shared/components/TabBar.js` (recorded as an **83% rename**). **The golden ledger brought current**: v0.9.74's nineteen docks were never snapshotted → regenerated, **494 insertions / 0 deletions**. **The eslint sweep found a wound of my own**: the sidebar's route-aware accordion opened with `setState` inside an effect → React's documented render-phase adjustment. **Proof**: 343 cases across the seven proxy suites, 0 eslint errors, `next build` green at 157 pages; full suite **110 failing, down from 148** — the 38 that closed are exactly the regenerated golden cases, and stashing this tide reproduces the **identical 38 of 38** at pristine HEAD. **Honest gap recorded, not papered over**: the four tab labels are not in the locale files and were **not** machine-translated into 34 languages; the seeder (`scripts/i18n-seed-literals.mjs`) is absent at HEAD, so `translate()` returns the raw English key — exactly what an English-first placeholder renders. |
| **v0.9.74** | **The Sibling Harbor** 🌊 | Four gateways read to the bedrock — **two kin, two strangers**, and the strangers held nothing we lack (13 of SRouter's 14 capabilities already live here more maturely; AMRouter's account-farming automation refused on **covenant** grounds, not effort). From the sibling 735 commits diverged: **nine mechanisms ported** — `classify429` (one 429 becomes three truths; a *daily* exhaustion had been cooled for **seconds**, because "daily quota exceeded" matched the generic "quota exceeded" text rule, so a dead-until-tomorrow account was retried all day) · `cooldownRetry` (all accounts cooling → wait ≤30s, retry once, no 503) · `loopGuard` + `terminationPrompt` (Kimi-gated, riding the existing injector seam) · `kimiToolParser` · `clinepassEnvelope` + `coercedSseHandler` · `accountSemaphore` + `providerProfiles` (bounded queue, every drop counted) · `claudeHeaderCache` (real client headers replace a fabricated `claude-cli/…` UA; credential deny-list, no value ever logged) — plus **19 provider docks** wired into `registry/index.js` and proven reachable through the runtime `PROVIDERS` map, **`refreshBlocked`** (a dead OAuth token had been retried on **every tick, forever**; gated to hard auth failures only, lifted on success), and **`DATA_DIR` test isolation**. **Three proposed items were refuted by measurement before they could enter the plan**: `circuitBreaker` (we have `src/lib/network/circuitBreaker.js`), the Claude `cache_control` splice (we already splice before the last cache block at `rtk/systemInject.js:240` — and ours carries a `position` param theirs lacks), and `context_window` (we already emit `context_length` + `max_completion_tokens`). **Proof**: **217 new tests across 12 suites, green together**; `tests/unit` measures **40 files / 97 cases against the same 40/97 baseline**, with passing cases **3308 → 3525** and files **282 → 294**. `a6api` shipped **against the Keeper's counsel** by the Star's word (affiliate referral params stripped; dissent and override both recorded in the plan) |
| **v0.9.73** | **The Harbor Manifest** 📜 | The combos page rebuilt as an operator's flight deck (**26 new files**: masthead · fleet pulse · category rail · Cards/Table lenses · detail drawer · bulk bar) over **four new routes** — `stats` (one server-computed census: llm-only vs all-kinds, harbor tree, attention, idle), `bulk` (per-item verdicts; collisions refused by name), `export` (`vela-combos` v1, strategies for exported names only), `import` (**dry-run writes nothing**; `skip/overwrite/rename`; strategies only for names that landed). Icon subset **232 → 240** (the 8 glyphs the new controls asked for), font re-minted 181,204 → 184,384 bytes. **Proof**: `tests/unit/combos-fleet-api.test.js` (9 cases, real migrated SQLite) is mutation-tested — wounding the dry-run early return reddens **exactly one** case (1 failed / 8 passed), restored → **9/9**; the rendered-text contract suite stayed green **8/8** through a complete page rewrite; `npm run build` green |
| **v0.9.72** | **The Returning Key** 🔑 | A secret rotation was a **lockout**, not a revocation: `resolveKey` admitted a bearer only through the strict crc parser, so every stored key died at the door — the row never read, its sha256 never consulted — and the documented rotation-grace branch (`rotationPrevHash`/`rotationGraceUntil`) was unreachable. Split the parser by purpose (`parseVelaKeyShape` = the resolve gate; `parseVelaKey` keeps the timing-safe crc for mint-time checks), wired **both twins**, corrected two false claims in place. **Proof**: the new suite is red without the fix (`validateApiKey … Expected true, Received false`, `apikey-rotation-grace.test.js:66`) and green with it — 3/3; the key+guard sweep ran **23 files / 341 cases, 340 pass**; its one shadow (`apikey-migration-002`'s p99 SLO) passes **9/9 alone both ways** — 4.11s with the fix vs 4.24s pristine — and `executor-const-guard` reproduces identically at pristine |
| **v0.9.71** | **The Far Current** 🌊 | 32 commits / 94 files risen in the upstream sibling harbour (`73cb8914…a8c9d380`, v0.5.75 → v0.5.81) — **90 taken, 4 refused by name**. Claude Code's auto-compact window + 1M toggle · DeepSeek-V4.1-Flash with declared `vision`/`thinkingEffortSupported` · Persian (9th locale) · in-band abort reporting after HTTP 200 · CommandCode ×5 · the OpenCode family ×6 (incl. one stable session per identity) + `opencode-go`'s `/responses` executor · Kiro name/image restoration · Antigravity billing-header + signature-family · Zed's four suites · `codex-auto-review` routing · 4xx ≠ dead account · DeepSeek credit + gateway-scoped catalog sync + MiMo tracker. **Proof**: 26 ported suites = 270 cases (266 pass, 4 `it.fails`), 0 fail; blast-radius diff vs pristine `e4e013ad` = 112 → 113 failing cases, the 3 strays flaky under load (15/15 alone), zero attributable |
| v0.9.53–v0.9.70 | 17 tides, named in the log — 🖋️ The Signature Ledger · v0.9.55 ⛵ The Content-Hashed Glyphs · v0.9.56 ⛵ The Early Signal · 🍊 The Jerouter Ascension · 🌊 The Open Ocean · ⛵ The Crowned Mast · 🎨 The Single Mast · 🔤 The Honest Glyphs · 🩹 The Proven Wounds · 🧵 The Sanitized Stream · ⚿ The Versioned Gate · 🧭 The Watchman's Deck · 📡 The Telemetry Deck · 🧹 The Swept Keel · 🏮 The Alias Lantern · ⚿ The Quartet's Case · 🗂️ The Five Rooms | **This table was not maintained through these tides** — their full entries live in `CHANGELOG.md`, which is the authoritative log. Recorded here as the gap, not re-summarised from memory: name a version from the log if you need its story. (There is **no v0.9.54** — the log jumps 0.9.53 → 0.9.55.) |
| **v0.9.52** | **The Quiet Deck** 🎨 | W6 — final wave of the upstream divergence closure: mask clamp, connection-test timeouts, CommandCode + cursor error honesty (NEW suites), beta forwarding, mode label, list scroll cap |
| v0.9.51 | The Quota Fleet 📊 | W5 — NEW zed/glm/opencode-go/groq trackers, Claude Fable rows + quota dedup, Codex-Spark windows, antigravityQuota service |
| v0.9.50 | The New Shores 🗺️ | W4 — Xquik + ollama-search providers, zai-search folded into GLM, Antigravity searchViaChat, Ollama Cloud fetch, headroomTimeoutMs, Grok CLI bulk import |
| v0.9.49 | The New Models ✨ | W3 — Gemini 3.8 tiers, GLM-5.3-Flash vision, DeepSeek V4 Flash Vision, Grok 4.6, GPT-5.6 image aliases, muse-spark responses-only, qoder/codebuddy-cn catalogs |
| v0.9.48 | The Mended Streams 🩸 | W2 — 16 correctness fixes: Ollama NDJSON tail, finalizeStream idempotency, cached_tokens shapes, NATIVE_ONLY thinking, hardened systemInject, Claude set (Fable 5.1, defer_loading anchors, foreign server_tool_use, 2.1.258, [1m] strip) |
| v0.9.47 | The Sealed Gates 🔒 | W1 — SSRF guard hardening (IPv6 hextets, FQDN dots, CGNAT, DNS layer, redirect re-validation), cowork probe guard, root /responses auth, 503 on all-rate-limited, node-machine-id bundled |
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
