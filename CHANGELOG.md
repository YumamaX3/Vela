# ⛵ Vela — The Ship's Log

> *Every tide leaves its mark on the log. Features set sail ✨, storms are
> weathered 🐛, the ship is refitted 🔧, and the charts are drawn 📖.*

**The Versioning Covenant** — the harbor never ships without a version. Every
change, great or small, bumps `package.json` and earns an entry in this log,
sealed together in the same commit:

| Tide | Rule | Example |
|-|-|-|
| **Small change** 🐚 | the last number ticks up by one | `0.6.03 → 0.6.04` |
| **Big change** 🌊 | the last number rounds up to the next milestone of ten | `0.6.03 → 0.6.10` · `0.6.93 → 0.7.0` |

When a big change rounds past `.99`, the carry flows into the middle digit
(`0.6.93 → 0.7.0`). The first digit carries the same way at the harbor's
edge (`0.9.x → 1.0`). Versions carry two digits in the last place —
`0.6.01`, `0.6.02` — npm accepts this for a private package.

**Legend**: ✨ Features · 🐛 Fixes · 🔧 Changes & Improvements · 📖 Documentation · ⚠️ Breaking · ⚙️ Internal

> *Releases below v0.6.0 were sealed under the upstream name **9Router** —
> this harbor is a pristine clone, rebranded Vela on 2026-08-13. The log
> keeps their names as they were.*

---

# v0.6.80 — The Charted Harbor & The Lifted Shadow 🗺️💰⛵

> *"A ship without charts is only drifting. So every deck is drawn — the
> hull, the keel, the rigging — in eleven tongues. And the ledger stops
> lying: every sail's true cost is named, and eleven thousand rows of
> silence remember what they were worth. And by the Star's decree, every
> free sail now carries its paid sibling's worth."*

*Sealed 2026-08-16 · the Star's decree · Milestone Tide: big change → `0.6.70 → 0.6.80`*

## 📖 Documentation — The Docs Forge

- **README.md reforged** — the Vela flagship: banner + wordmark, badge row,
  architecture diagram, Why-Vela matrix, key features (routing, resilience,
  cost intelligence, RTK saver, Storage Covenant), three quick-start paths,
  docs table, repo map, provenance & license
- **`docs/` site born — 9 new charts** + hub: `README.md` (harbor map),
  `ARCHITECTURE.md` (request lifecycle + mermaid, translator engine,
  provider registry, executors, combos, RTK, DB layer, mirror machinery,
  backup engine, pricing covenant, security), `DEPLOYMENT.md`,
  `ENVIRONMENT.md` (the full env contract), `STORAGE.md`, `PROVIDERS.md`
  (the 129-provider fleet roster), `API.md`, `TROUBLESHOOTING.md`
- **CLAUDE.md rewritten** — the crew's papers, aligned to the current
  architecture (SQLite layer, storage postures, Docker mysql2 closure,
  the tests-suite-is-not-all-green truth)
- **DOCKER.md reforged** — GHCR image, volumes, the split compose chart
  (example/live), storage postures in Docker, Headroom sidecar, upgrades
- **10 locale READMEs fully translated** — zh-CN, id-ID, ja-JP, vi, pt-BR,
  es, fr, ru, th, fa_IR — structure-identical to the flagship
- `VERSIONING.md` aligned to the main-branch decree; `.env.example`
  re-headed Vela; every claim in every doc verified against the code

## 🐛 Fixes — The Pricing Shadow ($0 est-cost)

- **Root cause** — cost is frozen into `usageHistory` at WRITE time; models
  with no pricing entry resolved `null` → $0, forever
- **Qoder lane priced** — every opaque subscription-lane id
  (`qmodel_38max`, `qmodel`, `dfmodel`, `mmodel`…) now carries its base
  model's retail-equivalent rate in `PROVIDER_PRICING` (the header promised
  qoder estimates but shipped none). Tier selectors honestly stay unpriced
- **Mistral `-latest` aliases** — 14 exact `MODEL_PRICING` entries so
  `mistral-large-latest` and kin resolve their pinned models' rates
- **Ollama `:` separators** — `gpt-oss:120b` / `gpt-oss:20b` exact aliases
- **Honest display** — `formatCost` + the Usage table / overview cards now
  show `<$0.01` for sub-cent dust instead of a lying `$0.00`

### The Free-Sibling Decree (the Star's word, 2026-08-16)

- **Every free model carries its non-free sibling's price.** FREE
  inheritance (`FREE_ALIAS_MAP` + guarded `-free`/`:free` suffix-strip +
  namespaced tail) previously resolved siblings through EXACT strata only —
  so a free model whose paid sibling existed only as a family pattern
  inherited nothing. It now resolves the sibling's WORTH through the full
  non-recursive chain: lane override → exact → vendor-strip → family pattern
  (`resolveSiblingRate`). Denylisted shapes stay null (no paid sibling
  exists — honest). `ProviderTopology`'s "9Router" label → Vela.

## ⚙️ Internal

- `scripts/backfill-usage-cost.mjs` — one-shot, dry-run-safe ledger repair:
  re-prices historical cost=0 rows against the current chain and rebuilds
  affected `usageDaily` rollups (schema-adaptive; single transaction).
  First run: **11,786 rows re-priced, $1,054.86 recovered**
- `tests/unit/pricing-shadow.test.js` — regression pins (qoder lane, mistral
  aliases, ollama separators, honest formatCost); 34 pricing tests green

---

# v0.6.70 — The Sealed Vault & The Mirror's Pulse 🗝️🪞⛵

> *"A backup never restored is a hope. So the vault seals itself in
> AES-256-GCM, drills its own artifacts open, and ships its sealed bytes
> off-site under SigV4. And the mirror stops being a promise — outbox,
> pump, watermark, sweep: the twin harbors beat with one pulse."*

*Sealed 2026-08-16 · the Star's decree · Milestone Tide: big change → `0.6.60 → 0.6.70`*

## ✨ Features — Storage Covenant Waves B + C

### Wave B — the sealed vault (the backup engine)

- **Encrypted artifacts** — `VELABAK1` format: scrypt (N=2¹⁷/r=8/p=1) from
  `VELA_BACKUP_ENCRYPTION_KEY` (env-only, min-entropy check), per-artifact
  salt + IV, AES-256-GCM with the auth tag verified BEFORE any restore step.
  Secret-file bundle (jwt-secret, api-key-secret, machine-id) rides inside;
  restore returns `restartRequired`. Artifacts written 0600.
- **The scheduler** — `VELA_BACKUP_ENABLED` + interval + retention tiers
  (newest per day for `retainDaily`, per ISO-week for `retainWeekly`).
  Usage purge runs AFTER the backup so purged rows live in the artifact.
- **Restore + drill** — schema-compat gate, pre-restore safety backup,
  restore into the live posture; and the RESTORE DRILL: decrypt the newest
  artifact into a scratch sqlite DB — "a backup never restored is a hope."
- **The dashboard card** — `/api/backup/{run,list,status,restore,drill}`
  (session + ALWAYS_PROTECTED) behind the profile page's BackupCard.

### Wave C — the mirror's pulse (+ fleet)

- **The outbox + replay classes** (C1–C2) — migration 006/007; a decorator
  captures every classified writer as one outbox row (identity-carrying
  captures the GENERATED id, never the key — S3).
- **The pump** (C3) — seq-ordered drain against the twin, poison policy
  (quarantine, never block), boot catch-up drains the outage backlog.
- **Divergence sweep + usage-resync** (C4) — engine-agnostic fingerprint
  (order + PK independent), drain-window guard (pending outbox = lag, not
  drift), watermark usage-resync (forward-only cursor), full-resync with the
  twin's own secrets stitched back over the S2 sentinels.
- **The mirror bind** (C5) — `VELA_DB_MODE=mirror` binds the sqlite PRIMARY
  behind the decorator; startup arms pump + resync + sweep; a down twin
  degrades the mirror, NEVER silently downgrades the mode.
- **S3 off-site** (C6) — pure SigV4 signer (pinned byte-exact to AWS's own
  docs example), undici transport, opt-in, FAIL-OPEN (the local artifact is
  the truth), credentials env-only, uploads only the SEALED bytes + a rolling
  `latest.velabak` alias for the boot-strap restore pattern.
- **The fleet leg** (C7) — the Dockerfile carries mysql2's FULL runtime
  closure (10 packages — the dynamic import the file-tracer can't follow);
  `scripts/docker-smoke-mysql.sh` boots `VELA_DB_MODE=mysql` against a
  throwaway MariaDB; a local test guards the closure so a future mysql2 dep
  bump can never silently break the image.

## ⚙️ Internal — the proving tide

- **S1–S4 security laws** — restore is a trust crossing (schema-version +
  size bounds before any write); `SECRET_SETTING_KEYS` redacted to
  `[REDACTED]` in every export; the outbox excluded by name with args
  redacted + 7-day age-out; the backup routes ALWAYS_PROTECTED.
- **The parity twin proved live** — mirror pump + sweep legs ran against the
  real MariaDB twin behind the double opt-in (drift-injection → sweep flags
  → resync restores — proven in both sqlite and live legs).
- **Regression discipline** — every wave sealed against a before/after
  failure-set diff; the inherited debt (~100 pre-existing failures) unchanged,
  zero covenant-attributable regressions across all seventeen waves.

*Waves B1–B4 + C1–C7, fourteen commits: the Storage Covenant
(`plans/storage-covenant.md`) is COMPLETE — A1 → C7, every line sealed.
The fleet chart rides the new image; the vault keeps the ship's soul.* 💜

---

# v0.6.60 — The Twin Harbors 🌊🗝️⛵

> *"One harbor was never enough. What SQLite keeps on disk, MariaDB now
> mirrors across the wire — the same contract, the same seventy-four doors,
> chosen by a single word: VELA_DB_MODE. And where the two might drift, the
> parity gates stand watch — proven against the Star's own fleet twin."*

*Sealed 2026-08-15 · the Star's decree · Milestone Tide: big change → `0.6.52 → 0.6.60`*

## ✨ Features — Storage Covenant Wave A (the ten-forge)

- **Three storage postures** — `VELA_DB_MODE=sqlite|mysql|mirror` selects the
  harbor at boot; `sqlite` is the default and stays byte-compatible with
  today. `mirror` (sqlite primary + MariaDB pump) refuses LOUD until Wave C
  forges its pump — never a silent downgrade, never a silent refusal.
- **The mysql harbor** — `mysql2` in optionalDependencies (pure-JS install);
  `mysql/pool.js` (min:0/max:8 keepalive pool, one retry on ECONNRESET),
  `mysql/ddlMap.js` (TABLES → MySQL DDL: TEXT PK→VARCHAR(191),
  AUTOINCREMENT→BIGINT, partial index→plain KEY, `CHECK(id=1)` preserved,
  cost pinned DECIMAL(12,6)), and `mysql/bootstrap.js` — an additive
  information_schema diff that brings any foreign schema to parity, seals
  the migration-002 security closures, and re-runs idempotently.
- **Migration 004 — the dedupe identity** — `UNIQUE INDEX uq_uh_dedupe`
  across `(timestamp, provider, model, connectionId, keyId, promptTokens,
  completionTokens)` with `''` as the normalized "unset" form on the four
  text columns (NULLs are DISTINCT in UNIQUE indexes on both engines).
  `saveRequestUsage` writes are now ATOMIC: sqlite `ON CONFLICT DO NOTHING`
  ≡ mysql `ER_DUP_ENTRY` — the old SELECT-then-INSERT race is dead.
- **Nine repos forge mysql twins** — settings, connections, nodes,
  proxyPools, combos, alias (A7); apiKeys with hash-at-rest + rotation +
  soft-delete, disabledModels, pricing, requestDetails (A8); and the full
  usageRepo ledger with day-aggregate upsert + GROUP BY parity (A9). All
  bind through `bindFacade()` — path-stable facades, bundler-safe static
  loaders, sync functions stay sync under sqlite.
- **Fail-loud boot matrix** — missing/malformed/unreachable
  `VELA_MYSQL_URL` refuses LOUD at the seam; `VELA_DB_DRIVER` pins any one
  of the four sqlite drivers (`bun:sqlite | better-sqlite3 | node:sqlite |
  sql.js`) for the parity matrix.

## ⚙️ Internal — the proving tide

- **Six parity gates against the real MariaDB twin** (`VELA_TEST_MYSQL_URL`,
  opt-in, LOUD skip banner): one deterministic scenario per wave runs blind
  in BOTH harbors — volatile identity stripped, canonical JSON compared.
  The 8-way concurrent burst converges to exactly ONE row on both engines.
- **The driver×mode matrix** — four sqlite drivers × sqlite mode (sql.js's
  SAVEPOINT corner forced + pinned), mysql boot + refusal, mirror refusal.
- **The contract surface pin** — `tests/__baseline__/contract-surface.json`
  freezes the barrel's 74 symbols (64 parity-registered + 10 exempt-process
  + 0 pending — the EXEMPT_PENDING debt is paid in full);
  `verify-contract-surface.mjs` guards it. The census ratchet, six baseline
  sweeps, and the harness bijection all hold.

