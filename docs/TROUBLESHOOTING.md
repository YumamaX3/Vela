# 🧯 Vela Troubleshooting

> *"The harbor does not hide its rocks — it names them. This is the chart of the
> failures an operator actually meets at 2am: the symptom first, the line in the
> log that proves it, the cause beneath the waterline, then the one move that
> frees the ship. Read the evidence before you touch the helm."*

**Covers:** gathering evidence · the server will not boot · cannot log in ·
upstream 401/403/429/402 · the Combo exhaustion 429 · upstreams behind a proxy ·
icons rendering as raw text · estimated cost of $0 · the CodeBuddy family's
channel refusal (11128) · a content-filter refusal · breaker cooling · a
degraded mirror · a backup that will not restore · usage and logs after a move ·
the DB driver falling back.

**Every count below was sounded on 2026-10-28 at v1.2.5.** File and line
references are the evidence; re-derive rather than trust the prose after a tide.

---

## Table of Contents

- [Gather Evidence First](#gather-evidence-first)
- [The Server Will Not Boot](#the-server-will-not-boot)
- [Cannot Log In](#cannot-log-in)
- [Upstream Returns 401 / 403 / 429 / 402](#upstream-returns-401--403--429--402)
- [The CodeBuddy Family Refuses (11128)](#the-codebuddy-family-refuses-11128)
- [A Content-Filter Refusal](#a-content-filter-refusal)
- [The Breaker Is Cooling](#the-breaker-is-cooling)
- [Upstreams Hang or Fail Behind a Proxy](#upstreams-hang-or-fail-behind-a-proxy)
- [Icons Render as Raw Text](#icons-render-as-raw-text)
- [Estimated Cost Shows $0](#estimated-cost-shows-0)
- [The Mirror Is Degraded](#the-mirror-is-degraded)
- [A Backup Will Not Restore](#a-backup-will-not-restore)
- [Usage or Logs Missing After a Move](#usage-or-logs-missing-after-a-move)
- [The DB Driver Fell Back](#the-db-driver-fell-back)
- [Symptom → First Move](#symptom--first-move)

---

## 🔎 Gather Evidence First

Six instruments answer almost every question. Reach for them before changing
anything — and read the *line*, not the feeling.

| Instrument | What it tells you |
|-|-|
| `docker logs -f vela` | The live console — boot lines, `[DB]`, `[mirror]`, `[backup]`, `[DATA_DIR]`, `[CODEBUDDY]`. Under Compose the service is `vela-gateway`: `docker compose logs -f vela-gateway` |
| `curl -s http://localhost:32060/api/health` | The liveness truth. A healthy harbor answers **`{"ok":true}`** — no auth, no CORS gate (`src/app/api/health/route.js:10`) |
| **Request Logs** — `/dashboard/logs` | The request ledger: model, provider, connection, `FAILED <status>`. Backed by `GET /api/usage/logs` (`getRecentLogs`) |
| **Console Log** — `/dashboard/console-log` | The in-process console buffer (`src/lib/consoleLogBuffer.js`) — every level, live, with a follow toggle |
| **Backup ledger** — `/api/backup/list` | `backup` · `restore` · `drill` · `purge` · `prune` · `failed` · `s3Offsite` · `mirrorPoison` · `mirrorAgeOut` · `mirrorDivergence` · `mirrorResync` rows, metadata only |
| `vela doctor` | The CLI's four pre-flight checks: Node version, standalone build present, **data dir writable**, **port free** |

There is no on-disk log file for the application. Everything the server says
goes to **stdout/stderr**, which Docker captures into its log driver. The
compose template pins `logging.driver: json-file` with `max-size: 10m`,
`max-file: 3` — so `docker logs` is the archive, and the dashboard's Console
Log room is the live window.

**Request details are opt-in.** The Request Logs room always shows the ledger
row; the full request/response *bodies* are captured only when observability
is on. `ENABLE_REQUEST_LOGS` (env) wins when set; otherwise
`OBSERVABILITY_ENABLED !== "false"` plus the dashboard's own
`enableObservability` setting decide (`src/lib/db/repos/sqlite/requestDetailsRepo.js:18–34`).

---

## ⚓ The Server Will Not Boot

### Port 32060 is already in use

- **Symptom** — the container restarts in a loop; `docker logs vela` ends in
  `EADDRINUSE`; Compose answers `Bind for 0.0.0.0:32060 failed: port is already
  allocated`; `vela doctor` prints `❌ Port  32060 — already in use by another
  process`.
- **Cause** — another process (or a second Vela) holds the berth. The port
  comes from **`PORT`** — the image sets `ENV PORT=32060` (`Dockerfile:43`), and
  the standalone server reads `process.env.PORT`. When `PORT` is unset, Next's
  standalone default is **3000**, not 32060.
- **Fix** — find and stop the holder, then start again:

```bash
# Linux/macOS
lsof -i :32060            # or: sudo ss -lptn 'sport = :32060'
# Windows
netstat -ano | findstr :32060     # note the PID, then:
taskkill /F /PID <pid>
```

To move Vela instead, change **both** the env and the published port —
`PORT: "32061"` and `- "32061:32061"` in the gateway's block — then
`docker compose up -d`. Commands written for the old port (health probes,
CLI tools, tunnels) must follow it.

### `JWT_SECRET` unset or unreadable

- **Symptom** — the container exits at boot with a filesystem error
  (`EACCES`/`EROFS` on `jwt-secret`), or sessions do not survive a restart.
- **Cause** — `loadJwtSecret()` (`src/lib/auth/dashboardSession.js`) prefers
  `JWT_SECRET`; when it is unset it reads **`$DATA_DIR/jwt-secret`**, and if
  that file is absent it generates one (`crypto.randomBytes(32)`, mode `0600`)
  and writes it there. It does **not** crash on a missing `JWT_SECRET` — it
  crashes when the data dir cannot be written to. The secret is resolved
  **once, at module load**, so changing it invalidates every live session.
- **Fix** — set a stable 64-hex secret in the chart and restart:

```bash
openssl rand -hex 32        # paste into JWT_SECRET
docker compose up -d
```

Never let the generated file be lost: losing it logs everyone out. Pin the
secret in the environment so the file is never the only copy.

### `VELA_DB_MODE=mysql` with an unreachable harbor

- **Symptom** — boot refuses, loudly. One of these exact lines:

```text
[DB] VELA_DB_MODE="mysql" requires VELA_MYSQL_URL (mysql://user:pass@host:3306/vela) — refusing to boot without it
[DB][mysql] VELA_MYSQL_URL is not a valid URL: <raw>
[DB][mysql] VELA_MYSQL_URL must start with mysql:// (got "<scheme>")
[DB][mysql] VELA_MYSQL_URL must name a database: mysql://user:pass@host:3306/vela
```

  …or a connection failure from `probeMysqlUrl`.
- **Cause** — the Storage Covenant refuses to **silently downgrade**. The
  `mysql` posture means MariaDB *is* the harbor, so a missing, malformed, or
  unreachable URL is a boot refusal, not a fallback
  (`src/lib/db/repos/bind.js:35`, `src/lib/db/mysql/adapter.js`,
  `src/lib/db/mysql/pool.js`).
- **Fix** — repair the URL or start the harbor. Under the bundled service,
  `VELA_MYSQL_URL` must match the twin's own credentials:

```yaml
VELA_MYSQL_URL: "mysql://vela:set-me-and-match-VELA_MYSQL_URL@vela-twin:3306/vela"
```

```bash
docker compose up -d vela-twin          # bring the harbor up first
docker compose ps                       # wait for (healthy)
docker compose up -d vela-gateway
```

If you meant to sail SQLite, set `VELA_DB_MODE: "sqlite"` — the mode is
resolved once per process, so it needs a container recreate.

### `DATA_DIR` is not writable

- **Symptom** — `[DATA_DIR] '<path>' not writable → fallback ~/.vela` in the
  logs; or on Windows, `[DATA_DIR] '<path>' is a Unix path on Windows →
  fallback to default`. The dashboard shows an empty harbor even though the
  volume looks populated.
- **Cause** — `getDataDir()` (`src/lib/dataDir.js:14–30`) **falls back silently**
  to the default home dir on `EACCES`/`EPERM`, and on Windows it rejects
  Unix-style absolute paths (`/var/lib/vela` and friends) outright. In
  Docker the entrypoint `chown`s `/app/data` and drops to the `node` user via
  `su-exec`, so a root-owned host bind-mount is the classic trigger.
- **Fix** — make the mount writable by the container user, and give the
  correct platform path:

```bash
# host side (Linux)
sudo chown -R 1000:1000 ./data
```

Keep `DATA_DIR: /app/data` inside the container and `- ./data:/app/data` on
the host. On Windows, use a Windows path (`C:\vela-data`), never a Unix one.
Because the fallback is silent, always confirm the resolved dir from the boot
line (`[DB] Driver: … | file: …`) rather than assuming.

---

## 🔑 Cannot Log In

### There is no default password

- **Symptom** — a remote browser is refused; the local console lets you in
  without asking. The refusal copy is exact:

```text
No dashboard password is configured. Remote login is disabled until one is set: on the Vela host, open the dashboard locally and set a password under Dashboard → Profile → Security → Change password — or set the INITIAL_PASSWORD environment variable and restart. Loopback (local) access stays open.
```

- **Cause** — the old `123456` fallback is **retired**. With no stored hash and
  no `INITIAL_PASSWORD`, nothing can authenticate a remote caller; loopback
  stays frictionless on purpose (`src/app/api/auth/login/route.js`,
  `src/lib/auth/loginMessages.js:14`).
- **Fix** — either open the dashboard **from the host itself** and set one
  under **Settings → Access** (the toggle and the "Set your first dashboard
  password" form live there; leave *Current password* empty on the first set),
  or set the environment and restart:

```yaml
INITIAL_PASSWORD: "change-me"
```

An empty current password is correct on the very first set — the form says so.
If **requireLogin** is switched off, Settings → Access states plainly that the
console opens without a password (`/api/settings/require-login`).

### The lockout ladder has you

- **Symptom** — the login form refuses with a retry-after, then keeps refusing
  through a restart; correct credentials still bounce.
- **Cause** — `src/lib/auth/loginLimiter.js` runs an escalation ladder —
  **5 failures → 1 min, 10 → 15 min, 20 → 1 hour** (`loginLimiter.js:44–46`) —
  and, since v0.9.76, keeps it in the `authFailures` table. The durable store
  is authoritative, so a restart does **not** clear it. A separate fixed-window
  limiter allows **10 attempts per 15 minutes per IP**
  (`loginLimiter.js:53–54`) regardless of password.
- **Fix** — wait out the window (the top tier is an hour), then authenticate
  once successfully; a success clears the counters entirely. If you must
  unstick it sooner, stop the app and clear the row in the SQLite harbor:

```bash
docker compose stop vela-gateway
# in $DATA_DIR/db/data.sqlite, from SQLite posture:
#   DELETE FROM authFailures;
docker compose start vela-gateway
```

Under `VELA_DB_MODE=mysql` the limiter's durable arm is the MariaDB harbor's
`authFailures` table instead — clear it there.

### Remote caller presenting the CLI token

- **Symptom** — a script or dashboard behind a tunnel answers **403** where
  the same call works from the host.
- **Cause** — locality-before-credential: the machine's CLI token
  (`x-vela-cli-token`) proves proximity to the box and is honored **only from
  a local origin**. A non-local caller that presents it is refused with
  **403**, not 401, on every seam (`src/dashboardGuard.js:101,505,522`,
  `presentsRemoteCliToken`).
- **Fix** — remote callers authenticate with an **API key** or a **JWT
  session** instead. For scripts on the box, keep them on loopback. The
  cli-tools `*-settings` writers and the process-spawning routes are
  loopback-only by design — that is not a bug to route around.

---

## 📡 Upstream Returns 401 / 403 / 429 / 402

One upstream status, four different stories. The client-facing mapping lives in
`open-sse/config/errorConfig.js:4–9`; the cooldowns in the same file
(`COOLDOWN` at `:57–60`, the 429 horizons at `:48–53`):

| Status | Client-facing type / code | What the gateway does |
|-|-|-|
| **401** | `authentication_error` / `invalid_api_key` | Tries a **token refresh** (up to 3 attempts), retries once if it lands, else cools the account **2 min** and falls to the next |
| **403** | `permission_error` / `insufficient_quota` | Same refresh attempt, then the same **2 min** cooldown and fallback |
| **402** | `billing_error` / `payment_required` | **2 min** cooldown, then fallback — no refresh |
| **429** | `rate_limit_error` / `rate_limit_exceeded` | Classified into a horizon (below), then fallback |

The refresh itself is `refreshWithRetry(refreshFn, maxRetries = 3)`
(`open-sse/services/tokenRefresh.js:260`) — up to **3** attempts, spaced
`attempt × 1000 ms`, logging under the `TOKEN_REFRESH` namespace.

**The `429` split (`open-sse/utils/classify429.js`).** One status hides three
failures with wildly different lifetimes:

| Verdict | Horizon | What it means |
|-|-|-|
| `rate_limit` | ~**60 s**, or the upstream's `Retry-After` (capped at `MAX_RATE_LIMIT_COOLDOWN_MS` = 30 min) | The transient per-minute window |
| `quota_exhausted` | **1 hour** | A monthly/credit cap |
| `daily_quota` | until the **next 00:00 UTC** — derived, never a fixed window (`classify429.js:164–168`) | A daily cap |

A plain `rate_limit` falls through to the untouched exponential backoff
(`BACKOFF_CONFIG` — `base: 2000`, `max: 5 min`, `maxLevel: 15`,
`errorConfig.js:32–36`). This distinction matters: before it, the text
`daily quota exceeded` matched the generic `quota exceeded` rule and a
dead-until-tomorrow account was retried all day.

**When everything is cooling** — `open-sse/utils/cooldownRetry.js` waits out a
short all-accounts cooldown (bounded at **30 s** — `MAX_RETRY_WAIT_MS`, exactly
**one** retry — `MAX_COOLDOWN_RETRIES`) rather than answering 503 immediately.
Beyond that bound it returns 503 — holding the connection longer has no chance
of success.

**Where to look:** the Providers page shows per-provider status and last error,
the **Request Logs** room shows `FAILED <status>` per request, and the
**Console Log** room carries the `TOKEN_REFRESH` retry and failure lines.

**Fix, by verdict:**

- *401 / 403 with an OAuth provider* — the refresh token is spent or revoked.
  Reconnect the account in **Providers → the provider → reconnect** (that walks
  the OAuth flow again). Rotating providers issue a new refresh token on every
  refresh; the gateway mutates credentials in place so retries do not reuse a
  consumed token, but a revoked grant needs a human.
- *402 / 403 quota* — top up the upstream account, or move it down the combo.
- *429 rate_limit* — wait; a combo or multi-account rotation routes around a
  single hot account automatically.
- *429 daily/quota* — the account is dead until the reset. Remove it from the
  combo, or add an operator **fallback rule** on status 429 so traffic detours
  on the first refusal instead of after a cooldown. (Note: fallback rules live
  only on the SQLite harbor — their MariaDB twin throws by name. See
  [STORAGE.md](./STORAGE.md#the-one-repo-with-no-twin).)

> ⚠️ **"429 — combo exhausted" is not a client 429.** It is the gateway's own
> answer (`code: "combo_exhausted"`, `status: 429`) when every member of a combo
> has failed. The client-facing status stays 429 (retry is correct for a combo),
> so an operator staring at a 429 should check Request Logs: if there is no
> upstream 429 beneath it, read the four rows above instead.

---

## 🧬 The CodeBuddy Family Refuses (11128)

The CodeBuddy family — `codebuddy-cn`, `codebuddy-intl`, `workbuddy-cn`,
`workbuddy-intl` — answers to one executor,
`open-sse/executors/codebuddy-family.js`. It has a failure mode of its own.

- **Symptom** — a CodeBuddy or WorkBuddy lane answers **HTTP 400** and the body
  carries business code **`11128`** (sometimes serialised `11-128`) with a
  channel-verification phrase. Rotating the account does not help; the same
  request fails on every credential.
- **Cause** — the channel rejection is per **body**, not per account. The
  executor recognises it by **both halves** — the `code` field *and* the wording
  (`hasChannelCode`, `shouldChannelFallback`,
  `open-sse/shared/codebuddy/channelCheck.js:34,97`). Recognition requires both;
  a bare code or bare phrase is not enough. A confirmed refusal on
  `/v2/chat/completions` earns **exactly one** retry against the console door
  (`#channelRefusal` → `#dialConsoleDoor`, `codebuddy-family.js:204–225`),
  carrying the identity headers so the diversion is not refused twice. If the
  console door does not answer, the refusal is returned as-is.
- **What it *does not* do** — it does not kill the account. A channel refusal is
  recorded through `breakerRecordAnswered`, not `breakerRecordFailure`
  (`codebuddy-family.js:218`; `gate.js:449`). Before that fix, every probe
  re-armed the breaker window and one refusal a minute kept the lane shut.
- **Fix** — treat it as a content/route problem, not a credential problem:
  rephrase or reduce the prompt, retry on a different member of the combo, or
  wait out the upstream's own channel window. If the console-door retry also
  fails, capture the body from Request Logs and compare its wording to the
  recogniser — a changed phrase is a recogniser that needs updating, not a
  gateway outage. The recogniser covers `/v2/chat/completions` only; another
  path is never diverted by design.

---

## 🚫 A Content-Filter Refusal

- **Symptom** — a CodeBuddy-family answer stops cleanly (`finish_reason:
  "stop"`) but the text is a canned apology, or the client receives **400** with
  `code: "content_filter"` — `codebuddy: upstream refused on content grounds`
  (or `… after partial output`).
- **Cause** — the upstream refuses a sensitivity block by *streaming an apology*
  and closing as though it succeeded. Downstream that is indistinguishable from a
  real answer unless something peeks. `#guardAgainstRefusal` peeks
  `open-sse/shared/codebuddy/contentFilter.js` over a **1024-byte** window
  (`FILTER_TEXT_LIMIT`) and matches the canned refusal **exactly** once
  normalized — whitespace collapsed, commas unified, trailing punctuation
  dropped. Substring matching on words like "sensitive" would flag every ordinary
  answer that discusses them, so it does not.
- **The two arms** — a pure refusal becomes an honest non-200 so combo fallback
  fires. If the stream also carried tool calls or reasoning, or more text
  arrived than the window could hold, the turn is **not** retried — the model
  may have been mid-work, and replaying it would double-spend the call.
- **Fix** — it is a content refusal, not a fault: adjust the prompt, switch the
  combo member, or accept the refusal. `breakerRecordAnswered` is what it
  records (`codebuddy-family.js:242`) — the breaker is not at fault, so a lane
  that keeps refusing will keep being *selected* while returning 400. If that is
  unwanted, place the fallback rule on the gateway side rather than waiting for
  a cooldown that will never come.

---

## 🔌 The Breaker Is Cooling

- **Symptom** — `debug` console line `CODEBUDDY breaker open — rotating away
  from <key>` (`codebuddy-family.js:196`); the lane answers a **synthetic 429**
  without ever dialling the upstream, so Request Logs show no upstream status
  beneath it.
- **Cause** — the per-key breaker (`open-sse/shared/codebuddy/gate.js`) opens at
  the failure threshold and stays open for `BREAKER_RESET_MS = 60_000`
  (`gate.js:337`). While open, **exactly one probe** is admitted (half-open);
  a success closes it, a terminal failure (`401`, `403`, `429`, `5xx`) re-arms
  it, and an *answered* refusal (`breakerRecordAnswered`) leaves an already-open
  window running but does not extend it. Under Bun the state is memory-only —
  `bindCodeBuddyBreaker` (`src/instrumentation.js:70`) persists it to the
  harbour on other runtimes.
- **Fix** — wait out the 60 s window and let the single probe through. If it
  keeps re-arming, the credential really is failing: read the probe's upstream
  status in Request Logs and treat it under
  [Upstream 401 / 403 / 429 / 402](#upstream-returns-401--403--429--402).
  Do not cycle the container to "clear" it — a restart re-binds the persisted
  store, so a cooldown that landed stays landed.

---

## 🌐 Upstreams Hang or Fail Behind a Proxy

- **Symptom** — every provider times out at once; a container that reaches the
  internet fine cannot reach OpenAI/Anthropic; or a proxy that works in the
  shell is ignored by Vela.
- **Cause** — Vela resolves its outbound egress from **settings**, not from
  your shell (`src/lib/network/outboundProxy.js`). When the proxy is enabled
  with a URL, the engine writes `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`
  (plus `NO_PROXY` / `VELA_NO_PROXY`) into its own process and marks them
  `VELA_PROXY_MANAGED=1`. When disabled, it clears **only** env it previously
  managed (`outboundProxy.js:30–53`) — so an externally exported proxy survives
  a disable. A URL with a scheme outside
  `http|https|socks5|socks4|socks5h|socks4a` (`:6`), or containing a
  newline/backtick/`$`, is rejected silently.
- **Fix** — set the proxy in the dashboard, not the shell: **Settings →
  Network → outbound proxy** (`outboundProxyEnabled`, `outboundProxyUrl`,
  `outboundNoProxy`), then press **Test proxy URL**. The probe posts to
  `POST /api/settings/proxy-test` (`src/app/api/settings/proxy-test/route.js`).

```yaml
# or pin it in the chart's environment (lowercase variants also work)
HTTP_PROXY: "http://127.0.0.1:7890"
HTTPS_PROXY: "http://127.0.0.1:7890"
NO_PROXY: "localhost,127.0.0.1,vela-twin"
```

Three traps worth naming:

1. **`NO_PROXY` must carry the internal hosts.** Inside Compose the twin and
   sidecar are reached by service name — if they ride the outbound proxy,
   MariaDB and Headroom will both appear "unreachable".
2. **A refused test is a 422, not a 400.** The proxy-test surface runs the
   provider-URL safety gate (`src/lib/network/providerUrlSafety.js`); a refusal
   answers **422** deliberately (`REFUSAL_STATUS`, `src/lib/network/proxyTest.js:27`),
   because **400** sits in `DETERMINISTIC_FAILURE_STATUSES = {400, 404, 410}`
   (`proxyTest.js:266`) and would have classified the pool *DEAD* and disabled
   it — a pool deleted by a bad test.
3. **A dead proxy must not fail closed into silence.** Test from the same
   container (`docker compose exec vela-gateway wget -qO- https://api.openai.com`),
   never from the host — the two have different egress.

---

## 🔤 Icons Render as Raw Text

- **Symptom** — beside real glyphs, an icon renders as a literal word
  (`table_rows`, `add_link`) in a wide serif face. The build is green; the only
  symptom is visual.
- **Cause** — Material Symbols renders by **GSUB ligature**: the string
  `search` substitutes to one glyph. Vela ships a pruned subset
  (`public/fonts/vela-icons.<sha16>.woff2`) whose GSUB table is cut down to the
  inventory in **`scripts/icon-ligatures.txt`**. A name outside that inventory
  has no substitution, so the raw text draws instead
  (`scripts/subset-icons.py`; guard in `tests/unit/icon-subset.test.js`).
- **Fix** — add the name to the inventory, re-mint the font, commit both the
  font and the manifest:

```bash
pip install fonttools brotli
py -3.12 scripts/subset-icons.py            # writes the new font + manifest
py -3.12 scripts/subset-icons.py --check    # drift check (non-zero on mismatch)
npx vitest run -c tests/vitest.config.js tests/unit/icon-subset.test.js
```

The subset script scans five shapes (`icon="name"`, `icon: "name"`, ternary
pairs, `|| "name"` fallbacks, and the inline
`<span class="material-symbols-outlined">name</span>` form); the guard scans
the two literal spellings. The font is **content-hashed**, so `globals.css`'s
`@font-face` src is rewritten to the new file name and no browser can serve a
stale subset.

---

## 💰 Estimated Cost Shows $0

- **Symptom** — usage rows carry tokens but `$0.00` cost; the ledger never
  totals.
- **Cause** — the model resolved **`null`** through the pricing chain. A null
  price is an honest answer, not a bug: `getPricingForModel(provider, model)`
  (`open-sse/providers/pricing.js:841`) returns `null` when nothing matches, and
  `resolvePricingWithProvenance` (`:900`) returns `null` with it. The chain,
  first match wins (`pricing.js:1–21`):

| # | Stratum | Notes |
|-|-|-|
| 3.0 | `UNPRICEABLE` manifest | Router pseudo-models and no-token-pricing lanes resolve `null` **by decree** |
| 3.a/b | `PROVIDER_PRICING[id\|alias][model]` | Provider-lane override, id first then alias |
| 3.c | `MODEL_PRICING[model]` | Canonical exact match |
| 3.d | `FREE_ALIAS_MAP` + guarded suffix-strip | A free model inherits its paid sibling's worth, with a `FREE_DENYLIST` blocking router traps |
| 3.e | `MODEL_PRICING[stripVendor(model)]` | Vendor prefix stripped (`deepseek/deepseek-chat`) |
| 3.f | `PATTERN_PRICING` | Pre-compiled globs — the last resort |

  Above the static chain sit the async layers: user overrides (scope `pricing`)
  and models.dev sync (scope `pricing_sync`), in
  `src/lib/db/repos/pricingRepo.js`.
- **Fix** — give the model a rate. The dashboard path is the canonical one:
  **Settings → Billing → Custom Pricing**, under the "Custom Pricing: You can
  override default pricing for specific models" panel. The same room carries
  **Sync Prices** (pull catalog rates from models.dev) and **Clear Synced
  Prices**. Their route contracts (measured at v1.2.5):

```text
GET    /api/pricing          → merged user + default pricing
PATCH  /api/pricing          → { "<provider>": { "<model>": { "input": <usd/Mtok>,
                                 "output": <usd/Mtok>, "cached": <usd/Mtok> } } }
DELETE /api/pricing          → reset (?provider=x&model=y to scope it)
GET    /api/pricing/sync     → current synced rates
POST   /api/pricing/sync     → fetch models.dev rates
DELETE /api/pricing/sync     → clear them
```

  These sit under `/api/*` and are **guarded** — reach them from a logged-in
  dashboard session, or from the box itself with the machine CLI token
  (`x-vela-cli-token`); a remote shell without either is refused. For a fix
  that ships to everyone rather than one install, add the rate (or a pattern)
  to `MODEL_PRICING` / `PATTERN_PRICING` in `open-sse/providers/pricing.js`.
  If the model genuinely has no token price — a router pseudo-model, a
  subscription lane — add it to `UNPRICEABLE` with a reason, so the `$0` is
  documented rather than merely unexplained.

---

## 🪞 The Mirror Is Degraded

- **Symptom** — the primary keeps serving, but the twin lags or stops
  receiving; the console carries `[mirror]` backoff lines; the backup ledger
  gains `mirrorPoison` or `mirrorDivergence` rows.
- **Cause** — under `VELA_DB_MODE=mirror` the SQLite primary serves every
  read/write and an **outbox pump** carries mutations to the MariaDB twin. A
  down twin means the pump backs off (5 s → 5 min cap), the outbox
  accumulates, and the mode **stays mirror** — it never silently downgrades.
  Two distinct failures write the ledger:
  - **`mirrorPoison`** — a *deterministic* replay failure poisons
    **immediately**; an *infrastructure* failure burns a **5-attempt** retry
    budget first (`VELA_MIRROR_MAX_RETRIES`). Poison never head-of-line-blocks
    the queue, and every outbox row ages out after **7 days** regardless of
    status (a `mirrorAgeOut` row names the loss).
  - **`mirrorDivergence`** — the divergence sweep fingerprints both harbors
    per table, writes a loud ledger alert on any mismatch over
    `VELA_MIRROR_DIVERGENCE_THRESHOLD`, and (with
    `VELA_MIRROR_SWEEP_AUTORESYNC=true`, the default) runs a **full resync**.
    A pump mid-drain carries *intentional* lag, not divergence — the sweep
    refuses to fingerprint while rows are in flight
    (`{swept: false, skipped: "drain-in-progress"}`), so an outage window never
    reads as drift.
- **Fix** — restore twin reachability first; the rhythms heal it.

```bash
docker logs -f vela-gateway | grep -i mirror      # watch the pump back off / recover
docker compose ps                                 # is vela-twin (healthy)?
docker compose logs --tail=50 vela-twin           # did the twin actually accept connections?
```

  Then: the pump's **boot catch-up** fires an immediate drain on restart, so a
  restart after the outage drains the backlog before the first tick. The
  divergence sweep runs on `VELA_MIRROR_SWEEP_INTERVAL_MINUTES` (**360** by
  default) with a boot pass inside 10 s (`mirrorSweep.js:249`). Inspect the
  evidence with:

```bash
curl -s http://localhost:32060/api/backup/list    # ledger rows, metadata only
curl -s http://localhost:32060/api/backup/status  # degraded flag
```

  There is **no dashboard button** for a manual resync — the sweep is the
  conductor (`runFullResync`, `src/lib/db/mirror/mirrorSweep.js`). If a
  poisoned row must be replayed, it is replayed deliberately from the outbox,
  not by re-enabling the pump and hoping. Full covenant: [STORAGE.md](./STORAGE.md).

---

## 🛟 A Backup Will Not Restore

- **Symptom** — restore answers 400 with one of a small set of lines; or the
  artifact simply cannot be opened.
- **Cause and fix**, by the message. The restore route **sanitises** the error
  (`src/app/api/backup/restore/route.js:39–53`): only key-material refusals and
  the schema line surface verbatim — every other cause reads `Restore failed`.
  So "Restore failed" is the ledger-and-console case, not a new message.

| Message | Cause | Fix |
|-|-|-|
| `[backup] VELA_BACKUP_ENCRYPTION_KEY is not set — the backup engine refuses to run …` | The engine has no key. It **refuses**, deliberately | Set `VELA_BACKUP_ENCRYPTION_KEY`; the engine never runs keyless |
| `[backup] VELA_BACKUP_ENCRYPTION_KEY is too short (< 16 chars) …` | Minimum-entropy validation failed | Use a long, deliberately chosen key |
| `Artifact verification failed — wrong key or corrupted backup` | AES-256-GCM tag mismatch — wrong key, or the bytes are damaged | Try the key the artifact was written with. **A lost key is unrecoverable** |
| `[backup] artifact schema version N is newer than this build (23) — refusing to restore` | The artifact came from a newer Vela | Upgrade Vela, then restore |
| `Restore failed` | Everything else — `adoptSecrets` without `confirmSecrets`, a malformed payload, a `MAX_PAYLOAD_BYTES` breach, or a mid-restore fault | Read the `failed`/`restore` ledger row and the console; the row's `error` column holds the detail the HTTP surface withholds |
| Restore said `restartRequired: true` | The JWT signing key is captured at **module load**; the restored bundle's key will not match until the process restarts | Restart: `docker compose restart vela-gateway` |

- **The one that cannot be fixed.** Artifacts are sealed **AES-256-GCM** with a
  key derived by **scrypt** (`N=2^17, r=8, p=1`) from
  `VELA_BACKUP_ENCRYPTION_KEY` alone. There is no recovery path, no escrow, no
  back door. `README` it, print it, store a copy **offline** — with the same
  care as the database itself. This is stated in `.env.example` and the compose
  template for exactly this reason.
- **Rehearse before you need it.** The restore **drill** decrypts the newest
  artifact, migrates a scratch DB, imports the payload into it, and censuses the
  restored rows — a dry-run against the S1 shape gate first, then the real
  import; the live adapter is never touched. It re-confirms the dashboard
  password (S4):

```bash
curl -X POST http://localhost:32060/api/backup/drill \
  -H 'Content-Type: application/json' -d '{"password":"<dashboard password>"}'
```

  A safety backup is taken before a real restore, so a failed crossing is not
  a one-way trip.

---

## 📜 Usage or Logs Missing After a Move

- **Symptom** — after relocating the deployment, usage history and the request
  ledger are empty, though `data.sqlite` looks present. Or: settings survived
  the move but the CLI and Tailscale state did not.
- **Cause** — two different notions of "home" exist, and they diverge the
  moment `DATA_DIR` is set:
  - **Usage and logs live in the harbor.** `src/lib/usageDb.js` is a shim onto
    the SQLite layer — `getUsageHistory`, `getRecentLogs`,
    `getRequestDetails` all read `$DATA_DIR/db/data.sqlite`. Move `DATA_DIR`
    without carrying the file, and the ledger travels nowhere.
  - **A handful of side-state artifacts do not follow `DATA_DIR`.** The CLI's
    own data dir (`cli/cli.js`'s `getAppDataDir()`) and Tailscale's
    `--statedir` resolve from the **legacy** home — `%APPDATA%\vela` on
    Windows, `~/.vela` elsewhere. That is the `~/.vela` trap: it is the
    *default* value of `DATA_DIR`, not a follower of it. (`mitmAliasCache.js`
    and the updater's copy-out dir **do** honor `DATA_DIR`.)
  - **The JSON era is a one-time import.** Legacy `usage.json`,
    `request-details.json`, `disabledModels.json`, and `db.json` under
    `DATA_DIR` are read once into SQLite on a fresh harbor and kept on disk
    (a `.migrated-from-json` marker in `$DATA_DIR/db/` prevents a second pass).
    Finding those files present is **not** evidence that usage is being written
    there — after the migration, they are archaeology.
- **Fix** — carry the harbor, not just the app:

```bash
# stop, copy the whole data dir, then start at the same DATA_DIR
docker compose stop vela-gateway
rsync -a ./data/ /new/vela-data/
# start the new berth with DATA_DIR pointing at the copy
```

  Then confirm which dir actually resolved — the boot line names the file:
  `[DB] Driver: node:sqlite | file: /app/data/db/data.sqlite`. If usage is
  still empty after a confirmed-correct path, the deployment likely started
  from a fresh harbor and the legacy JSON was in a *different* directory than
  the one now configured. Restore a sealed backup to bring it back.

  And if request **bodies** are missing while the ledger rows are fine, that is
  observability, not data loss — see
  [Gather Evidence First](#gather-evidence-first).

---

## 🗄️ The DB Driver Fell Back

- **Symptom** — boot logs `[DB] Driver: sql.js | file: …` where you expected
  `node:sqlite` or `better-sqlite3`; the dashboard feels slow under load, or a
  large harbor loads into memory.
- **Cause** — the driver chain is tried in order, first that loads wins:
  Bun: `bun:sqlite` → `sql.js`; Node: `better-sqlite3` (optional native dep) →
  `node:sqlite` (Node ≥ 22.5) → **`sql.js`** (pure-JS, the always-works last
  resort). A fallback is not an error — `sql.js` is what makes the gateway
  never fail to boot — but it is a **pure-JS WASM** engine with a small default
  heap, and it is the slowest leg (`src/lib/db/driver.js:126–140`).
- **Fix** — read the boot line, then pin the driver deliberately:

```bash
docker logs vela 2>&1 | grep "\[DB\] Driver"   # the line also marks "(forced)" when pinned
```

```yaml
VELA_DB_DRIVER: "node:sqlite"    # or better-sqlite3 / bun:sqlite / sql.js
```

  With `VELA_DB_DRIVER` set, **only** that driver is tried and failure is
  **loud** — it throws rather than falling through:

```text
[DB] unknown VELA_DB_DRIVER "<x>" — expected bun:sqlite | better-sqlite3 | node:sqlite | sql.js
[DB] VELA_DB_DRIVER="<x>" is not available in this runtime
```

  Two honest notes: `better-sqlite3` sits in `optionalDependencies`, so an
  install without build tools never fails — it simply skips the native leg; and
  `node:sqlite` needs **Node ≥ 22.5** (checked as
  `maj < 22 || (maj === 22 && min < 5)` at `driver.js:36`, and it is skipped
  under Bun). Below that, the native addon or `sql.js` carries you. Migrations
  always run — the schema is not the variable; only the engine is.

---

## 📋 Symptom → First Move

| Symptom | First move | Section |
|-|-|-|
| Container restarts in a loop | `docker logs vela`, look for `EADDRINUSE` | [↗](#the-server-will-not-boot) |
| Boot refuses: `VELA_MYSQL_URL …` | Fix the URL, or `VELA_DB_MODE: "sqlite"` | [↗](#the-server-will-not-boot) |
| Empty harbor, `[DATA_DIR] … fallback` | `chown` the mount; check the platform path | [↗](#the-server-will-not-boot) |
| Remote login refused, local fine | Set a password (Settings → Access) or `INITIAL_PASSWORD` | [↗](#cannot-log-in) |
| Login still refuses after restart | Wait out the lockout ladder (5/10/20 → 1m/15m/1h) | [↗](#cannot-log-in) |
| One provider 401/403 | Reconnect the account (OAuth) | [↗](#upstream-returns-401--403--429--402) |
| One provider 429, others fine | Wait, or let account rotation route around it | [↗](#upstream-returns-401--403--429--402) |
| 429 with no upstream status beneath it | Check for `combo_exhausted` in Request Logs | [↗](#upstream-returns-401--403--429--402) |
| CodeBuddy/WorkBuddy 400 with `11128` | Not a credential — rephrase, rotate member, wait out the channel | [↗](#the-codebuddy-family-refuses-11128) |
| CodeBuddy answer is a canned apology | Content-filter refusal — adjust prompt or member | [↗](#a-content-filter-refusal) |
| `breaker open — rotating away` | Wait 60 s for the probe; re-arm means the key is failing | [↗](#the-breaker-is-cooling) |
| All providers time out at once | Settings → Network → Test proxy URL | [↗](#upstreams-hang-or-fail-behind-a-proxy) |
| `table_rows` beside the glyphs | Add to `icon-ligatures.txt`, re-mint the subset | [↗](#icons-render-as-raw-text) |
| `$0.00` estimated cost | Rate the model (Settings → Billing, or `PATCH /api/pricing`) | [↗](#estimated-cost-shows-0) |
| Twin lags, `[mirror]` backoff | Restore twin reachability; the sweep resyncs | [↗](#the-mirror-is-degraded) |
| Restore answers 400 | Read the message — key? schema? or `Restore failed` → ledger | [↗](#a-backup-will-not-restore) |
| Usage empty after a move | Carry `$DATA_DIR/db/data.sqlite` | [↗](#usage-or-logs-missing-after-a-move) |
| `Driver: sql.js` in the boot line | Pin `VELA_DB_DRIVER`; check the Node version | [↗](#the-db-driver-fell-back) |

---

## 🔗 See Also

- [ARCHITECTURE.md](./ARCHITECTURE.md) — the request lifecycle, the DB layer, the pricing covenant
- [STORAGE.md](./STORAGE.md) — postures, the mirror pump, backups, recovery
- [ENVIRONMENT.md](./ENVIRONMENT.md) — every variable, its default, and its effect
- [DEPLOYMENT.md](./DEPLOYMENT.md) — install paths, the compose chart, upgrading
- [API.md](./API.md) — the gateway surface and the dashboard REST
- [PROVIDERS.md](./PROVIDERS.md) — the CodeBuddy family lanes, one line each
- [../DOCKER.md](../DOCKER.md) — the image, volumes, and the container rites

— *Vela · The Sail of the Ship* ⛵
