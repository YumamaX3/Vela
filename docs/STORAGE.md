# 🗄️ Vela Storage

> *"A harbor is only as trustworthy as the ground beneath it. This chart names
> the two harbors a Vela may moor in, the three postures it can sleep in, the
> pump that carries the primary's writes to its twin, the sealed artifacts that
> outlive the ship, and the rules that keep a restore from becoming a wreck.
> Every number here was sounded, not assumed."*

**Covers:** `DATA_DIR` · the two harbors · the three postures · the driver chain ·
migrations & the additive sync · `001`–`023` · the mirror pump & divergence sweep ·
the backup engine · restore & drill · S3 off-site · recovery · trust boundaries ·
operating the harbors.

**Counts in this chart were sounded on 2026-10-28 at v1.2.4.** Each carries the
command that re-derives it; re-run the command rather than trusting the prose
after a tide.

---

## Table of Contents

- [The Two Harbors](#the-two-harbors)
- [The Three Postures](#the-three-postures)
- [The Driver Chain](#the-driver-chain)
- [Migrations & the Additive Sync](#migrations--the-additive-sync)
- [The Mirror](#the-mirror)
- [The Backup Engine](#the-backup-engine)
- [Recovery](#recovery)
- [Trust Boundaries at Rest](#trust-boundaries-at-rest)
- [Operating the Harbors](#operating-the-harbors)

---

## 🗄️ The Two Harbors

State lives in one of two engines: **SQLite**, the harbor every deployment
starts in, and **MariaDB** (through `mysql2`), reachable either as the full
harbor or as a twin. Postures, the mirror and backups all hang off that pair.

`src/lib/dataDir.js` resolves the data directory once, at module load
(`getDataDir()`, `dataDir.js:14`):

| Condition | Result |
|-|-|
| `DATA_DIR` set and writable | that path, verbatim |
| `DATA_DIR` unset | `%APPDATA%\vela` on Windows, `~/.vela` elsewhere |
| `DATA_DIR` a Unix-style path on Windows (`/var/lib/…`) | **ignored** — warning, default used (`dataDir.js:21`) |
| `DATA_DIR` not writable (`EACCES`/`EPERM`) | warning, default used (`dataDir.js:29`) |

`src/lib/db/paths.js` derives everything below it:

```text
$DATA_DIR/
├── db/
│   ├── data.sqlite           # the SQLite harbor (DATA_FILE)
│   ├── .migrated-from-json   # one-time legacy-import marker
│   └── backups/
│       ├── <label>-<ver>-<timestamp>/   # pre-schema + pre-restore safety copies
│       └── artifacts/                   # sealed .velabak artifacts
├── jwt-secret · api-key-secret · machine-id     # the secret bundle
├── update/ · runtime/updater/                   # updater status + installer
└── globalState.json · secrets.json · auth.json   # CLI-tool settings
```

> 📌 `db.json`, `usage.json`, `disabledModels.json` and `request-details.json`
> also live under `DATA_DIR` (`LEGACY_FILES`) — as **import sources only**. They
> are read once when the SQLite file is fresh, then left in place, with
> `.migrated-from-json` preventing a re-import. Usage itself lives in SQLite;
> `src/lib/usageDb.js` is a shim onto `@/lib/db/index.js`.

> 📌 Request logs are **not** here: `open-sse/utils/requestLogger.js` writes to
> `logs/` under the process working directory, only when
> `ENABLE_REQUEST_LOGS=true` (default off).

> ⚠️ Settings → Database shows `~/.vela/db/data.sqlite` as a static, read-only
> label. The real path always follows `DATA_DIR`.

---

## 🗝️ The Three Postures

`VELA_DB_MODE` (`src/lib/db/repos/bind.js`) resolves once per process, accepts
exactly three values, and throws at the seam on anything else:

| Posture | Serving harbor | Writes | Reads | Migrations |
|-|-|-|-|-|
| `sqlite` **(default)** | the mounted SQLite file | local | local | versioned chain + additive sync |
| `mysql` | MariaDB — *it is* the harbor | MariaDB | MariaDB | **never** — `bootstrapMysql` additive diff against `TABLES` |
| `mirror` | SQLite **primary** serves everything | SQLite, captured to the outbox → pump → MariaDB twin | SQLite | versioned chain + additive sync on the primary |

**`sqlite`** — one file, one writer, no network. In Docker the volume *is* your
state; mount it or the harbor sails away with the container.

**`mysql`** — needs `VELA_MYSQL_URL` (`mysql://user:pass@host:3306/vela`). The
pool binds on **first use** (`src/lib/db/mysql/adapter.js`) and refuses loudly:
no URL, a malformed URL, or an unreachable server each throw by name, and a
failed bind clears its cached promise so a transient outage stays retryable.
Nothing here falls back to SQLite — an unreachable harbor refuses, never silently
downgrades (`bind.js:35`).

**`mirror`** — serves every read and write from the SQLite primary and carries
writes to the twin through the outbox pump. `bindFacade()` returns the SQLite
harbor wrapped by `decorateMirrorRepo()` (`bind.js:192`), so the barrel's shape
does not change.

> 🪞 **A down twin degrades the mirror; it never silently downgrades the mode.**
> The primary keeps serving, the outbox accumulates, the pump backs off, and
> mode stays `mirror`.

### A foreign MariaDB is never version-migrated

`src/lib/db/mysql/bootstrap.js` brings the twin to `TABLES` parity by
**additive diff only** — create missing tables, add missing columns, create
missing indexes; never drop, never alter. Two security closures from migration
002 (tombstone legacy plaintext `apiKeys`, scrub `usageHistory.apiKey`) are
ported to MySQL syntax and tracked in `_meta.mysqlSecurityClosures`
(`bootstrap.js:68`); the migration-008 `statusClass` backfill is ported the same
way (`_meta.mysqlM008Backfill`, `bootstrap.js:93`), batched in 10k-row chunks.

Pool shape (`src/lib/db/mysql/pool.js`): `connectionLimit: 8`, keepalive 10s,
`connectTimeout: 4_000`, `multipleStatements`, `decimalNumbers` (so
`DECIMAL(12,6)` cost arrives as a number), one retry on `ECONNRESET`
(`pool.js:57–75`).

### The one repo with no twin

Twenty-eight files stand in `src/lib/db/repos/mysql/`, and all but one carry real
work:

```bash
ls src/lib/db/repos/mysql/ | wc -l      # 28
```

> ⚠️ **`fallbackRules` alone throws.** Every reader and writer in
> `repos/mysql/fallbackRulesRepo.js` throws
> `[DB] VELA_DB_MODE=mysql — fallbackRulesRepo mysql twin not yet implemented`
> — measured at v1.2.4: **6** throws in that file, and no other twin repository
> carries an "unimplemented" throw.

```bash
grep -c "not yet implemented" src/lib/db/repos/mysql/fallbackRulesRepo.js   # 6
grep -rln "not yet implemented" src/lib/db/repos/mysql/                    # fallbackRulesRepo.js only
```

That is not an accident of sequencing. `fallbackRules` is born of the migration
chain (see [the `fallbackRules` trap](#the-fallbackrules-trap)) and is **not in
`TABLES`**, so `bootstrapMysql` — which iterates `TABLES` — never creates it on
the MariaDB harbor. Operator fallback rules therefore do not live on the
`mysql` harbor today; they live on SQLite, and on a `mirror` twin they do not
replicate.

---

## 🧭 The Driver Chain

`src/lib/db/driver.js` resolves the SQLite driver once per process and caches the
adapter on `global._dbAdapter`, so a dev hot-reload never opens a second handle.

| Runtime | Order tried |
|-|-|
| Bun | `bun:sqlite` → `sql.js` |
| Node | `better-sqlite3` → `node:sqlite` (Node ≥ 22.5) → `sql.js` |

`better-sqlite3` is an optional dependency, so install never fails without build
tools. `node:sqlite` is gated on the version (`driver.js:36`:
`if (maj < 22 || (maj === 22 && min < 5)) return null;`, and it returns `null`
under Bun where the module does not exist). `sql.js` is the pure-JS floor —
WASM, always available, the Docker runner's fallback, and the driver the
migration suite deliberately boots.

`VELA_DB_DRIVER` pins exactly one driver; an unknown value throws with the
accepted list (`bun:sqlite | better-sqlite3 | node:sqlite | sql.js`,
`driver.js:95`) and an unavailable one throws rather than falling through
(`driver.js:99`). That is the parity harness's knob — it must be able to force
the fragile corners.

The adapter surface is `run / get / all / exec / transaction`, and **there is no
public `prepare()`**. Migrations and repos introspect with
`db.all("PRAGMA table_info(…)")` + `db.exec(…)`; a `db.prepare` in a migration is
what crashed every DB-facing API at boot in v0.9.19.

The pragmas are declared in `src/lib/db/schema.js:9–15`:

```text
journal_mode = WAL   synchronous = NORMAL   temp_store = MEMORY
mmap_size = 30000000                        cache_size = -64000 (≈64 MB)
foreign_keys = ON    busy_timeout = 5000
```

> 🔎 `getAdapterSync()` serves the few callers that must stay synchronous (the
> durable login limiter). It throws `adapter not initialized — await
> getAdapter() first` rather than opening a harbor as a side effect of an import.

> 🔎 `getScratchAdapter(filePath)` (`driver.js:115`) resolves a driver, runs the
> **full** migration chain with `skipBackup: true`, and returns the throwaway
> adapter. The restore drill rides it (§ Recovery). A scratch file never writes
> into the operator's real `backups/` directory — that was a drill casualty once,
> and the skip is the scar.

---

## 📜 Migrations & the Additive Sync

`SCHEMA_VERSION = 23` (`src/lib/db/schema.js:6`), with migrations `001`–`023`
in `src/lib/db/migrations/`:

```bash
grep -n SCHEMA_VERSION src/lib/db/schema.js          # 6:export const SCHEMA_VERSION = 23;
ls src/lib/db/migrations | grep -c '^0'              # 23
```

At every boot of the SQLite harbor, `src/lib/db/migrate.js` runs these steps in
order (`migrate.js:280–343`):

1. **Pre-schema safety backup** — taken *before* anything mutates, into
   `backups/schema-<stored>-to-<SCHEMA_VERSION>-<ver>-<timestamp>/`.
   Fresh databases skip it. The gate is **`storedSchemaVer < SCHEMA_VERSION`
   *or* pending migrations exist** (`schemaChanging`, `migrate.js:299–300`) —
   the old "bump-only" gate let a migration that UPDATEs or DROPs data run with
   no net at all, and the `pendingCount` half is the fix (DLV-3). Keeping
   `SCHEMA_VERSION` honest is still worth it, but a forgotten bump no longer
   skips the copy. A backup failure warns and continues.
2. **Versioned chain** (`runVersionedMigrations`, `migrate.js:96–124`) — pending
   migrations apply in order, each in its own transaction with `schemaVersion`
   stamped **inside that transaction**. Skip-version safe: a database four
   versions behind applies all four. When nothing is pending, a
   `repairMissingDeclaredTables()` pass still runs defensively.
3. **Additive sync** — `syncSchemaFromTables()` (`migrate.js:128`) walks
   `TABLES`: create missing tables, diff columns via `PRAGMA table_info`, add
   what is missing (stripping `PRIMARY KEY`/`UNIQUE`, which SQLite accepts only
   at create time), re-run the declared indexes idempotently.
4. **Stamp** — `_meta.backupSchemaVersion` is set to `SCHEMA_VERSION` so the
   next boot skips the pre-schema copy.
5. **One-time legacy import** — only when the DB was fresh *and* a legacy JSON
   file exists *and* `.migrated-from-json` is absent. Each table's row count is
   asserted against the input; a mismatch aborts the transaction
   (`MigrationAborted`), keeps the JSON, and leaves the marker unwritten so the
   next boot retries. The 002 tombstone/scrub runs again over the imported rows.

| # | Name | What it sealed |
|-|-|-|
| 001 | `initial` | Base schema |
| 002 | `apikey-governance` | `keyHash`/`keyPrefix`, tombstone + scrub, UNIQUE index |
| 003 | `key-categories` | Key categories |
| 004 | `usage-dedupe` | Usage dedupe |
| 005 | `backup-ledger` | The backup ledger table |
| 006 | `outbox` | The mirror's write journal |
| 007 | `mirror-seq` | The mirror cursor |
| 008 | `usage-telemetry` | Latency/TTFT/`httpStatus`/`statusClass` |
| 009 | `saved-views` | Observatory views |
| 010 | `usage-request-tags` | Request tags |
| 011 | `proxy-fitness` | Circuit-breaker state |
| 012 | `fallback-rules` | Operator fallback rules |
| 013 | `key-acl` | `allowedKinds`/`allowedProviders`/`allowedCombos` |
| 014 | `fallback-rules-v2-triggers` | Typed triggers, condition ops, `targetModels` |
| 015 | `combo-usage` | Per-combo usage attribution |
| 016 | `auth-sessions-audit` | Session ledger, durable limiter ground, audit trail |
| 017 | `auth-users` | Dashboard user records |
| 018 | `log-events` | The `logEvents` table |
| 019 | `circuit-breaker-keys` | Per-key circuit-breaker state |
| 020 | `guardrails` | Guardrail policies + logs |
| 021 | `credential-vault` | The sealed credential vault |
| 022 | `semantic-cache` | Semantic-cache state |
| 023 | `plans` | The `plans` table |

```bash
ls src/lib/db/migrations          # 001-initial.js … 023-plans.js + index.js
```

> ⚠️ **`SCHEMA_VERSION` is the safety-backup counter, not the sync's list.** The
> additive sync runs from `TABLES` regardless. Bump it when a migration lands —
> a bumped counter with no migration still takes its snapshot, and a skipped
> snapshot is how you discover you needed one.

`TABLES` itself holds **24** keys — `_meta`, `settings`, `providerConnections`,
`providerNodes`, `proxyPools`, `apiKeys`, `plans`, `combos`, `kv`,
`usageHistory`, `usageDaily`, `usageViews`, `usageRequestTags`,
`requestDetails`, `backupLedger`, `proxyFitness`, `circuitBreakerKeys`,
`guardrailPolicies`, `guardrailLogs`, `authSessions`, `authFailures`,
`authAuditLog`, `authUsers`, `logEvents`:

```bash
grep -cE "^  [_a-zA-Z]+: \{" src/lib/db/schema.js    # 24
```

### The `fallbackRules` trap

`fallbackRules` is **not in `TABLES`** — it is born of migration 012 (v2 columns
from 014). The versioned chain **must** run for that table to exist at all; the
additive sync cannot create it or supply its columns. On the MariaDB side
`bootstrapMysql` iterates `TABLES`, so the twin never creates it either, and its
twin repo throws by name (see [the one repo with no twin](#the-one-repo-with-no-twin)).
Before assuming `TABLES` covers a table, check: it is a declarative mirror of the
schema, not the schema itself.

---

## 🪞 The Mirror

The Storage Covenant's waves C1–C6, and the only place where two engines must
agree:

```text
write → outbox capture (decorator) → pump → MariaDB twin
                                  ↘ poison policy after the retry budget
divergence sweep (interval) → threshold breach → full resync
usage rows → watermark resync (separate rhythm, batched)
```

| Wave | File | Responsibility |
|-|-|-|
| C1 | `src/lib/db/mirror/replayRegistry.js` | the replay-class taxonomy (binding law) |
| C2 | `src/lib/db/mirror/mirrorDecorator.js` | outbox capture, atomic with the writer |
| C3 | `src/lib/db/mirror/mirrorPump.js` | the seq-ordered single writer |
| C4 | `src/lib/db/mirror/mirrorSweep.js` + `mirrorFingerprint.js` | divergence sweep + full resync |
| C4 | `src/lib/db/mirror/usageResync.js` | usage watermark resync |
| C5 | `src/lib/db/repos/bind.js` + `src/shared/services/mirrorStartup.js` | binding + the startup matrix |
| C6 | `src/lib/db/repos/s3Offsite.js` | the off-site leg (backs up, not replicates) |

Primary-side statements live in `repos/sqlite/outboxRepo.js`,
`repos/sqlite/usageResyncRepo.js` and `repos/sqlite/mirrorSweepRepo.js`; the twin
side in `repos/mysql/mirrorApplyRepo.js`, `repos/mysql/usageResyncRepo.js` and
`repos/mysql/mirrorSweepRepo.js`. Neither the pump nor the sweep touches a driver
directly.

### C1 — the replay classes

| Class | Meaning | Captured |
|-|-|-|
| `idempotent-upsert` | replays to the same terminal state (kv upserts, deletes-by-id, toggles, full-scope replaces) | `{fnName, args}` |
| `identity-carrying` | replay must insert the **same** generated identity | `{fnName, args, identity}` |
| `rmw-stale-hazard` | read-modify-write, applied cursor-monotonically and deduped at apply by a seq row in the same twin transaction | `{fnName, args}` |
| `exempt` | never arg-replayed: usage rides the watermark resync; buffered flushes are uncaptureable at facade return | nothing |

Without identity capture, `createCombo` would re-mint a uuid on the twin and
`combos.name` UNIQUE would turn every retry into a poison loop.

### C2 — atomic capture

The outbox `INSERT` rides the **same savepoint** as the writer's mutation
(`withOutboxCapture`), so they commit together or not at all — proven across
`better-sqlite3`, `node:sqlite` and `sql.js`. The cargo is censored at the
source: `createApiKey` captures the **key hash**, `keyPrefix` and `createdAt`
(never the plaintext key, never the `keyId`, since `API_KEY_SECRET` makes an
internal key re-derivable from one); connection/node/pool creators capture
`{id, createdAt, updatedAt}` only; `touchKeyLastUsed` is classified but
deliberately not captured — a throttled, sweep-excluded timestamp is outbox noise.

### C3 — the pump

| Knob | Value | Home |
|-|-|-|
| Batch | `100` rows per fetch (`PUMP_BATCH`) | `mirrorPump.js:50` |
| Healthy tick | `15s` (`HEALTHY_TICK_MS`) | `mirrorPump.js:51` |
| Backoff | `5s` → `5min` cap, exponential (`BACKOFF_BASE_MS` · `BACKOFF_MAX_MS`) | `mirrorPump.js:52–53` |
| Retry budget before poison | `5` — `VELA_MIRROR_MAX_RETRIES` | `mirrorPump.js:54` |
| Applied-row retention | `24h` (`APPLIED_RETENTION_MS`) | `mirrorPump.js:55` |
| Outbox window | `7 days`, **all rows regardless of status** | `mirrorPump.js:56` |

- **Single writer** — a `running` lock on `global.__velaMirror`, and
  `startMirrorPump()` fires one immediate drain at boot so a restart after an
  outage clears the backlog before the first interval tick.
- **One attempt per row per pass** — a still-retryable row waits for the next
  pass; burning the budget inside one drain would defeat outage recovery.
- **Poison never head-of-line-blocks.** Every row resolves to applied / skipped
  / poison this pass. A deterministic replay failure (lost identity, registry
  drift, structural UNIQUE) poisons at once; an infrastructure failure burns the
  retry budget first, then poisons. Either way the op is marked, the cargo burned,
  a `mirrorPoison` ledger row written, and the queue moves on.
- **Cargo redaction** — once the twin has answered (applied *or* terminal
  poison) the args are replaced with the redacted sentinel, and every row ages out
  at 7 days regardless of status, so an outage window can never become an
  unbounded plaintext token journal. Redacted rows still reach apply: the twin's
  seq-dedupe can answer a redelivery without the args, and anything it cannot
  prove returns poison.
- **Fail-open** — any error sets the degraded flag and backs off; the primary
  keeps serving and the mode does not change. An op that ages out unapplied
  writes a `mirrorAgeOut` ledger row — a lost replication is named, not swallowed.

### C4 — the sweep and the full resync

`mirrorSweep.js` fingerprints both harbors per table and compares through the
pure `mirrorFingerprint.js` — a sorted **multiset** of per-row hashes, so it is
order-independent and primary-key-independent.

| Table | Columns dropped before hashing |
|-|-|
| `providerConnections` · `providerNodes` · `proxyPools` · `combos` | `updatedAt` |
| `apiKeys` | `id`, `key`, `machineId`, `lastUsedAt`, `rotatedFrom`, `rotationPrevKeyId` |
| `kv` | — (JSON values canonicalized with sorted keys) |

Out of scope by decision: `settings` (secret redaction makes comparison noise),
`usageHistory`/`usageDaily` (they ride the watermark), `requestDetails`
(regenerable), and the mirror's own bookkeeping (`backupLedger`, `outbox`,
`mirrorSeq`). `apiKeys` compares by `keyHash`, because the twin legitimately mints
`mirror:<keyHash>` rows. Fractional numbers round to 6dp (the twin's
`DECIMAL(12,6)` width); booleans normalize to `0`/`1`.

| Setting | Default | Env | Home |
|-|-|-|-|
| Sweep rhythm (first pass ~10s after boot, capped at 60s) | 6h | `VELA_MIRROR_SWEEP_INTERVAL_MINUTES` (default `360`) | `mirrorSweep.js:45,236,249` |
| Divergence threshold | `0` diverged tables | `VELA_MIRROR_DIVERGENCE_THRESHOLD` | `mirrorSweep.js:113` |
| Auto-resync on breach | `true` | `VELA_MIRROR_SWEEP_AUTORESYNC` | `mirrorSweep.js:114` |

Two guards: the **drain-window guard** refuses to fingerprint while outbox rows
are pending — mid-drain lag is intentional, not drift — and reports
`{swept: false, skipped: "drain-in-progress"}` instead of a false alarm. And the
resync's **trust model** is explicit: export generic-scope from the primary,
stitch the twin's own current secret settings back over any redaction sentinel
(so `"[REDACTED]"` is never installed as a live secret), then import with
`adoptKeys: true` so real `keyHash` values land — a mirror-faithful twin needs
them or key-gated traffic breaks on failover. The ledger records `mirrorResync`,
and the usage watermark advances to the copied max id so the incremental pass
picks up only what is new.

### C4 — the usage watermark resync

Usage is the exempt class: `saveRequestUsage` never rides arg-replay, because its
cost and key resolution read eventually-consistent shadows. It crosses through
`usageResync.js` alone, in bounded id-ordered batches beyond a watermark, applied
**verbatim** — no re-costing, no re-resolving. `usageDaily` and
`totalRequestsLifetime` ride the same pass. The watermark advances **only
forward, only after a successful apply**, so a redelivery is a no-op and a rerun
never double-appends.

| Knob | Default | Env | Home |
|-|-|-|-|
| Rows per batch | `500` | `VELA_MIRROR_USAGE_BATCH_SIZE` | `usageResync.js:75` |
| Row cap per pass | `5000` | `VELA_MIRROR_USAGE_RESYNC_MAX_ROWS` | `usageResync.js:76` |
| Rhythm (first pass ~5s after boot, capped at 30s) | 60s | `VELA_MIRROR_USAGE_RESYNC_INTERVAL_SECONDS` | `usageResync.js:128,141` |

### C5 — binding and the startup matrix

`bindFacade()` returns the SQLite harbor wrapped by `decorateMirrorRepo()` under
`mirror`, so reads and exempt writers pass through verbatim and the export
surface does not change shape. `mirrorStartup.js` arms the three rhythms from
`initializeApp`; under `sqlite` or `mysql` it **stops** them — a non-mirror
posture has no outbox to drain (`mirrorStartup.js:28–40`). Nothing in that path
probes the twin: starting the rhythms must never block boot on a remote server.
Each rhythm exposes a status reader (`getMirrorPumpStatus()`,
`getMirrorSweepStatus()`, `getUsageResyncStatus()`); none is wired to an HTTP
route at v1.2.4 — the mirror's evidence lives in the console and the ledger.

---

## 🛟 The Backup Engine

Two things carry the name, and they never overlap:

| Kind | Where | Shape | Purpose |
|-|-|-|-|
| **Safety copies** | `src/lib/db/backup.js` | plain SQLite copy (`ATTACH`), unencrypted | taken only before a schema change or a restore; newest `KEEP_BACKUPS = 3` kept (`backup.js:14`) |
| **Sealed artifacts** | `src/lib/db/repos/backupEngine.js` | AES-256-GCM `.velabak` | scheduled, retained, portable, off-sitable |

The file roster: engine `repos/backupEngine.js` · facade `repos/backupRepo.js` ·
data twins `repos/sqlite/backupRepo.js` + `repos/mysql/backupRepo.js` · security
lists `repos/backupSecurity.js` · off-site `repos/s3Offsite.js` · rhythm
`src/shared/services/backupScheduler.js`.

### Env (all opt-in, default off — policy is env-only)

Every name below was verified against a live `process.env` read:

```bash
grep -rhoE "VELA_BACKUP_[A-Z0-9_]+|VELA_USAGE_RETENTION_DAYS" \
  src/lib/db/repos/backupEngine.js src/lib/db/repos/s3Offsite.js \
  src/shared/services/backupScheduler.js | sort -u
```

| Variable | Default | Meaning | Read at |
|-|-|-|-|
| `VELA_BACKUP_ENABLED` | `false` | master switch for the scheduler | `backupScheduler.js:45` |
| `VELA_BACKUP_INTERVAL_HOURS` | `24` | tick interval | `backupScheduler.js:101` |
| `VELA_BACKUP_RETAIN_DAILY` | `7` | daily retention tier | `backupScheduler.js:67` |
| `VELA_BACKUP_RETAIN_WEEKLY` | `4` | weekly retention tier | `backupScheduler.js:68` |
| `VELA_BACKUP_ENCRYPTION_KEY` | — | **required**, ≥16 chars; loss = unrecoverable | `backupEngine.js:36` |
| `VELA_BACKUP_INCLUDE_REQUEST_DETAILS` | `false` | include the observability log | `backupEngine.js:170` |
| `VELA_USAGE_RETENTION_DAYS` | `90` | purge window; non-positive = keep forever | `backupScheduler.js` |
| `VELA_BACKUP_S3_ENABLED` · `_ENDPOINT` · `_BUCKET` | `false` · — · `vela-backups` | off-site arm | `s3Offsite.js:33–35` |
| `VELA_BACKUP_S3_ACCESS_KEY` · `_SECRET_KEY` · `_REGION` | — · — · `us-east-1` | SigV4 credentials | `s3Offsite.js:36–38` |

### The seal

scrypt `N = 2^17, r = 8, p = 1`, 32-byte key, fresh 16-byte salt; AES-256-GCM
with a fresh 12-byte IV. Layout `MAGIC(8) | headerLen(4 BE) | headerJSON |
ciphertext | tag(16)`, magic `VELABAK1`. **The GCM tag is verified before any
restore step touches the payload.** The payload is gzip(level 9) of
`{ payload, secretBundle }`, with a manifest of `created`, `trigger`,
`schemaVersion`, `sourceMode`, `secretBundle[]` and `includeRequestDetails`.
Artifacts land in `$DATA_DIR/db/backups/artifacts/` as
`vela-backup-<YYYYMMDD-HHMMSS>-<6 hex>.velabak`, written `0600` where the
platform honors it (Windows ignores the mode).

### Payload and rhythm

`exportDb()` carries the config tables, `apiKeys`, `combos`, `usageHistory`,
`usageDaily`, the `kv` scopes and `settings`. `backupLedger`, `outbox` and
`mirrorSeq` are excluded **by name** (`EXPORT_EXCLUDED_TABLES`, a twin-identical
list), `requestDetails` joins only when asked, and `apiKeys.key` is **always
NULL** — identity travels as `keyHash`/`keyPrefix`. Restore bounds the payload at
`MAX_PAYLOAD_BYTES = 512 * 1024 * 1024` (512 MiB, S1).

`runBackupTick()` runs, in this order: **backup → retention prune → usage purge.**

- Retention keeps the newest per day for `retainDaily` days, plus the newest per
  ISO week for `retainWeekly` weeks. The week key is Thursday-anchored —
  `mtime + 3 days`, then the date — so a week is named by the day it would end
  (`planPruneArtifacts`, `backupEngine.js:493–516`).
- Purge deletes in `BATCH = 5000`-row batches from `usageHistory`, then
  `requestDetails`, everything older than `now - retentionDays`, and writes a
  `purge` ledger row.
- The scheduler is idempotent and fail-open — an error writes a `failed` ledger
  row and sets a degraded flag, never throwing into the request path. Timers are
  `unref()`ed. The boot tick fires after up to **10 minutes** of jitter
  (`JITTER_MS`, `backupScheduler.js:21,117`), then the next run is armed at
  `VELA_BACKUP_INTERVAL_HOURS` + fresh jitter.

> ⚠️ Purge runs **after** backup by law. Reverse the order and you delete exactly
> the rows the artifact was meant to preserve.

The off-site leg is armed only when `VELA_BACKUP_S3_ENABLED=true` **and** the
endpoint, bucket and both credentials are set. It uploads **only the sealed
bytes** — encryption already happened — plus a rolling `latest.velabak` alias
(`s3Offsite.js:182`), path-style, signed by a dependency-free SigV4 signer over
`undici`. It is fail-open: a failure lands as `s3Offsite`/`failed` and the local
artifact stays the truth. The secret bundle carries `jwt-secret`,
`api-key-secret` and `machine-id`; a restore writes them back at `0600` and
returns `restartRequired: true`, because the dashboard signing key is captured
at module load and only takes effect after a restart. Upstream credentials are
deliberately **not** in the bundle — they ride inside the encrypted payload.

---

## 🧯 Recovery

`POST /api/backup/restore` with `{ backupId, password, adoptSecrets, confirmSecrets }`:

1. Resolve the artifact (by id, else the newest) — `artifact not found` if none.
2. `openArtifact()` — magic, header, **tag verification**; a failure reads
   `Artifact verification failed — wrong key or corrupted backup`.
3. Decompress and parse; a malformed payload is refused.
4. **Schema compatibility** — an artifact newer than this build is refused:
   `[backup] artifact schema version N is newer than this build (23) — refusing
   to restore` (`backupEngine.js:330`; the number is `SCHEMA_VERSION` read at
   build time, so it moves with the chart).
5. **Pre-restore safety backup** — SQLite copies the harbor (`pre-restore`);
   MariaDB writes a gzipped JSON snapshot. Fail-open: the restore proceeds and the
   manifest records it.
6. `importDb(payload, { adoptSecrets })`.
7. Write the secret bundle back; report `restoredSecrets` and `restartRequired`.
8. Write a `restore` ledger row.

`adoptSecrets: true` requires `confirmSecrets: true` — two deliberate
acknowledgements, never one.

**The drill** (`POST /api/backup/drill`) decrypts the newest artifact, then
migrates a scratch SQLite database in a temp directory via `getScratchAdapter`
(full chain, `skipBackup: true`) and **actually imports the payload into it** —
a dry-run against the S1 shape gate first, then the real import, then a row
census across every `TABLES` table. An artifact whose rows would fail import is a
**failed** drill, not a passing one; zero restored rows is a failure by name
(`runRestoreDrill`, `backupEngine.js:387–486`). The live harbor is never touched;
with no artifact it answers `{ ok: false, skipped: "no-artifact" }` and writes a
`failed` drill row. A backup never restored is a hope — rehearse before you need
it. The drill re-confirms the dashboard password (S4).

**Plain-file recovery (`sqlite` only):** stop the process, copy
`$DATA_DIR/db/data.sqlite` (with its `-wal`/`-shm`, or checkpoint first), or take
a directory from `db/backups/`. No encryption, no ledger row — the lifeboat, not
the ritual.

> 🔑 **The key rule.** Lose `VELA_BACKUP_ENCRYPTION_KEY` and every artifact is
> **permanently unrecoverable**: the ciphertext is fine, the key is gone, and no
> support path exists. Keep a copy offline with the same care as the database.

---

## 🔐 Trust Boundaries at Rest

The lists live in `src/lib/db/repos/backupSecurity.js`, so the artifact path, the
plaintext export and the mirror resync all redact through **one** source.

- **S1 — restore is a trust crossing.** `importDb()` treats the payload as
  hostile: `MAX_PAYLOAD_BYTES` (512 MiB), shape validation, quarantine list. The
  quarantined fields (settings `password`, `requireLogin`, `authMode`, `oidc*`,
  and the key identity `keyHash`/`isInternal`/`deletedAt`) land only under
  `adoptSecrets`; by default current values are captured *before* the wipe and
  stitched back. Without that, a decryptable artifact plus the plain restore
  endpoint is a total-takeover chain.
- **S2 — redaction below the completeness law.** Secrets: settings `password`,
  `mitmSudoEncrypted`, `oidcClientSecret`; connection/pool data `apiKey`,
  `accessToken`, `refreshToken`, `idToken`, `token`, `password`, `relayToken`;
  nested `clientSecret`, `idToken`, `copilotToken`, `firebaseIdToken`,
  `machineId`, `fingerprintId`, `fingerprintHash`. Redaction is **opt-in** on
  `exportDb({ redact: true })` and used only by the plaintext HTTP surface —
  artifacts and resync stay full-fidelity, since a resync that stripped OAuth
  tokens would strip the twin's ability to refresh. The plaintext export also
  drops the sealed-DEK columns (`secretWrappedDEK` and its siblings). No rows or
  tables are dropped by it.
- **S3 — the outbox journal is bounded** (cargo redacted once the twin answers,
  7-day age-out regardless of status).
- **S4 — the ledger is metadata only.** `listBackupLedger()` omits the `error`
  column (kept in the table, truncated at 500 characters) because those strings
  carry paths and SQL detail. Mutating actions re-confirm the dashboard password
  inside lockout accounting, a second concurrent run answers `409`, and the backup
  routes are `ALWAYS_PROTECTED` at `dashboardGuard`.
- **S6 — secrets move only with the bundle**, and a restore that wrote one
  demands a restart.

---

## 📊 Operating the Harbors

Every backup route below was measured at v1.2.4 (`ls src/app/api/backup/`):

| Surface | Method | What it answers |
|-|-|-|
| `/api/health` | `GET` | `{"ok":true}` — the Docker healthcheck's target |
| `/api/backup/status` | `GET` | enabled, running, degraded, last result, next run, policy in force |
| `/api/backup/list` | `GET` | ledger page — `?limit` (default 50, max 200), `?offset` |
| `/api/backup/inventory` | `GET` | the artifacts on disk and their ledger state |
| `/api/backup/run` | `POST` | immediate backup; password re-confirm; `409` if one is running |
| `/api/backup/restore` | `POST` | restore one artifact |
| `/api/backup/drill` | `POST` | decrypt the newest artifact into scratch, import it, and census it |
| `/api/backup/prune` | `POST` | apply the retention plan on demand |
| `/api/backup/purge` | `POST` | apply the usage-retention purge on demand |
| `/api/settings/database` | `GET`/`POST` | plaintext export (redacted) / import (hostile payload; `413` over bound) |

The plaintext export and import accept either the dashboard password or the CLI
machine token (`x-vela-cli-token`) — the token is already local-bound, so it skips
the re-confirm. Ledger kinds to filter on: `backup`, `restore`, `drill`, `purge`,
`prune`, `failed`, `s3Offsite`, `mirrorPoison`, `mirrorAgeOut`, `mirrorDivergence`,
`mirrorResync`.

```text
[DB] Driver: node:sqlite | file: /app/data/db/data.sqlite
[DB][migrate] applied #23 plans
[mirror] POISON — outbox seq=… exceeded its retry budget; twin reconciliation owed
[mirror] DIVERGENCE — providerConnections — full resync engaged
[backup] scheduler started
```

In Docker: the volume **is** the harbor under `sqlite`; keep
`VELA_BACKUP_ENCRYPTION_KEY` outside the container;
`docker-compose.example.yml` ships an optional `vela-twin` (`mariadb:11`,
internal-only, `./data-twin:/var/lib/mysql`) for the `mysql` and `mirror`
postures. Switching posture is a chart edit plus `docker compose up -d` — mode is
resolved once per process, so a restart is what changes the harbor. The gateway
answers on **32060** throughout.

> 📌 Moving **to** `mirror` with a fresh, empty twin is safe by design: every
> fingerprinted table diverges, and auto-resync seeds the twin within a sweep of
> boot. Moving with a twin that already holds unrelated data is not a supported
> migration — provision an empty database.

---

## 🔗 See Also

- [docs/ARCHITECTURE.md](./ARCHITECTURE.md) — where the database layer sits in the request path
- [docs/ENVIRONMENT.md](./ENVIRONMENT.md) — the full env contract, mirror and backup sections included
- [docs/DEPLOYMENT.md](./DEPLOYMENT.md) — install paths beyond Docker
- [docs/TROUBLESHOOTING.md](./TROUBLESHOOTING.md) — when a harbor refuses to bind
- [DOCKER.md](../DOCKER.md) — volumes, the compose chart, and the image
- [.env.example](../.env.example) — the annotated variable list this chart draws from
- [CHANGELOG.md](../CHANGELOG.md) — which tide sealed which wave

— *Vela · The Sail of the Ship* ⛵