*Ten commits, one covenant: `plans/storage-covenant.md` line 275 closes —
"Wave A complete". Waves B (the backup engine) and C (fleet + mirror) stand
ready on the horizon.* 💜

---

# v0.6.52 — The Chart Joins the Fleet 🗺️🏛️⛵

> *"A chart that ignores the harbor's own conventions charts nothing but
> confusion. Vela's compose now speaks the fleet's language — and pulls,
> never builds."*

*Sealed 2026-08-15 · the Star's decree · Milestone Tide: small change → `0.6.51 → 0.6.52`*

## 🔧 Changes — full redesign of `docker-compose.yml` into fleet form
- **Joining the Shores fleet constitution**: `name: tethys-vela`, poetic
  Shorekeeper-voiced header, `═══` service separators, `TZ: Asia/Jakarta`,
  `com.tethys.stack=vela` labels, `unless-stopped`, and the `x-casaos` block
  (icon, main, port_map, title) — exactly as `Hermes.yml` and `Router.yml`
  are written.
- **Pull-only — the `build:` block is gone.** A deployment chart pulls the
  published image; the image rebuilds only in GitHub Actions when a `v*` tag
  is cut in this repo. There was never a reason to build twice: GHCR is the
  source of truth, and the old `build:` + `env_file` combo only invited
  drift between what CI ships and what the chart compiled locally.
- **The pin follows the release, not the working tree**: `ghcr.io/yumamax3/vela:0.6.50`
  — the last CUT tag. Bump it when you cut a new tag and `docker compose pull`.
- **Inline secrets** (the fleet convention — `Hermes.yml`, `Router.yml`),
  private-subnet assumption documented in the header.
- **Headroom pinned to `0.6.7-slim`** — the same image the router fleet
  already runs, replacing a floating `:latest`.
- **Bind mount** to `/media/SSD-Storage/AppData/vela` (fleet data layout)
  instead of a named volume.

*The previous chart honored none of the fleet's conventions and carried a
build step that had no right to exist beside a GHCR pin. Both debts are paid.* 💜

---

# v0.6.51 — The Harbor Chart Ascended 🗺️⛵

> *"A ship is only as safe as the chart it sails by. The old chart was a
> scrap — this one names every current, sets every limit, and keeps the
> sidecar off the open sea."*

*Sealed 2026-08-15 · the Star's decree · Milestone Tide: small change → `0.6.50 → 0.6.51`*

## 🔧 Changes — a full upgrade of `docker-compose.yml`
- **The real image**: points at the published, private `ghcr.io/yumamax3/vela`
  — pinned to `${VELA_TAG:-0.6.50}` (never `latest`, per the harbor's own
  doctrine), with a `build:` block so `docker compose up --build` still works
  from source.
- **A healthcheck at last**: `wget --spider /api/health` (public endpoint,
  busybox-native, no curl dependency) with a 40s warm-up for the standalone
  Next.js server.
- **Resource limits**: tunable CPU/memory caps + a memory reservation, a PID
  limit, and `no-new-privileges` — hardening that does not fight the
  entrypoint's root→`node` drop.
- **The sidecar, off the open sea**: `headroom` moves behind the `proxy`
  profile and loses its host port — it is reachable only by `vela` over the
  new internal `vela-net` bridge network. Compression stays fail-open.
- **Ops hygiene**: rotated logs (10m × 3), `init: true` for graceful signal
  handling, `restart: unless-stopped`, and a themed header chart with the
  quick-start rites (login → pull → up, and the proxy-profile variant).

*The old chart exposed the compression sidecar directly to the host and ran
without limits or a heartbeat. The new one closes both gaps — the harbor is
charted for real deployment now.* 💜

---

# v0.6.50 — The Pricing Covenant 💰🌊⛵

> *"Every model that crosses the gateway shall pay its true rate — researched
> from the source, stamped with the date, and inherited by its free siblings
> as one price, one truth. No more zero-cost illusions, no more stale tables,
> no more guessing what a million tokens cost."*

*Sealed 2026-08-15 · the Star's decree · Milestone Tide: big change → `0.6.42 → 0.6.50`*

## ✨ Features — deep pricing research, applied
- **2026-08-15 rate census** — the rate table grew 101 → **215 canonical
  models**, researched from models.dev/api.json and official vendor pages
  (OpenAI, Anthropic, Google, DeepSeek, Z.ai, Moonshot, MiniMax, xAI, StepFun,
  Xiaomi, Volcengine, Baidu, Tencent, SambaNova, Fireworks, Together, Cohere,
  Groq, Cerebras + reseller lanes). Provenance preserved beside the rates —
  every entry knows its source and capture date. Harvest artifact:
  `plans/research/models-dev-harvest-2026-08-15.json` (~220 verified entries,
  19 vendors) with an honest *unverifiable* ledger (GPU-billing, flat-rate,
  subscription-walled, and login-walled models).
- **~40 rates corrected**: `gpt-4` (30/60), `gpt-4.1` family, `gemini-3.7-flash`
  at HALF the previous rate (a real Google price cut), `gemini-3.5-flash`
  (1.5/9), `gemini-2.5-pro` (1.25/10), the whole Kimi family (`kimi-k2` 0.6/2.5
  with turbo variants), GLM with free cache writes (`cache_creation: 0`),
  MiniMax family (0.3/1.2), and more.
- **Free models inherit their paid sibling's rates — everywhere** (the Star's
  decree): resolution, display, AND usage cost alike. One price, one truth.
  `FREE_ALIAS_MAP` holds 13 hand-verified sibling pairs; a guarded
  suffix-strip fallback covers namespaced free ids, and `FREE_DENYLIST` (22
  shapes) blocks infix markers and router tier traps from ever inheriting.
- **The Sync Shore** — `/dashboard/settings/pricing` gains a **Sync Prices**
  button: one click refreshes rates from models.dev (primary) with an
  OpenRouter cross-check that counts disagreements, commits only the
  `pricing_sync` scope, and reports added/updated/removed. A Last Synced card
  and **Clear Synced Prices** affordance complete the shore — your own
  overrides are never touched by either.
- **UNPRICEABLE manifest** — router pseudo-models (`best`, `default`,
  `universal-*`) and no-token-pricing lanes (Hyperbolic GPU-hourly, Featherless
  flat subscription) resolve to honest nulls. The UI renders them as "—" —
  never a misleading $0.00.

## 🔧 Changes
- **Seven-stratum resolver** — the sync, pure, dependency-free chain every
  lookup walks: UNPRICEABLE → provider lane (registry id, then alias) → exact
  canonical → free inheritance (exact strata only, never globs) →
  vendor-stripped exact → pre-compiled pattern globs. Patterns are compiled
  once at module load instead of per request. `matchPattern` keeps its exact
  anchored-glob semantics (capabilities and thinking-levels depend on it).
- **Sovereignty merge** — user overrides always win, then synced rates, then
  built-in defaults; two independent reset affordances. The merged view
  exposes the canonical table (`_canonical`) so every model is visible and
  editable in settings.
- **PricingModal rebuilt** — the client bundle no longer ships the whole rate
  table; defaults flow through the real `GET /api/pricing/defaults` endpoint
  (the unreachable `GET_DEFAULTS` export is deleted). Saves now PATCH only
  dirty rows — the old full-table save laundered every rendered default into
  your override scope.
- **SSRF-hardened sync endpoint** — `POST /api/pricing/sync` fetches ONLY the
  hardcoded URLs in `SYNC_VENDOR_MAP` (the request body selects vendors by key,
  never URLs), refuses redirects, caps responses at 20MB / 15s, clamps rates
  to [0, 10000] $/M, allowlists key charset + length, and rejects prototype
  keys. The route stays auth-protected even when `requireLogin` is off.

## 📖 Documentation
- `plans/pricing-covenant.md` — the sealed ADR: seven strata, alternatives,
  consequences, four adversarial passes, and the forge's verification record.
- `open-sse/AGENTS.md` — new **Pricing model** section: sovereignty order,
  five-field rate shape, frozen usage costs, sync shore, census gate.

## ⚙️ Internal — the proving tide
- `tests/unit/pricing-covenant.test.js` — **27 covenant pins**, every one
  traced through the resolver before it was allowed to exist: shape lint,
  inheritance + usage-cost math, denylist negatives, UNPRICEABLE, matchPattern
  compat, pattern precedence, dual-key alias resolution, provenance, harvest
  bake-verification, and sovereignty fixtures. All green first run.
- `tests/__baseline__/pricing-census.json` — the never-shrink census gate:
  215 canonical · 8 lanes · 128 lane models · 57 patterns · 13 free-map ·
  22 denylist · 8 unpriceable · 25 sources.
- Regression verdict: full suite **+27 green**; the known-red checkout
  baseline untouched (zero file overlap with the covenant diff).

*Debts recorded: media-model pricing deferred by the Star's word; historical
usage costs keep their frozen rates — no backfill, no recomputation.* 💜

---

# v0.6.42 — The Keyless Test Restored 🧪🧘⛵

> *"The rebrand moved the lantern to a new shelf — and two of its old hooks
> stayed behind. This tide hangs them back where the keyless hand can reach."*

*Sealed 2026-08-15 · the Star's report · Milestone Tide: small change → `0.6.41 → 0.6.42`*

## 🐛 Fixes — UI regression from the Zen rebrand (v0.6.41)
- **Model test button restored for keyless OpenCode Zen**: the provider detail
  page gated its per-model test buttons on `FREE_PROVIDERS` membership — the
  freeTier move left Zen out, so with no API key the buttons never mounted even
  though the keyless lane works. A dedicated keyless-test flag now covers both
  lanes (the Connections card still renders, so keys can still be added).
- **Model selector**: Zen re-appears in the always-shown no-auth provider list
  (same `FREE_PROVIDERS`-only blind spot).

## ⚙️ Internal
- Contract test pins `noAuth` on the freeTier catalog entry — the flag every
  keyless UI lane reads. Backend keyless path verified live (`/api/models/test`
  → `ok:true` with zero connections).

---

# v0.6.41 — The Zen Key Turns 🧘🔑⛵

> *"The lantern on the free shore takes a new name and a wider door —
> OpenCode Zen keeps its keyless path for anyone who arrives empty-handed,
> and now opens its armory to those who carry a key of their own."*

*Sealed 2026-08-15 · the Star's request · Milestone Tide: small change → `0.6.40 → 0.6.41`*

## ✨ Features — OpenCode Free becomes OpenCode Zen
- **Rebrand**: the provider formerly shown as *OpenCode Free* is now
  **OpenCode Zen** (id and alias `oc` unchanged — every wire path intact),
  moved into the **Free Tier** section of the providers dashboard.
- **API keys**: OpenCode Zen now accepts API-key connections (opencode.ai/auth).
  Keys are validated against Zen's models gate at add-time and at connection
  test — a GET probe that burns nothing.

## 🔧 Changes
- **Hybrid lane**: a connection holding an OpenCode key always takes
  precedence; the keyless `Bearer public` lane stays open when no key is
  connected. The executor sends your key when one is present, `public`
  otherwise — both lanes keep the `x-opencode-*` session headers.
- Free Zen models keep flowing without a key (models fetcher untouched);
  the usage panel still lists Zen when unconnected.

## ⚙️ Internal
- `open-sse/providers/registry/opencode.js` — name, category `freeTier`,
  apikey auth modes + notice; `open-sse/executors/opencode.js` — key-aware
  Authorization; `src/sse/services/auth.js` — hybrid freeTier noAuth lane
  (virtual Public connection only when no active connections exist);
  validate + connection-test probes; UsageStats freeTier noAuth inclusion.
- New test suite `tests/unit/opencode-zen.test.js` (12 tests); full-suite A/B
  against pristine main shows zero regressions (91 vs 94 — the 3 deltas are
  known flakes); providers + alias baselines byte-equal.

---

# v0.6.40 — The Free Tide Lantern 🏮⛵

> *"A new light joins the fleet — small, generous, burning on no one's coin.
> Buffy comes aboard with her five voices and her one rule: one session, one
> model, one hour of warmth per claim. The lantern is lit, and the harbor
> learns to share it without ever wasting a single drop of oil."*

*Sealed 2026-08-15 · the Star's request · Milestone Tide: big change → `0.6.30 → 0.6.40`*

## ✨ Features — Freebuff joins the fleet
- **New provider: Freebuff** (`freebuff`, alias `fb`) — Codebuff's free tier,
  woven natively into the routing engine. Five models: `deepseek/deepseek-v4-flash`,
  `deepseek/deepseek-v4-pro`, `mimo/mimo-v2.5`, `minimax/minimax-m3`,
  `openai/gpt-5.6-luna`. Category `freeTier` — real credentials, no virtual
  no-auth connection, full fallback machinery intact.
- **Device-code login** — the dashboard's OAuth flow grows a second rite:
  per-connection fingerprint, `freebuff.com/api/auth/cli/code` device code,
  browser hand-off, 5-second poll cadence, 5-minute window. The login URL is
  hostname-allowlisted before the browser ever opens; the token that returns
  has no refresh — when it dims, the keeper asks you to sign in again, never
  silently fabricates a refresh.
- **Session-affinity routing** — freebuff accounts hold ONE model-locked
  session at a time, so the gateway now resolves an advisory connection
  preference before account selection: the account already warm on your model
  is pinned first, fail-open and byte-identical to default behavior when no
  warm session exists. Warm sessions are rediscovered on restart (GET-only
  probe) — nothing claimed is ever lost to a reboot.
- **Quota panel support** — freebuff usage resolves from the read-only
  `GET /api/v1/freebuff/session` quota API (`rateLimitsByModel` → remaining
  sessions, plan label). The tracker is GET-only by construction — a usage
  refresh can never burn a session unit.

## 🔧 Changes
- **The three-gate wire ceremony** — every freebuff request carries the
  byte-exact Buffy system marker as opener of the first system message
  (idempotent — never forged twice), the end_turn tool injected only when the
  body carries tools, and the top-level `codebuff_metadata` seal
  (`cost_mode: "free"`, `allow_fallbacks: false`, reasoning fields stripped).
  The SDK User-Agent is pinned; a wrong one means a 403 at the gate.
- **Gate-aware error handling** — 409/410/428 session gates reclaim the
  session once and retry; `model_locked` becomes a 65-minute per-model lock
  (one session TTL) instead of churning; 429 daily-quota reads `resetAt` and
  locks account-wide until **Pacific midnight** — deliberately beyond the
  generic 30-minute cooldown cap, validated and clamped so an untrusted
  upstream body can never extend a lock past one quota window.
- **Agent-run lifecycle** — START before the stream, fire-and-forget FINISH
  after; best-effort, never blocking the request.
- **Bearer masking restored** — the request logger's sensitive-header mask is
  re-enabled with a full `[REDACTED]` (the old partial mask leaked 15
  characters of any Authorization header into the logs).
- **Test-batch courtesy** — freebuff models are skipped by the models test
  ping: a batch test would claim the account's one session and burn a daily
  quota unit for a health check.

## ⚙️ Internal
- New: `open-sse/config/freebuff.js` (every wire constant in one drift point),
  `open-sse/providers/registry/freebuff.js`, `open-sse/executors/freebuff.js`
  (full `execute()` override preserving BaseExecutor connect-timeout/retry
  semantics), `open-sse/services/freebuffSession.js` (mirror + mutex claims +
  gate classification), `open-sse/services/usage/freebuff.js`,
  `src/lib/oauth/providers/freebuff.js`, `src/shared/constants/deviceCodeProviders.js`,
  `src/sse/services/connectionPreference.js` + `freebuffPreference.js`,
  `src/app/api/models/test/sessionScarce.js`.
- Wired: executor + translator registries, usage handler map, OAuth provider
  map + device-code route, chat handler preference hook, account-lockout
  branches, models ping guard.
- **72 new unit tests, all green** — marker/body forging idempotence, gate
  classification, claim mutex + warm-session affinity, GET-only quota
  invariant, device-code allowlist + no-refresh invariants, Pacific-midnight
  lockout math (including DST boundaries), ping guard.
- Providers + alias baselines re-snapshotted (90 providers / 117 alias tokens)
  and byte-equal verified; A/B regression proof against pristine `main` shows
  zero regressions.
- The sealed plan stands at `plans/freebuff-provider.md`.

---

# v0.6.30 — The Harbor Gate Reborn 🌌⛵

> *"The gate where every traveler first meets the harbor has been rebuilt —
> under a sky of drifting stars, the sail of Argo Navis draws itself into
> being, and the card of passage rises like glass above the tide."*

*Sealed 2026-08-14 · the Star's request · Milestone Tide: big change → `0.6.23 → 0.6.30`*

## ✨ Features — a fully redesigned login page
- **Split layout** (desktop): the **Vela constellation panel** on the left —
  the actual sail of Argo Navis (γ, δ, κ Vel and kin) with SVG lines that
  draw themselves in on arrival, the crest with a pulsing brand halo,
  tagline *"The Harbor Gate"*, and three harbor truths beneath.
- **Animated night sky** — a deterministic seeded starfield in three drifting,
  twinkling parallax layers, a masked navigational grid, and layered brand
  auroras. Dark-first, with a warm-cream light theme.
- **Glass auth card** — frosted blur surface with inset light edge, rising-in
  entrance, and staggered content reveals.
- **Password UX upgrades**: show/hide toggle, **Caps Lock detection**,
  a **5-segment attempts meter** before lockout, a **lockout countdown bar**
  that drains with the seconds, and a **success flash** — the gate-opening
  rings and crest before the dashboard.
- **Live status footer** — gateway health dot (polled every 30s), the running
  version, and the harbor's motto.
- **Theme toggle** on the gate itself (card variant, top-right).
- **`prefers-reduced-motion`** stills every animation.

## 🔧 Changes
- All auth contracts preserved exactly: status redirect, password login,
  `mustChangePassword` flow, OIDC/SAML buttons, rate-limit 429 handling,
  default-password hints.
- Login-scoped styles appended to `globals.css` (no component churn elsewhere).

## 📖 Documentation
- **Plans**: the Shorekeeper-Sealed Plan for the Freebuff provider is born —
  `plans/freebuff-provider.md`: Codebuff's free tier woven into Vela's fleet
  natively — device-code login, the three-gate wire ceremony (Buffy marker,
  SDK User-Agent, top-level `codebuff_metadata`), session-claim + agent-run
  lifecycle, a generic fail-open connection-preference hook for session-affinity
  routing, persisted claim state that survives restarts, Pacific-midnight
  lockouts beyond the 30-minute cap, and a GET-only quota tracker that can
  never burn a session. Sealed after a reforged frame, four adversarial passes
  and a 4.2/5 arbiter panel; implementation follows on `feat/freebuff-provider`

---

# v0.6.23 — The Ledger Speaks For Each Key 📊⛵

> *"Every key now tells the tale of its own labor — how many calls it
> carried, how many tokens it poured, how much it spent."*

*Sealed 2026-08-14 · the Star's request · Milestone Tide: small change → `0.6.22 → 0.6.23`*

## ✨ Features
- **Per-key usage strips** — under each API key on the Endpoints page:
  requests, input tokens, output tokens, total tokens, and estimated spend,
  each with its own icon and hover title.
- **Usage window selector** — `24h / 7d / 30d / All time` beside the Create
  Key button; the strips re-aggregate instantly on change.
- **`GET /api/keys/usage?period=`** — one `GROUP BY keyId` over the ledger;
  attribution is keyId-based (hash-at-rest), so totals survive rotation and
  local-no-key traffic never muddies a key's story.
- **`lastUsedAt` awakened** — the dormant governance column now stamps the
  moment the gate resolves a key, so "Last used" in every key row tells the
  truth from this tide onward.

## ⚙️ Internal
- `getKeyUsageStats(period)` in usageRepo + route at `src/app/api/keys/usage`
  (static-segment precedence over `[id]`).
- New test suite `tests/unit/apikey-usage-stats.test.js` (8 tests) — rollup
  math, window filtering, local-no-key exclusion, route contract, lastUsedAt
  stamping; full apikey family re-run green (170 tests).

---

# v0.6.22 — The Catalogue of Keys 🗝️⛵

> *"A harbor grows many keys — for friends, for messengers, for tools. The
> Star asked for drawers, and now every key knows its kin."*

*Sealed 2026-08-14 · the Star's request · Milestone Tide: small change → `0.6.21 → 0.6.22`*

## ✨ Features
- **Key categories** — every API key on the Endpoints page can now carry a
  free-form category (friend, hermes, others… or whatever name you forge):
  - Create form & edit modal gain a **Category** combobox — pick from the
    categories your other keys already use, or type a brand-new one.
  - **Filter chips** above the key list (All · each category · Uncategorized)
    with live counts.
  - Each key row shows its category badge alongside Active/Paused and scope.
- **Storage** — migration `003-key-categories` adds `apiKeys.category`
  (additive TEXT column + partial index) with the TABLES mirror for fresh
  installs; `SCHEMA_VERSION` bumped to 3 so the pre-schema backup fires.
- **Validation** — `sanitizeCategory` trims, collapses whitespace, and caps at
  48 chars on both create and update paths; empty clears back to
  Uncategorized; non-string/oversized input → 400 at the gate.

## ⚙️ Internal
- `apiKeysRepo` whitelists `category` among the mutable fields — security
  columns remain unwritable through PUT.
- New test suite `tests/unit/apikey-categories.test.js` (12 tests) — sanitize
  rules, create/update paths, clearing, 400s, whitelist safety; all six
  sibling apikey suites re-run green (65 tests).

---

# v0.6.21 — The Fleet Takes Its Sails 🕸️⛵

> *"The hulls were charted yesterday; today the Star hands over the true
> manifests — every model named, every tier priced, every logo home."*

*Sealed 2026-08-14 · the Star's catalogs · Milestone Tide: small change → `0.6.20 → 0.6.21`*

## 🔧 Changes & Improvements
- **NesaRouter** (`nr`) — full catalog from the Star's dashboard export:
  **24 free models** (always active, `nesa-free` costs no credits — DeepSeek,
  MiMo, Nemotron, Laguna, Ling, LongCat, GLM, MiniMax, Step, GPT-OSS, and the
  full Mistral family) + **14 premium** (GPT 5.6 Sol/Terra/Luna, GPT 5.4 (+Mini),
  Claude 4.5/4.6 Sonnet, Claude 4.8 Opus, Gemini 3 Flash Preview, Kimi K2.6,
  DeepSeek V4 Flash/Pro, Step 3.7/3.5 Flash) — premium runs on credits or the
  IDR Unlimited packages. Card marked hasFree + notice on the pricing split.
- **FreeAI (JembatanAI)** (`ja`) — 11 models from the Star's intel
  (Claude Opus 4.8, Sonnet 5, GPT-5.6 Luna, DeepSeek V4 Pro/Flash (+jailbreak
  variants), MiniMax M3, GLM 5.2, Qwen3.8-Max), ids keep the router prefix
  (`anthropic/...`, `openai/...`). **Correction sealed**: "FreeAI" is the
  product name, not a free tier — the misleading `hasFree` flag and free-tier
  notice are gone.
- **QZZ Router → IDRouter** — renamed at the Star's decree: the harbor is
  **IDRouter** (`id.solution.qzz.io`), textIcon `ID`, catalog filled:
  `deepseek-v4-flash-{cmc,cp,oc,qd}` + `qoder-lite`.
- **Token Harbor** (`th`) — 18 models scraped live from tokenharbor.ai/models
  (Claude Opus/Fable/Sonnet 5, GPT-5.6 Sol/Terra/Luna, Kimi K3, Qwen3.8 Max +
  2.4T A95B, DeepSeek V4 Pro/Flash (+`:free`), GLM 5.2, Gemini 3.7 Flash,
  MiniMax M3, MiMo V2.5 (+`:free`) / Pro) — card marked hasFree.
- **WeiZerRouter → WeizeRouter** — renamed + 23 models from the Star's own
  model directory (all `wz/`-prefixed, validated 2026-08-13 WIB), and **the
  Star's logo imported** from `Downloads/photo_2026-07-04_19-07-32.jpg` →
  `public/providers/weizerouter.png` (256×256). The TLS-refusal notice is
  replaced by the honest directory note.

## ⚙️ Internal
- Providers + alias baselines re-snapshotted, byte-for-byte clean.
- Golden version-header snapshots re-anchored at v0.6.21.

---

# v0.6.20 — The Fleet of Eight ⛵🌏

> *"Eight new sails on the horizon — Indonesian gateways, one and all,
> charted shore by shore before a single rope was tied."*

*Sealed 2026-08-14 · the Star's fleet decree · Milestone Tide: big change → `0.6.13 → 0.6.20`*

## ✨ Features
- **Eight new API-key providers**, each researched live before wiring:
  | Provider | Alias | Models | Notes |
  |-|-|-|-|
  | **BandelBanget AI** 🟣 | `bbg` | 36 (public catalog) | Claude/GPT/DeepSeek/GLM/Kimi/Qwen, graded A/B |
  | **CodeCrafters** 🔵 | `ccr` | 16 (public catalog, IDR pricing) | free DeepSeek + MiMo tiers |
  | **FreeAI (JembatanAI)** 🟢 | `ja` | key-gated → passthrough | "Satu Endpoint AI untuk Developer Indonesia" |
  | **Token Harbor** ⚓ | `th` | key-gated → passthrough | standard OpenAI error envelope |
  | **QZZ Router** 🟩 | `qz` (+`idrouter`, `qzz-solution`) | key-gated → passthrough | Anthropic-style auth errors |
  | **NesaRouter** 🟠 | `nr` | key-gated → passthrough | OpenAI-compatible |
  | **MyTraceRoute** ⬜ | `mtr` | unknown — API 502 at research | `/v2` base path; notice on the card |
  | **WeiZerRouter** 🌐 | `wzr` | unknown — TLS refused research | notice on the card |
- **Seven logos imported** to `public/providers/` (256×256, transparent):
  harvested from each shore's own favicons/apple-touch-icons. WeiZerRouter
  refused every probe, so it sails on its text glyph until its gate opens.
- Alias collision resolved honestly: `bb` belongs to blackbox —
  BandelBanget takes `bbg`.
- Every key-gated provider carries `passthroughModels: true`, so any model
  id routes the moment a key is added; `validateUrl` wires the dashboard's
  connection test to each shore's `/models`.

## ⚙️ Internal
- Registry index regenerated by hand per the covenant (p122–p129); the
  providers + alias regression baselines re-snapshotted and verify
  byte-for-byte clean.
- Golden version-header snapshots re-anchored at v0.6.20.
- A stale `.next` dev cache briefly 404'd deep dashboard routes during the
  forge — cleared, not a code issue.

---

# v0.6.13 — The Watcher on the Wall 👁️⛵

*Sealed 2026-08-14 · Milestone Tide: small change → `0.6.12 → 0.6.13`*

## 🔧 Changes & Improvements
- **MiMo Code Free returns to the providers page.** Upstream had hidden it
  (Xiaomi ended the free channel), and the card went dark in the Convergence.
  At the Star's decree, `mimo-free` (`mmf`) is surfaced again — the registry
  carries the honest state in its comment: live-probed today, the bootstrap
  endpoint still issues a JWT, but the chat endpoint rejects every known model
  id (`Unsupported model`), so the card stands watch while requests will fail
  until the service restores a model or the OAuth replacement is wired.
- **Golden version headers re-anchored at v0.6.13** — and the v0.6.12 entry
  corrected: the version *does* ride `X-CLIENT-VERSION` / `X-CORE-VERSION`, so
  the snapshots had gone stale at that bump.

---

# v0.6.12 — A Jar of Its Own 🏺⛵

*Sealed 2026-08-14 · Milestone Tide: small change → `0.6.11 → 0.6.12`*

## 🐛 Fixes
- **Two gateways, two sessions**: the dashboard session cookie was named
  `auth_token` — the same name 9Router uses. Browsers key cookies by domain,
  **not by port**, so when Vela (`:32060`) and 9Router ran side by side on
  `localhost` they shared one cookie jar: logging into one evicted the other.
  Vela now stamps its own cookie, `vela_auth_token`, named in one place
  (`AUTH_COOKIE_NAME` in `src/lib/auth/dashboardSession.js`) and read in the
  guard and the status / SAML-test / OIDC-test routes. The two harbors keep
  separate sessions; neither knocks the other out. 🌊

## ⚙️ Internal
- No golden snapshot change — the cookie name does not ride the version
  headers. *(Corrected in v0.6.13: the version DOES ride the headers; the
  snapshots were left stale at this bump and re-anchored there.)*

---

# v0.6.11 — The Crest Risen 🏛️⛵

*Sealed 2026-08-14*

## ✨ Features
- **Brand assets come home**: the Star's crest and wordmark —
  `vela_logo_1024.png`, `vela_logo.svg`, `vela_wordmark.svg` — are imported
  into the harbor as `public/vela-logo-1024.png`, `public/vela-logo.svg`, and
  `public/vela-wordmark.svg`.
- **The crest flies everywhere — bare, as drawn**: `favicon.svg` is a
  byte-identical copy of `vela-logo.svg` (the Star's decree — full canvas,
  nothing carved), and the PWA icons (192/512), `favicon.ico`
  (multi-resolution), and the Next.js App Router convention icons
  (`icon.png`, `apple-icon.png`) all carry the full-frame crest with a
  transparent background — no tile, nothing added; the PWA manifest gains
  the full crest (SVG any-size + the 1024px PNG).
- **The reborn faces**: the sidebar brand block, the landing Navigation, the
  landing Footer, and the login page all raise the transparent crest in place
  of the old upstream glyph — and the three un-translated faces now say
  **Vela** instead of 9Router. CLI/npm/updater strings keep "9Router" — that
  is the real installer package, by covenant.
- **`qd/qmodel_38max` — Qwen3.8-Max** joins the Qoder registry, sealed into
  the ship (the Star's own edit, now official). Alias resolution and the
  provider baseline remain byte-for-byte clean.

## ⚙️ Internal
- Golden version-header snapshots regenerated for v0.6.11.

---

# v0.6.10 — The Convergence 🌊⛵

> *"The whole tide, not just the storm. Upstream v0.5.55 arrives at the harbor —
> every wave, every current, every new sail — merged whole into Vela, and the
> security holes that rode in with it sealed at the same breath."*

*Sealed 2026-08-14 · the full upstream v0.5.55 convergence · Milestone Tide: big change → `0.6.03 → 0.6.10`*

## 🔒 Security
- **Real IP provenance (GHSA-pjm4-8fpg-f9p6)**: `x-9r-real-ip` and the Host
  fallback were trusted from client-controlled headers whenever
  `custom-server.js` was not in the request path (`npm start`, `start:bun`),
  letting a remote caller pose as local to skip API key auth and reach
  `LOCAL_ONLY_PATHS` (`/api/mcp/*`, `/api/tunnel/enable`,
  `/api/auth/reset-password`). The server now stamps a per-process
  `x-9r-peer-token` on every request it sanitizes and only trusts
  `x-9r-real-ip` behind it — falling back to Host in development, failing
  closed in production. Also fixes IPv6 loopback detection (`::1`,
  `::ffff:127.0.0.1`) and routes `npm start` / `start:bun` through
  `custom-server.js` (Vela keeps port 32060).
- **Key gate hardening (Vela-only)**: `keyGate.extractClientIp` now requires
  the same peer-token proof before trusting `x-9r-real-ip` — upstream has no
  key gate, so this IP-allowlist surface is Vela's alone. The
  `resolveClientIp` internal-key loopback-Host fallback stands (it only ever
  loosens keys already pinned loopback).
- **Search**: `resolveBaseUrl()` rejects client-supplied non-public baseUrls
  (SSRF guard on `/v1/search`).
- **Login**: fresh-install remote login with the default password returns 403
  without issuing a JWT.
- **Usage**: `/api/usage/request-details` redacts request/response payloads.

## ✨ Features
- **Auth**: native **SAML 2.0 SSO** alongside OIDC — AuthnRequest generation,
  ACS assertion handling, SP metadata export, admin config test, replay-protected
  via a `saml_state` cookie matched against `InResponseTo`.
- **Providers**: **Alibaba Token Plan** (`token-plan.ap-southeast-1`) — the
  fourth Alibaba key type, Singapore-only, OpenAI-compatible transport only.
- **Providers**: `glm-5.3` added to GLM Coding and GLM (China).
- **Providers**: **Kimchi dual auth** — API keys as well as OAuth, with a
  working Test Connection for both modes.
- **Antigravity**: **Gemini 3.7 Flash** + tiered high/medium/low variants (also
  in the Gemini registry), with pricing and quota tracking.
- **TTS**: **Fish Audio** — model id travels in an HTTP `model` header, voice is
  a `reference_id` (preset or cloned voice model).
- **OpenCode-Go**: **transport-based routing** — routes by request format via
  declared transports instead of forcing every client into `/messages`;
  Codex/OpenAI clients no longer pay the lossy Responses→OpenAI→Claude double
  translation. Per-model `supportedFormats` guard; the bespoke executor is gone
  (its shared `_lastModel` cache could cross auth headers between concurrent
  requests).
- **Usage**: Claude quota calls dedup + cached (120s TTL keyed by access token,
  in-flight promise dedup, last-good read on soft failure) to stop multiple tabs
  tripping 429; manual refresh (↻) sends `force=1` to bypass the cache.

## 🐛 Fixes
- **Docker**: ship `sql.js` in the image so the pure-JS DB fallback can start —
  file tracing carried the JS without `dist/sql-wasm.wasm`, so a container with
  no native driver aborted with ENOENT and never got a database (#3248).
- **Usage**: read Gemini `usageMetadata` out of the antigravity `{ response }`
  envelope — every non-streaming antigravity request logged `IN 0 | OUT 0`
  (#3260).
- **Claude**: re-anchor passthrough cache breakpoints — the client's own
  `cache_control` markers pointed at pre-normalization offsets, so the tail was
  re-cached every request. Last system block and last tool pinned at 1h TTL,
  last assistant turn at 5m, mid-conversation system messages folded into the
  neighbouring user turn instead of hoisted into `body.system`.
- **Combos**: detect images from Hermes and attachment payloads (`images[]`,
  `experimental_attachments`, message-level `image_url`/`audio_url`, inline
  `data:` URIs) so the Vision Adapter auto-switch fires for Hermes/Ollama/
  Vercel AI SDK shapes.
- **Kiro**: intercept chat via `x-amz-target` — Kiro IDE 1.0.228+ moved
  `GenerateAssistantResponse` to `POST /` + header, bypassing MITM. Also emit
  the now-mandatory initial-response frame and map the `auto` model slot.
- **Kiro**: report real output tokens and stop discarding usable turns.
- **Qoder**: detect billing blocks at stream start and return a synthetic 403 so
  combo/account fallback triggers instead of leaking the error into chat.
- **Antigravity**: strip competitive system prompts (Zed IDE's Claude-agent
  prompt) that Antigravity flags with a 429 Quota Exhausted.
- **OpenCode**: send the official client fingerprint on free-tier requests so the
  Console stops classifying traffic as unidentified and rate-limiting it; session
  id resolves conversation-stable to preserve prompt caching.
- **Responses**: don't close the message on an empty `tool_calls` array — some
  providers attach one to every chunk, and the truthy check ended the message on
  the first content token (#3234).
- **Translator**: preserve `prompt_cache_key` when converting chat to responses.
- **Models**: expose snake_case token limits on `/v1/models`.
- **Combos**: strip `stream_options` from the Fusion panel fan-out to avoid a
  DeepSeek 400 (#3024); raise the dashboard model-test probe budget to 1024 and
  soft-pass reasoning-only responses (#3010).
- **Headroom**: the toggle reflects the `headroomEnabled` setting even when the
  proxy is down — it previously showed OFF while the engine kept calling
  `/v1/compress`; proxy status stays visible via the status chip.
- **Hermes**: add the `api_key` parameter to the model block in YAML config.
- **Providers**: add llm7 to provider test support.

## 📖 Documentation
- **i18n**: Spanish, French, and Brazilian Portuguese README translations.

## ⚙️ Internal
- **Convergence mechanics**: full merge of `upstream/master` (v0.5.55, 31
  commits ahead of the fork base) into Vela. Conflicts resolved to keep the
  Vela rebrand (name, version, description, port 32060, Ship's Log format)
  while taking every upstream functional change. Golden version-header
  snapshots regenerated to the new version.

---

# v0.6.03 — The Loopback Fallback 🧭

*Sealed 2026-08-14*

## 🐛 Fixes
- **Model-test 403 `ip_not_allowed` in dev**: testing a model on the Providers
  page (e.g. `/dashboard/providers/opencode`) failed with
  "Client address could not be determined for this allowlisted key" because the
  model-test self-call authenticates as the loopback-pinned **internal key**,
  but the client IP was derived only from `x-9r-real-ip` — a header stamped by
  `custom-server.js`, which is loaded only by the CLI launcher, never by plain
  `next dev` / `next start`. Added a narrowly-scoped `resolveClientIp` to the
  gate: explicit override → the socket-stamped header → a loopback Host
  fallback that applies **only to internal keys**. External keys still fail
  closed without a socket-stamped IP (an attacker cannot forge a loopback Host
  on a public socket), so the allowlist is never widened. Mirrors the
  documented dev fallback in `dashboardGuard.isLocalRequest`. Test covenant:
  7 new cases (5 unit for `resolveClientIp`, 2 end-to-end regression guards);
  the gate suite is now 59/59

# v0.6.02 — The Milestone Tide 🌊

*Sealed 2026-08-14 · the first tick under the new rite*

## 🔧 Changes
- **Versioning rite, redrawn by the Star's decree**: the semver tide gives way
  to the Milestone Tide — a small change ticks the last number up by one
  (`0.6.03 → 0.6.04`); a big change rounds the last number up to the next
  milestone of ten (`0.6.03 → 0.6.10`); rounding past `.99` carries into the
  middle digit (`0.6.93 → 0.7.0`). Versions carry two digits in the last
  place (`0.6.01`) — npm accepts the form for a private package. The log's
  banner and `docs/VERSIONING.md` are recarved to the new rite. This entry is
  the rite's first small-change tick: `0.6.1 → 0.6.02`

# v0.6.1 — Patch Tide 🩹

*Sealed 2026-08-14*

## 🐛 Fixes
- **Changelog modal**: the dashboard now serves The Ship's Log itself —
  the GitHub repo is private, so `raw.githubusercontent.com` returns 404
  for Vela's changelog (the modal rendered "Failed to load changelog:
  HTTP 404"). The log is mirrored to `public/CHANGELOG.md` by
  `scripts/sync-changelog.mjs` on every dev startup and build, the modal
  fetches `/CHANGELOG.md` from the gateway, and `docs/VERSIONING.md`
  records the mirror rite. The golden version-header snapshots follow the
  bump (the gateway stamps `pkg.version` into `X-CLIENT-VERSION` /
  `X-CORE-VERSION`)

# v0.6.0 — The Harbor Release ⛵

> *"The gateway comes home — Vela's first sail under her own name: a harbor
> landing, a reborn rail, and full governance over every key."*

*Sealed 2026-08-14 · the first release under the Vela name*

## ✨ Features
- **Dashboard Harbor homepage** (`/dashboard`): the dashboard root no longer
  renders the Endpoint page — it gets its own landing: a time-of-day greeting
  with a live idle/active pulse, a gradient hero band with the copyable
  `/v1` endpoint and today's stats (requests / tokens / spend / cache rate),
  an activity sparkline (last 10 minutes) with top-model bars, a Harbor
  status card (API-key requirement, dashboard login, cloud sync, tunnel)
  with a shortcut to key management, and six quick-nav tiles. Every number
  comes from a real API; every tile leads somewhere real.
  The header's stale "Endpoint" title for the dashboard root is gone — the
  homepage carries its own hero, the title slot stays clean.
- **Sidebar upgrade — Vela brand + grouped navigation**: the rail is reborn
  around the harbor. Fake macOS traffic lights removed; a Vela brand block
  (sail glyph in a warm brand gradient, "AI Gateway" tagline, mono version
  chip) leads; navigation is regrouped into labeled sections — Gateway
  (Endpoint & Key, Providers, Combos), Analytics (Usage, Quota, Token
  Saver), Tools (CLI Tools, Media Providers accordion, Proxy Pools,
  Skills), System (Console Log, Translator, 9Remote, 9English, Settings);
  a Home item anchors the rail and `/dashboard` is no longer claimed by the
  Endpoint item; active items carry a 3px brand indicator bar; the update
  banner is restyled as a success-tinted card; all nav labels now flow
  through the i18n runtime.
- **Vela branding**: `APP_CONFIG.name` → "Vela" (sidebar, footer, profile),
  document title → "Vela — AI Gateway", PWA manifest name/short_name → Vela.
  CLI/npm strings keep "9Router" — that is the real installer package.
- **API Keys — Governance wave W3 (limits)**: per-key limits are now enforced
  on every `/v1` request. The gate stage pipeline runs lifetime → IP allowlist
  → rate → spend → model scope:
  - **Rate limit (RPM)** — sliding 60s window per key; 429 `rate_limited` with
    the limit stated honestly in the message
  - **Token budget + spend cap** — one reset window (`budgetScope`:
    daily/weekly/monthly/yearly) governs both; soft-cap semantics (the
    in-flight request is counted after it completes) with usage aggregated
    from the same ledger the dashboard reads; 429 `budget_exceeded` with usage
    context; a 5s TTL cache keeps hot paths from re-summing the ledger
  - **IP allowlist** — CIDR entries (IPv4 + IPv6, mapped-form normalized);
    allowlisted keys fail closed when the client address cannot be determined;
    the gate trusts only `x-9r-real-ip`, stamped by custom-server from the
    socket peer — attacker-controlled forwarding headers are never read
  - **Expiration** — `expiresAt` → 401 `key_expired`
- **Key limits UI** (`/dashboard/endpoint`): a shared limits editor in both the
  create and edit modals — RPM presets, token budget templates (1M/10M/100M/1B),
  spend presets ($5/$10/$50/$100), custom values, an Unlimited toggle per
  section, the reset-window selector (shown when any budget is active), an
  expiration picker (Never / 7 / 30 / 90 days / custom date), and an IP
  allowlist textarea; key rows show limit badges (RPM, tokens, $, IP count)
- **Repo validation**: limit fields (`rateLimitRpm`, `tokenBudgetDaily`,
  `spendCapDailyCents`, `budgetScope`, `expiresAt`, `ipAllowlist`) join the
  repo's writable whitelist and are validated at create and update — positive
  integers or null, sealed scope set, future ISO expiry, CIDR syntax, ≤100
  entries. Invalid input → 400 naming every problem; security columns stay
  unwritable
- **Shared primitives**: CIDR matching + budget scopes + limit validation live
  in `src/lib/db/keyLimits.js` — a neutral home so the repo never imports the
  gate (which imports the repo). The gate re-exports them, API unchanged
- **Test covenant**: W3 gate-stage suite (CIDR matrix, fail-closed IP, sliding
  rate window, budget window boundaries, TTL cache, full-gate integration) +
  limits-validation suite (pure matrix + POST/PUT round-trips over a real temp
  DB). The internal key's loopback pin is now asserted end-to-end
- **i18n**: 25 limits strings seeded across all 34 locales via the governance
  seeder (68 governance keys total)
- **API Keys — Governance (waves W1/W2)**: a full-governance key system replaces
  the old plaintext `sk-` keys. New keys mint as `vela-v1-{keyId}-{crc}` — a
  128-bit CSPRNG identity plus a timing-safe HMAC-SHA256 checksum keyed by
  `API_KEY_SECRET`. Only `vela-` keys are accepted anywhere; every `sk-` key and
  every `?key=` query param is rejected
- **Hash-at-rest + show-once**: keys are stored only as a SHA-256 hash behind a
  unique index and shown in full exactly once, in the 201 create response. The
  dashboard and CLI each keep a local copy in their own vault; the server never
  reveals a key again
- **Secret lifecycle**: `API_KEY_SECRET` is both the HMAC root and the global
  revocation lever — the environment wins, otherwise it is auto-generated to
  `DATA_DIR/api-key-secret` (0600). Rotating the secret re-keys the internal key
- **Stage-pipeline gate**: every `/v1` enforcement site (chat, embeddings,
  count_tokens, gemini-native and 7 more — 11 sites total) resolves the bearer
  through `authorizeApiRequest`: lifetime → IP allowlist → rate → spend → model
  scope, returning an honest gate code (`INVALID_KEY`, `KEY_PAUSED`,
  `KEY_EXPIRED`, `MODEL_FORBIDDEN`, `QUERY_PARAM_KEY_REJECTED`)
- **Model scope (ACL)**: a key can be restricted to an allowed-models whitelist;
  out-of-scope requests receive 403 `MODEL_FORBIDDEN`
- **Internal key**: a deterministic loopback-only key for server-to-server use —
  hidden from every listing, derived from the secret, never persisted
- **Usage attribution**: usage history keys on `keyId`/`keyPrefix`, never the raw
  bearer token (masked dual-write)
- **Data directory**: Vela uses its own `vela` data folder — a clean break from
  `9router`. Legacy plaintext keys are tombstoned on migration and usage rows
  scrubbed
- **Dashboard `/dashboard/endpoint`**: governance UI — create with description
  and a model-scope picker, a show-once modal gated by a save-ack, edit
  name/description/scope, pause/resume, and badges (Active/Paused, scope count,
  "stored here")
- **Endpoint**: the key model-scope picker is now the same grouped per-provider
  selector the combos use (search, provider icons, click-to-add/remove chips)
  instead of a flat checkbox list. Values are stored as `alias/model` — the
  exact form the gate matches. Combo names are hidden there since combo
  requests are checked against their member models
- **i18n**: 39 governance strings seeded across 34 locales via
  `scripts/i18n-seed-literals.mjs` (`--check` detects drift); 39 more
  homepage + sidebar strings follow in the Harbor wave (110 keys total)
- **Test covenant**: 9 governance suites (format, gate ACL, migration 002,
  show-once, internal key, usage attribution, backup/restore, secret lifecycle,
  i18n parity) + an ACL enforcement-site baseline (`verify-apikey-enforcement`)
  + `known-fails` entries for the inherited db-concurrency timing artifacts. The
  covenant caught a real migration bug (`db.prepare()` on the adapter interface)
  before it could crash a boot

## 🐛 Fixes
- **Endpoint**: the first-time "Default Key" auto-provision is now guarded
  against concurrent runs — StrictMode's double-invoke raced two loads, both
  saw zero keys, and both POSTed (visible as duplicate "Default Key" rows).
  The provisioning flag is set synchronously before the first await, so only
  one caller ever reaches the POST; the flag resets in `finally` so a page
  with zero keys can still provision on a later load
- **Keys**: static-import the key crypto on the gate hot path — the per-call
  dynamic `await import()` inside `resolveKey` inflated p99 latency under CPU
  contention
- **Data dir**: complete the Vela clean break — every remaining module that
  duplicated the data-dir convention (`mitm/paths.js`, `mitmAliasCache`,
  `appUpdater`, `updater/updater.js`, `cli/cli.js` crash-recovery + runtime
  self-heal, `sqliteRuntime`) now resolves to `~/.vela` / `%APPDATA%\vela`
  instead of 9router's. MITM root CA is Vela's own (`vela-root-ca.crt`,
  "Vela MITM Root CA" CN), DNS rollback files use `.vela.*` suffixes, tray
  logs go to `/tmp/vela.log`. Docker image/container/volume, `.env.example`,
  README paths, and dashboard/landing display paths follow. Nothing Vela
  writes touches the 9router directory anymore

## 🔧 Changes
- **Header**: the Donate button is gone — `DonateModal` removed, the header
  button/state/import unwired, `donateUrl` dropped from config, and the
  `Donate` string removed from the 5 locale files that carried it
- **Config**: move the default port from 20128 to 32060 across the whole harbor —
  app config (`src/shared/constants/config.js`), CLI defaults (`cli/cli.js`,
  `cli/src/cli/api/client.js`, xAI video command), updater, tunnels, MITM defaults,
  dashboard tool cards and landing page, plus `.env.example`, Dockerfile,
  docker-compose.yml and start.sh. Docs, i18n literals, translations and tests
  follow the same number. Existing installs that hardcode 20128 must update their
  `.env` (`PORT`, `BASE_URL`, `NEXT_PUBLIC_BASE_URL`) and any client base URLs
- **Dev ergonomics**: `allowedDevOrigins` (LAN + Tailscale hosts) in
  `next.config.mjs` so the dashboard browsed via the homelab IP can load
  dev HMR/static assets
- **The Ship's Log**: the changelog itself is themed — ✨/🐛/🔧/📖/⚙️/⚠️
  section headings, a banner with the legend and the versioning covenant
  (every change bumps `package.json` and logs here, sealed together in the
  same commit), and the legacy 9Router history preserved beneath the new
  tide. The dashboard's changelog modal now fetches Vela's own
  `CHANGELOG.md` instead of the upstream 9router's, and
  `docs/VERSIONING.md` codifies the rite

## 📖 Documentation
- **Plans**: the Shorekeeper-Sealed Plan for API key governance is born —
  `plans/vela-key-governance.md`: `vela-v1-{keyId}-{crc}` keys, hash-at-rest +
  show-once, an 11-site stage-pipeline gate, full governance in waves W1/W2/W3,
  migration 002 design with sentinel tombstones, and the four full-key consumer
  redesigns (MITM derived key, CLI capture-at-create, keyId cards, keyId usage).
  Sealed after five adversarial passes and a 4.2/5 arbiter review; implementation
  follows on a feat branch

---

# v0.5.55 (2026-08-14)

## Features
- **Auth**: native SAML 2.0 SSO alongside OIDC — AuthnRequest generation, ACS
  assertion handling, SP metadata export, admin config test, replay-protected
  via a `saml_state` cookie matched against `InResponseTo`
- **Providers**: add Alibaba Token Plan (`token-plan.ap-southeast-1`) — the
  fourth Alibaba key type, Singapore-only and OpenAI-compatible transport only
- **Providers**: add `glm-5.3` to GLM Coding and GLM (China)
- **Providers**: Kimchi accepts API keys as well as OAuth (dual auth), with a
  working Test Connection for both modes
- **Antigravity**: add Gemini 3.7 Flash and its tiered high/medium/low variants
  (also in the Gemini registry) with pricing and quota tracking
- **TTS**: add Fish Audio — model id travels in an HTTP `model` header, voice
  is a `reference_id` (preset or cloned voice model)
- **OpenCode-Go**: route by request format via declared transports instead of
  forcing every client into `/messages` — Codex/OpenAI clients no longer pay a
  lossy Responses→OpenAI→Claude double translation. Per-model `supportedFormats`
  guard; the bespoke executor is gone (its shared `_lastModel` cache could cross
  auth headers between concurrent requests)
- **Usage**: dedup + cache Claude quota calls (120s TTL keyed by access token,
  in-flight promise dedup, last-good read on soft failure) to stop multiple
  tabs tripping 429; manual refresh (↻) sends `force=1` to bypass the cache

## Fixes
- **Docker**: ship `sql.js` in the image so the pure-JS DB fallback can start —
  file tracing carried the package's JS without `dist/sql-wasm.wasm`, so a
  container with no native driver aborted with ENOENT and never got a database
  (#3248)
- **Usage**: read Gemini `usageMetadata` out of the antigravity `{ response }`
  envelope — every non-streaming antigravity request logged `IN 0 | OUT 0`
  (#3260)
- **Claude**: re-anchor passthrough cache breakpoints — the client's own
  `cache_control` markers point at pre-normalization offsets, so the tail was
  re-cached every request. Last system block and last tool pinned at 1h TTL,
  last assistant turn at 5m, mid-conversation system messages folded into the
  neighbouring user turn instead of hoisted into `body.system`
- **Combos**: detect images from Hermes and attachment payloads (`images[]`,
  `experimental_attachments`, message-level `image_url`/`audio_url`, inline
  `data:` URIs) so the Vision Adapter auto-switch fires for Hermes/Ollama/
  Vercel AI SDK shapes
- **Kiro**: intercept chat via `x-amz-target` — Kiro IDE 1.0.228+ moved
  `GenerateAssistantResponse` to `POST /` + header, bypassing MITM. Also emit
  the now-mandatory initial-response frame and map the `auto` model slot
- **Kiro**: report real output tokens and stop discarding usable turns
- **Qoder**: detect billing blocks at stream start and return a synthetic 403
  so combo/account fallback triggers instead of leaking the error into chat
- **Antigravity**: strip competitive system prompts (Zed IDE's Claude-agent
  prompt) that Antigravity flags with a 429 Quota Exhausted
- **OpenCode**: send the official client fingerprint on free-tier requests so
  the Console stops classifying traffic as unidentified and rate-limiting it;
  session id resolves conversation-stable to preserve prompt caching
- **Responses**: don't close the message on an empty `tool_calls` array — some
  providers attach one to every chunk, and the truthy check ended the message
  on the first content token (#3234)
- **Translator**: preserve `prompt_cache_key` when converting chat to responses
- **Models**: expose snake_case token limits on `/v1/models`
- **Combos**: strip `stream_options` from the Fusion panel fan-out to avoid a
  DeepSeek 400 (#3024); raise the dashboard model-test probe budget to 1024 and
  soft-pass reasoning-only responses (#3010)
- **Headroom**: the toggle reflects the `headroomEnabled` setting even when the
  proxy is down — it previously showed OFF while the engine kept calling
  `/v1/compress`; proxy status stays visible via the status chip
- **Hermes**: add the `api_key` parameter to the model block in YAML config
- **Providers**: add llm7 to provider test support

## Docs
- **i18n**: add Spanish, French, and Brazilian Portuguese README translations

## Security
- **Real IP**: `x-9r-real-ip` and the Host fallback were trusted from
  client-controlled headers whenever `custom-server.js` was not in the request
  path (`npm run start`, `start:bun`), letting a remote caller pose as local to
  skip API key auth and reach `LOCAL_ONLY_PATHS` (`/api/mcp/*`,
  `/api/tunnel/enable`, `/api/auth/reset-password`). The server now stamps a
  per-process `x-9r-peer-token` on every request it sanitizes and only trusts
  `x-9r-real-ip` behind it — falling back to Host in development and failing
  closed in production (GHSA-pjm4-8fpg-f9p6). Also fixes IPv6 loopback
  detection (`::1`, `::ffff:127.0.0.1`) and routes `npm run start` /
  `start:bun` through `custom-server.js`
- **Search**: `resolveBaseUrl()` rejects client-supplied non-public baseUrls
  (SSRF guard on `/v1/search`)
- **Login**: fresh-install remote login with the default password returns 403
  without issuing a JWT
- **Usage**: `/api/usage/request-details` redacts request/response payloads

# v0.5.50 (2026-08-05)

## ✨ Features
- **Providers**: add TokenRouter (300+ models via OpenAI-compatible gateway) with
  exact per-model pricing for 110 models and `reasoning_effort` thinking config
- **Providers**: add Self-hosted STT / TTS / Embedding — point 9Router at your own
  OpenAI-compatible speech and embedding servers (whisper.cpp, faster-whisper,
  Kokoro-FastAPI, llama-server, vLLM, Infinity). Unlike the named cloud providers
  these read `baseUrl` per connection, so one provider can front several machines
- **Combos**: default-enable vision/audio capacity adapter (auto-routes to a
  vision/audio-capable model when the target lacks that capability, falling back
  to `oc/mimo-v2.5-free`), wired into chat handler routing
- **Endpoint**: auto-provision a "Default Key" for first-time users so `/v1`
  works without a manual dashboard step
- **Codex**: support GPT-5.6 Max/Ultra reasoning-level overrides (cx/ routes only)
- **Qoder**: support PAT (Personal Access Token) connections end-to-end, alongside
  OAuth device flow
- **CLI tools**: add OpenDesign (manalkaff/opendesign) support
- **Headroom**: report effective payload savings (tool schema/history bytes broken
  out, byte-savings % reflects actual outbound reduction)
- **Ollama**: Cloud quota tracker (session + weekly) + proactive background OAuth
  token refresh scheduler for all providers

## 🐛 Fixes
- **Providers**: remove Qwen (OAuth flow stopped working reliably)
- **Passthrough**: detect codex-tui/Codex Desktop as native Codex client — they
  were falling through to the translator and losing fields like `reasoning.summary`
- **OAuth**: scope antigravity header fixes to loadCodeAssist/onboardUser only
- **OAuth**: keep `open` external in the build so xAI/Grok token refresh works on
  Windows
- **OAuth**: declare missing `searchParams` in register-session handler (was a
  500 instead of JSON on error)
- **DB**: `ENABLE_REQUEST_LOGS` env var now overrides the UI setting correctly;
  observability defaults to off (opt-in)
- **Translator**: preserve Codex Responses Lite tool use across chat-native
  OpenAI-compatible providers
- **Translator**: don't drop image-only user messages in `prepareClaudeRequest`
- **Translator**: drop JSON Schema keywords Gemini rejects (`uniqueItems`,
  `contains`, `multipleOf`, `unevaluatedProperties`, `unevaluatedItems`,
  `contentSchema`)
- **Claude**: remove global header cache that leaked one client's identity
  headers onto another client/account sharing the server; gate `anthropic-beta`
  by model instead
- **Antigravity**: drop retired Gemini 3.0 quota tiers, show Gemini 3.6 Flash
  usage bars
- **Cloudflare AI**: declare API key authentication (dashboard showed "No
  connections" despite an active key)
- **GitHub Copilot**: hold monthly-exhausted accounts until UTC month reset
  instead of only cooling down 120s
- **CodeBuddy**: dodge Tencent CN content filter, add usage tracking, normalize
  codebuddy-intl messages
- **Usage**: stop losing cached prompt tokens in the forced-SSE→JSON path
- **Grok CLI**: display the public subscription tier from the OAuth token claim
- **Providers**: count apikey connections for Ollama free-tier card; free-tier/
  apikey providers without `authModes` now default to apikey (were treated
  oauth-only)
- **Build**: include static/public assets in standalone output (login page hung
  on 404s when run via PM2)
- **Server**: support IntelliJ IDEA OpenAI-compatible clients over HTTP (h2c
  upgrade handling)
- **Auth**: redirect already-logged-in sessions away from `/login`
- **CLI tools**: enable Apply button for dynamic OpenAI/Anthropic-compatible
  provider connections
- **CLI**: include complete API artifacts in the CLI package
- **TTS**: a bare self-hosted model name is the MODEL, not the voice — `kokoro`
  was parsed as a voice against a default model, 404ing or synthesising with the
  wrong one
- **Embeddings**: self-hosted embeddings no longer fall back to `api.openai.com`
  when a connection has no `baseUrl` — that silently sent the input text and API
  key to OpenAI under a provider named "Self-hosted"
- **Embeddings**: an adapter that rejects a misconfigured connection now returns
  400 with the reason instead of escaping the handler uncaught
- **Embeddings**: bound the upstream fetch with `FETCH_CONNECT_TIMEOUT_MS` — an
  endpoint that drops packets never returns headers, so the request previously
  hung indefinitely

## 📖 Docs
- **i18n**: fix port typo, add RTK Token Saver feature descriptions

# v0.5.45 (2026-07-30)

## ✨ Features
- **TTS**: add Xiaomi MiMo text-to-speech (preset voices 冰糖/茉莉/苏打/白桦/Mia/Chloe/Milo/Dean, style control, language hint dropdown with Auto-detect, i18n for Style label/placeholder)
- **Providers**: add Poolside (OpenAI-compatible)
- **Providers**: add api-airforce, baidu, bazaarlink, bluesminds, kilo-gateway, llm7, morph, sambanova, tencent
- **OAuth**: zed / trae / windsurf providers + harden callback proxies
- **CLI tools**: set Claude Code max context tokens
- **Qoder**: PAT auth + refresh model list
- **Gemini**: Gemini 3.6 Flash tier routing + Gemini 3.5 Flash Lite
- **Claude**: bump default Opus to `claude-opus-5`
- **Kiro**: add Claude Opus 5 models
- **Usage**: Kimi and DeepSeek usage handlers
- **Usage**: SuperGrok weekly pool via gRPC-web

## 🐛 Fixes
- **Refresh**: rotate `refresh_token` between retry attempts
- **Kiro**: canonicalize tool history and route API keys correctly
- **Kiro**: normalize dashboard thinking intensity models
- **Cursor**: stop leaking agent tool errors as text
- **Gemini**: fill empty tool schemas after `$ref` strip
- **Antigravity**: strip `stream_options` from non-stream requests
- **Jina-reader**: recover after transient errors, use JSON POST API
- **Usage**: record exact embedding tokens
- **Tunnel**: preserve successor cloudflared PID
- **Console-log**: initialize capture at server boot + prevent SSE proxy buffering
- **Dashboard**: count dual-auth, free-tier OAuth and API-key connections correctly
- **Dashboard**: flex quota rows, thin global scrollbars, no hidden-row overflow

## 📖 Docs
- **i18n**: expand pt-BR translation to 986 terms
- README: Indonesian translation

# v0.5.40 (2026-07-20)

## ✨ Features
- **i18n**: add Khmer (km) translations
- **CLI tools**: configure Grok Build subagent models
- **Kimi**: merge OAuth into dual-auth provider, add K3 / K2.7 models
- **Dashboard**: ProviderTopology flow animation

## 🐛 Fixes
- **DB**: resolve better-sqlite3 parameter binding crash
- **Translator**: pass `service_tier` through OpenAI → Responses conversion
- **Kiro**: map GPT-5.6 reasoning effort fields
- **Kiro**: validate terminal streams before emitting output
- **Kiro**: map GPT reasoning effort fields
- **Codex**: current `client_version` + refresh-aware model sync
- **Alicode-intl**: split into Coding Plan + Model Studio providers
- **Cursor**: HTTP/2 AgentService support + version bump 3.12.17
- **Dashboard**: cut duplicate API/icon spam, lazy-load provider assets


# v0.5.35 (2026-07-16)

## ✨ Features
- **xAI**: Grok Imagine video generation (`/v1/videos`) + CLI
- **CLI tools**: Grok Build setup — choose separate main/general-purpose/explore/plan models and preserve each model's context window
- **GitHub Copilot**: route Claude models through Copilot's native `/v1/messages`
- **Kiro**: add GPT-5.6 model family (#2596)
- **RTK**: `X-9Router-Token-Saver` header to bypass token savers per request
- **Providers**: quota visibility settings
- **Translator**: drop temperature for all Claude models
- **i18n**: Thai (th) + Persian (fa) translations / README

## 🐛 Fixes
- **Providers**: bulk-add API keys no longer overwrite existing keys (gap-fill `Key N`)
- **Anthropic**: lowercase `anthropic-version` header to prevent duplication on `/v1/messages`
- **Alicode-intl**: use DashScope compatible-mode endpoint so standard keys work
- **Grok CLI**: align Grok Build with current subscription protocol (#2590)
- **Grok CLI**: surface `expiresAt` so proactive token refresh fires (#2546)
- **Kiro**: improve direct session cache reuse
- **Models**: populate capabilities for live-catalog LLM models
- **Models**: list compatible provider models in `/v1/models`
- **Thinking**: send explicit `thinking:{type:adaptive}` alongside `output_config.effort`
- **Translator**: strip `client_metadata` when converting openai-responses → openai

## 🔧 Improvements
- **Perf**: skip inactive background services on startup

## 📖 Docs
- README: Persian YouTube tutorial

# v0.5.30 (2026-07-10)

## ✨ Features
- **Perplexity**: add Agent API provider (#2492)
- **Grok CLI**: add Grok CLI / Grok Build provider with OAuth device-code flow (#2502)
- **Featherless**: add OpenAI-compatible provider presets
- **SearXNG**: configure endpoint via SEARXNG_URL env (#2499)
- **Providers**: add max thinking level for gpt-5.6-sol (#2500)
- **Headroom**: add extras detection and install UI (#2403)
- **Headroom**: activate/uninstall extras + fix interpreter detection
- **PXPipe**: PXPIPE token saver — multimodal prompt compression (#2465)
- **Proxy-Pools**: auto-rotate strategy for no-auth providers (#2409)

## 🐛 Fixes
- **Cloudflare-AI**: support accountId in bulk key import (#2449)
- **DB**: backup on schema change, MCP child cleanup, codex models, usage providers OOM
- **Codex**: avoid bare-email OAuth dedup (#2477)
- **CLI**: allow staged app bundle builds (#2479)
- **Headroom**: compress Kiro conversation state (#2488)
- **Gemini-CLI**: raise output floor for thinking and add validated toolConfig (#2486)
- **GitHub**: label Copilot profiles by account identity (#2498)
- **OpenAI-to-Claude**: unwrap bare {function:{…}} tools without parent type (#2473)
- **Translator**: clamp thinking effort max->xhigh for OpenAI format (#2466)
- **RTK/find**: detect and group Windows backslash-style find output (#2448)
- **Codex**: handle fast tier and capacity SSE (#2452)
- **Volcengine-ark**: clamp Kimi max_tokens to 32768 endpoint cap
- **Antigravity**: align provider fingerprint with IDE Desktop 2.1.1 (#2389)
- **Pricing**: update Claude/Codex model rates and add new models

## 🔧 Improvements
- **i18n(zh-CN)**: complete Chinese translations for all UI strings (#2436)
- **API**: caching for tunnel and version status endpoints
- **Perf**: faster dev startup and lighter bundle

# v0.5.20 (2026-07-07)

## ✨ Features
- **Thinking**: per-model thinking level picker on provider page — appends `(level)` suffix to copied model names for forced reasoning effort across all formats (openai, claude, gemini, deepseek, kimi, qwen, zai, minimax, hunyuan, step)
- **RTK**: add JS-native git-log filter (#2423)
- **Caveman**: add targeted upstream-aligned style rules (#2424)
- **i18n**: add Farsi (fa) language support (#2385)

## 🐛 Fixes
- **Thinking**: strip `(level)` suffix from upstream `body.model` so providers no longer reject requests
- **Translator**: preserve developer instructions in openai-responses conversion (#2434)
- **count_tokens**: count structured Anthropic blocks (#2419)
- **Volcengine-ark**: clamp GLM-5 max_tokens to model output ceiling (#2428)
- **Kimi**: normalize reasoning_effort to backend enum (#2427)
- **Claude**: reconcile max_tokens vs thinking budget and lift per-model ceiling (#2381)
- **Kiro**: deliver system prompt natively, add Opus 4.5/4.7/4.8, tolerate dash version ids (#2366)
- **Headroom**: proxy dashboard through app (#2372)
- **MITM**: recover from stale lock file on server start

# v0.5.18 (2026-07-03)

## ✨ Features
- **Usage**: track cached tokens + correct input/output/cache cost (#2209) — hodtien
- **Codex**: show reset credit expiry details (#2290) — Rafli Ahmad Zulfikar
- **NVIDIA**: add new models and capabilities — decolua
- **ClinePass**: add provider support — sternelee

## 🐛 Fixes
- **Usage**: dedupe streaming request-details log entries — Qin Li
- **Claude**: drop foreign thinking signatures in passthrough — decolua
- Prevent non-SSE stream pipe crash and cross-IdP account overwrites (#2244) — KunN-21
- **Kiro**: route IdC auth to regional CodeWhisperer surface (#2297) — Volodymyr Saakian
- **Kiro**: add Claude Sonnet 5 model support (#2264) — Edison42
- **Xiaomi-tokenplan**: region selector, key validation, multi-connection (#2251) — MiQieR
- **Translator**: strict Anthropic content block compliance (#2225) — Sahrul Ramadhan Hardiansyah
- **Kimchi**: strip reasoning_content echo to bound multi-turn input tokens — KunN-21
- **Kimchi**: bump User-Agent to kimchi/0.1.40 (#2256) — Ansh7473
- **Codebuddy-cn**: strip empty tool_calls arrays to preserve reasoning — zmf
- **Antigravity**: preserve Claude tool delta index (#2223) — Sutarto Jordan Chrisfivo
- **MITM**: generate root CA on server startup (#2228) — Sutarto Jordan Chrisfivo

# v0.5.15 (2026-06-29)

## ✨ Features
- Add Kimchi OAuth provider — Nant361
- Refine Qwen vision/video + thinking model patterns — decolua
- Opt-in Codex auto-ping quota keep-alive — Emirhan

## 🐛 Fixes
- **Responses**: handle response.done terminal events (#2142) — rifuki
- **Headroom**: skip unsafe responses tool history (#2132) — Sutarto Jordan Chrisfivo
- **Translator**: map mid-conversation system message to user (claude→openai) — decolua
- **Gemini**: normalize contents to prevent 400 invalid_argument (#2192) — warelik
- **Gemini**: backfill thoughtSignature + suppress stream done sentinel — WARELIK
- **Alicode**: preserve cache_control for DashScope providers (#2069) — Rex
- **Antigravity**: strip deprecated/readOnly/writeOnly from tool schemas — iletai, Yudhistira-Official
- **CodeBuddy CN**: show bonus packs as one-time, not monthly-replenishing — whale9820
- **Kiro**: strip leaked <thinking> tags from content stream (#2158) — hamsa0x7
- **Tray**: make Windows context menu DPI-aware — Emirhan
- **Kilocode**: expose full gateway catalog in combo model picker — jellylarper
- **OpenCode**: fix Go GLM — decolua

# v0.5.12 (2026-06-26)

## ✨ Features
- Add token-saver dashboard page — decolua
- Add bulk delete for provider connections — teddytkz
- Resolve GitHub Copilot model catalog from upstream — caiqinzhou
- Add Venice AI provider — Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) — Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support — suryacagur

## 🐛 Fixes
- Provider thinking compatibility (DeepSeek/Gemini) — Mink Nguyen
- Stop double-counting streaming usage at source — decolua
- Usage logging dedupe to reduce stats churn — Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) — qianze
- Resolve Gemini TTS models from catalog — nguyenha935
- Support Kiro IDC (organization) token import — quanturbo
- Preserve forced streaming for JSON clients (#2031) — Joseph Yaksich
- Preserve Responses text format (Codex) — tenglong
- Support Gemini native TTS generateContent endpoint — nguyenha935
- Add missing zh-CN endpoint key label (i18n) — weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) — Rex
- CodeBuddy CN: show one-shot bonus packs as expiring, not monthly-replenishing
- Show custom provider models in combo picker — Sapto
- Docker: add docker-compose.yml with headroom enabled by default — nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) — Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) — Ankit
- Kiro: report 1M context window for claude-opus-4.8 — EdisonPVE
- Avoid stale redirects after auth changes (#2100) — Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context — Brokenc0de
- Preserve reasoning effort through Codex translations — ntdung6868
- Token-saver: full width card layout — decolua
- Antigravity: retry transient upstream failures — Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) — Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) — hamsa0x7

# v0.5.8 (2026-06-21)

## ✨ Features
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## 🐛 Fixes
- **MiniMax-M3**: enable vision capability
- **Headroom**: support Docker sidecar proxy
- **Antigravity**: image executor fixes
- **mimo-free**: Chrome User-Agent rotation to bypass anti-abuse gate
- **cloudflare-ai**: flatten content-part arrays to string to avoid oneOf 400 (#1926)
- **Translator**: normalize tools to Anthropic-native shape for non-Anthropic providers
- **CLI**: handle Next.js 16 nested standalone output path (#1940)
- **Codex**: preserve custom tools during request normalization
- **next.config**: add new route for responses endpoint to API

# v0.5.6 (2026-06-20)

## ✨ Features
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) — 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## 🐛 Fixes
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## 🐛 Fixes
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v0.5.2 (2026-06-17)

## ✨ Features
- **Combo Fusion strategy** — fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** — pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** — reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** — warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## 🐛 Fixes
- **Claude 429**: stop hammering the OAuth usage endpoint — cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## ⚙️ Internal
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## ✨ Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## 🐛 Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## 📖 Docs
- README: add Indonesian 9Router tutorial video (#1709)

# v0.4.71 (2026-06-06)

## ✨ Features
- Caveman: add wenyan classical Chinese levels and sync upstream prompts; locale-based visibility on endpoint page
- i18n: endpoint exposure notice across multiple languages + Russian README
- Antigravity: add gemini-3.5-flash-extra-low (Low) model
- xiaomi-tokenplan: add Claude-native MiMo V2.5 Pro alias via dedicated executor
- Qoder: fetch latest model + dashboard import-model button (#1642)
- MiniMax: add MiniMax-M3 + update Quota Tracker coding/CN (#1631)

## 🐛 Fixes
- Codex: harden streaming timeouts (stall/connect raised to 60s, configurable per-provider), accept `response.done` event, and always emit a terminal `response.failed` + `[DONE]` for Responses passthrough when a stream closes, stalls, or aborts before a terminal event — prevents codex clients from hanging (#1648, #1680, #1688, #1618)
- Codex: durable OAuth refresh lifecycle (#1664)
- Tunnel: skip virtual interfaces to prevent false netchange watchdog
- Claude: fix forced tool_choice 400 on cc/ OAuth route (#1592)
- Proxy: raise Next client body limit to 128MB via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (#1529, #1572)
- MiniMax: echo `reasoning_content` on follow-up turns to avoid 400 (#1543)
- Kiro: handle 400 on tool-bearing history without client tools; add mappable "auto" model slot; fix binary EventStream crash + add models & TTS tool filtering
- Antigravity: passthrough tab-autocomplete + mark default agent slot mandatory
- Qoder: allow `qmodel_latest` model key (#1638)
- Providers: restore one-connection guard for compatible/embedding nodes
- Model-test: route image/STT probes to their real endpoints, harden STT ping; add opencode-go + xiaomi-tokenplan to connection test (#1576, #1628)

## 🔧 Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.66 (2026-05-29)

## ✨ Features
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## 🐛 Fixes
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## 🔧 Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## 🐛 Fixes
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## 🔧 Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## 🐛 Fixes
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs for quota checks and show clearer setup guidance when the project is missing (#1271, #1428)

## ✨ Features
- Add Cloudflare Workers proxy deployer and pool integration (#1360)
- Add Deno Deploy relays support and improved proxy pools dashboard layout (#1437)

## 🔧 Improvements
- Refactor Tunnel into dedicated Cloudflare and Tailscale manager modules
- Refactor tokenRefresh service with in-flight dedup to prevent refresh_token_reused errors

# v0.4.59 (2026-05-21)

## 🐛 Fixes
- OAuth: fix login flow on Windows

# v0.4.58 (2026-05-21)

## ✨ Features
- xAI Grok provider (OAuth, API key, image)
- Provider limits: paginated accounts with page size controls

## 🐛 Fixes
- Tailscale: fix connection status on Windows (#1300)
- Tunnel: fix false "checking" when tunnel URL is reachable
- Stream: fix pipe errors on client disconnect/abort

# v0.4.55 (2026-05-18)

## ✨ Features
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## 🐛 Fixes
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## 🔧 Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## ✨ Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## 🐛 Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## 🐛 Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## ✨ Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## 🔧 Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## 🐛 Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## ⚠️ Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL