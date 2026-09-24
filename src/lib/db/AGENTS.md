# src/lib/db

The storage layer: one SQLite primary (optionally mirrored to MariaDB), 18 declared tables, a versioned migration chain, facades bound by posture, and an encrypted backup engine. Everything that persists lives behind this directory. New code imports `@/lib/db/index.js` — never `driver.js`.

## The rooms

| Path | What it is |
|---|---|
| `driver.js` | The driver chain, the `global._dbAdapter` singleton, `getAdapter` / `getAdapterSync` / `getScratchAdapter` |
| `paths.js` | `DATA_DIR/db/data.sqlite`, `DATA_DIR/db/backups`, the legacy-JSON paths |
| `schema.js` | `SCHEMA_VERSION`, `PRAGMA_SQL`, `TABLES` — the declarative schema both harbors derive from |
| `migrate.js` | `runMigrationOnce` — versioned chain → additive sync → one-time legacy JSON import |
| `migrations/` | `001`–`016`, each `{ version, name, up, down }`; registry in `migrations/index.js` |
| `adapters/` | `bunSqliteAdapter.js`, `betterSqliteAdapter.js`, `nodeSqliteAdapter.js`, `sqljsAdapter.js` |
| `index.js` | Pure re-export barrel. No SQL, no adapter access. |
| `repos/bind.js` | The posture seam: `getDbMode`, `bindFacade`, `assertMysqlReachable`, `assertHarborBound` |
| `repos/<name>Repo.js` | Path-stable facades (sqlite verbatim / mysql twin / mirror decorator) |
| `repos/sqlite/`, `repos/mysql/` | The two harbors — every persistence statement lives here |
| `repos/sqlite/storeAdapter.js` | The one sanctioned doorway to the adapter for outside callers |
| `repos/bindFallbackRules.js` | Binds the adapter into the combo engine's repo shape — see the async law |
| `repos/backupRepo.js`, `backupEngine.js`, `backupSecurity.js`, `s3Offsite.js` | Backup data-dispatcher, engine, S1/S2 law, off-site leg |
| `mysql/` | `pool.js` (async adapter), `bootstrap.js` (additive diff), `ddlMap.js` (TABLES → MySQL DDL), `kv.js`, `adapter.js` |
| `mirror/` | `replayRegistry.js`, `mirrorDecorator.js`, `mirrorPump.js`, `mirrorSweep.js`, `usageResync.js`, `mirrorFingerprint.js` |
| `helpers/` | `jsonCol.js` (`stringifyJson`/`parseJson`), `kvStore.js` (`makeKv`), `metaStore.js` (`_meta`) |
| `keyLimits.js`, `usageAggregation.js`, `usageNames.js`, `usageEnrich.js`, `version.js`, `backup.js` | Shared logic + the safety-net ATTACH backup |
| `src/lib/localDb.js` | Backward-compat shim — do not add to it |
| `src/shared/services/mirrorStartup.js`, `backupScheduler.js` | The rhythm lifecycles (pump/sweep/resync; nightly backup) |

## The adapter contract

Every adapter exposes exactly:

```
run(sql, params)   → { changes, lastInsertRowid }     (mysql: affectedRows / insertId)
get(sql, params)   → row | undefined
all(sql, params)   → row[]
exec(sql)          → void        (DDL / multi-statement)
transaction(fn)    → fn's return value
driver, close(), raw                              (sqlite also: checkpoint())
```

**NEVER call `db.prepare()` on an adapter.** It is not part of the contract. The sql.js adapter and the mysql adapter expose no public `prepare`, so a migration or repo that uses it crashes every DB-backed API at boot with `a.prepare is not a function` — the v0.9.19 boot storm, which resurfaced in a live mirror deployment at v0.9.21. The portable idiom, exactly as migration 002 documented it and 014/015 still use it:

```js
const cols = new Set(db.all(`PRAGMA table_info(fallbackRules)`).map((c) => c.name));
db.exec(`ALTER TABLE fallbackRules ADD COLUMN ${name} ${type}`);
```

Transaction shapes differ per driver and all are hidden by the contract: better-sqlite3 and bun:sqlite use their native `db.transaction(fn)()`; node:sqlite and sql.js open a `SAVEPOINT` (so nesting works); the mysql adapter returns a **connection-scoped** adapter to `fn` and lets a nested `db.transaction()` ride the outer transaction via `AsyncLocalStorage`. On sqlite, `fn` runs synchronously — a transaction body must not `await`. Under mysql every adapter method is async, so a **sync caller cannot ride the twin** (this is why the `authStoreRepo` facade deliberately skips `bindFacade`).

## The driver chain

Resolution order in `resolveDriver()` — first success wins:

| Driver | Available when | Notes |
|---|---|---|
| `bun:sqlite` | `process.versions.bun` set | built-in, fastest under Bun |
| `better-sqlite3` | Node only (skipped under Bun) | `optionalDependencies` — native build may be absent |
| `node:sqlite` | Node ≥ 22.5, not Bun | `driver.js` gates on `maj < 22 \|\| (maj === 22 && min < 5)` |
| `sql.js` | always | pure-JS/WASM, whole-file persistence |

- **`VELA_DB_DRIVER` pins one driver** (`bun:sqlite` · `better-sqlite3` · `node:sqlite` · `sql.js`). An unknown name throws listing the valid set; a pinned-but-unavailable driver throws `is not available in this runtime`. This loudness is the point — the driver×mode matrix must force the fragile corners (e.g. the sql.js SAVEPOINT path) instead of silently falling through.
- `getAdapter()` initializes once per process. State lives on `global._dbAdapter` (`{instance, initPromise, logged}`) to survive Next dev hot-reload; init runs `ensureDirs()` → `resolveDriver(DATA_FILE)` → `runMigrationOnce`. `getAdapterSync()` throws on a cold process.
- `getScratchAdapter(filePath)` resolves a driver against an explicit path and runs the migration chain on it — used by the restore drill. **The caller owns `close()` and cleanup.**
- Every adapter applies `PRAGMA_SQL` at open (`journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`, `busy_timeout=5000`). The three native sqlite adapters checkpoint WAL (`TRUNCATE`) every 60s on an unref'd timer and on shutdown; sql.js persists on the same signals. All four flush and close on `beforeExit`/SIGINT/SIGTERM.

## Facades & binding

`repos/<name>Repo.js` is the only surface a consumer should import. Each facade is three lines of shape plus a named re-export list:

```js
import * as sqlite from "./sqlite/settingsRepo.js";
import { bindFacade } from "./bind.js";
const bound = bindFacade(sqlite, () => import("../repos/mysql/settingsRepo.js"));
export const getSettings = bound.getSettings;
```

`bindFacade` reads `VELA_DB_MODE` (`sqlite` default · `mysql` · `mirror`; anything else throws) once per call:

- **sqlite** — the harbor module verbatim (sync functions stay sync).
- **mirror** — the sqlite harbor behind `decorateMirrorRepo()` (the primary serves; the outbox carries writes).
- **mysql** — every name in the bound wave sets (`CONFIG_WAVE_NAMES`, `SECURITY_WAVE_NAMES`, `USAGE_WAVE_NAMES`, `OBSERVATORY_W3_NAMES`, `OBSERVATORY_W4_NAMES`) delegates to `repos/mysql/<name>Repo.js`; **any name outside them throws at call time** ("lands in a later Storage Covenant wave") — never a silent downgrade. `repos/mysql/fallbackRulesRepo.js` is still a placeholder that throws; that is the intended shape, not a bug.

Rules that follow:

- A **new exported function must join three places**: the harbor module, the facade's named re-export list, and (if it writes) `mirror/replayRegistry.js`. A facade export that stops at the facade is a build-time break waiting to surface.
- Return shapes may legitimately differ across postures: e.g. `getExportCursor` returns an iterator under sqlite and a Promise of one under mysql — callers `await` first, then `for await`.
- `src/lib/localDb.js` is a shim for old imports. Extend `@/lib/db/index.js`, which is a pure barrel.
- Outside callers that genuinely need the adapter (the Storage Covenant's own `(db, ...)` contract) import `repos/sqlite/storeAdapter.js`'s `openStoreAdapter`/`openStoreAdapterSync` — the names deliberately avoid `getAdapter` because `tests/unit/db-contract-census.test.js` greps for that string. That suite, plus `tests/contract/contract-census.test.js`, is the ratchet: raw-SQL files are permitted only in `repos/sqlite/`, `repos/mysql/`, `mysql/`, `migrations/`, and the named `EXEMPT` list. Keep it green by moving code behind the seam, never by extending the list.

**The async law (v0.9.16 → v0.9.46).** `repos/bindFallbackRules.js`'s `getFallbackRulesRepo()` binds the adapter into the closure the combo engine consumes. It is `async` because the store opener is; calling it without `await` yields a *Promise*, which is truthy, so a `if (!db) return null` guard cannot catch it and operator fallback rules silently never apply — for thirty minors. Every call site must `await` it; only a successful bind is memoized; `db.all` is shape-asserted because both bound closures reach exactly that method.

## Migrations

`SCHEMA_VERSION` lives in `schema.js` (currently **16**). Bump it by +1 for any change to `TABLES`. Forgetting to bump skips the pre-change safety backup; it does not break the additive sync.

A migration file exports `{ version, name, up(db), down(db) }` (default export is fine — `migrations/index.js` normalizes with `.default || m`). `runMigrationOnce(adapter)`, guarded by a `WeakSet`, runs in this order:

1. Record `fresh = isFreshDb(adapter)` **before** anything stamps `_meta`.
2. `pruneOldBackups()`; create `_meta`.
3. If not fresh and `_meta.backupSchemaVersion < SCHEMA_VERSION`: take a lightweight pre-schema backup (`backupDbLite`), then prune.
4. **Versioned chain** — every migration with `version > current`, each `up()` + `setMetaSync("schemaVersion")` inside one `adapter.transaction`.
5. **Additive sync** (`syncSchemaFromTables`) — `CREATE TABLE IF NOT EXISTS` for each `TABLES` entry, `PRAGMA table_info` diff to `ALTER TABLE … ADD COLUMN` (with `PRIMARY KEY`/`UNIQUE` stripped, since SQLite forbids them in ADD COLUMN), then each declared index.
6. Stamp `backupSchemaVersion`, then run the **one-time legacy JSON import** if the DB was fresh, the legacy files exist, and `DATA_DIR/db/.migrated-from-json` is absent: back the JSON up, import everything plus `tombstoneLegacyKeys`/`scrubPlaintextUsage` in one transaction, write the marker. A row-count mismatch throws `MigrationAborted` → the transaction rolls back, the legacy JSON stays, no marker is written, and the next boot retries.

> ⚠️ **`TABLES` is not the whole schema.** It holds 18 tables. Three are not in it: `outbox` (006) and `mirrorSeq` (007) are deliberately sqlite-only — the mirror's own op-log must never be bootstrapped onto the twin — but **`fallbackRules` (012, v2 columns from 014) is drift**: the additive sync cannot supply its columns and `mysql/bootstrap.js` cannot create it, so its columns exist only if the versioned chain ran. If you add a table, add it to `TABLES` unless it is genuinely sqlite-only bookkeeping.

The MariaDB harbor **never runs versioned migrations**: `mysql/bootstrap.js` brings a foreign schema to `TABLES` parity by additive diff over `information_schema` (create table, add column, add index — never drop), plus two one-time DML closures tracked in `_meta` (`mysqlSecurityClosures`, `mysqlM008Backfill`). `ddlMap.js` translates the dialect: indexed/primary TEXT → `VARCHAR(191)`, `AUTOINCREMENT` → `BIGINT AUTO_INCREMENT`, `REAL` → `DECIMAL(12,6)`, partial indexes → plain keys, every identifier backticked (`key` is reserved).

| # | Name | Sealed |
|---|---|---|
| 001 | initial | Base tables |
| 002 | apikey-governance | keyHash/keyPrefix + tombstone/scrub (exports `tombstoneLegacyKeys`, `scrubPlaintextUsage`) |
| 003 | key-categories | Key categories |
| 004 | usage-history dedupe UNIQUE | Usage dedupe |
| 005 | backup-ledger | `backupLedger` |
| 006 | mirror-outbox | `outbox` (sqlite-only) |
| 007 | mirror-seq | `mirrorSeq` (sqlite-only) |
| 008 | usage telemetry + composite indexes | `statusClass` + indexes |
| 009 | saved views | `usageViews` |
| 010 | usage request tags | `usageRequestTags` |
| 011 | proxy-fitness | `proxyFitness` |
| 012 | fallback-rules | `fallbackRules` (not in `TABLES`) |
| 013 | key-acl | `allowedKinds`/`allowedProviders`/`allowedCombos` |
| 014 | fallback-rules-v2-triggers | Typed triggers + `targetModels` |
| 015 | combo-usage-attribution | Combo attribution (filename says `015-combo-usage.js`) |
| 016 | auth-sessions-audit | `authSessions`/`authFailures`/`authAuditLog` |

## The mirror

`VELA_DB_MODE=mirror` binds the sqlite harbor behind `decorateMirrorRepo()`: **the primary serves every read and write**; classified writers leave one outbox row for the pump; the twin follows. The mode never silently downgrades — `assertHarborBound()` resolves for mirror even with no reachable twin.

- **Classification** (`replayRegistry.js`) — every barrel writer is `idempotent-upsert`, `identity-carrying`, `rmw-stale-hazard`, or `exempt`. Exempt writers (`saveRequestUsage`, `saveRequestDetail`, `appendRequestLog`, `upsertFitnessBatch`, `resetFitness`) never arg-replay; usage crosses by watermark instead. A new writer that is not classified is never captured.
- **Identity capture** — `createCombo`/`createProviderConnection`/`createProviderNode`/`createProxyPool` capture the generated id + timestamps so replay inserts the *same* row (re-minting would poison `combos.name UNIQUE`). `createApiKey` captures `keyHash` + `keyPrefix` only — never the keyId or plaintext. `ensureInternalKey` captures nothing (deterministic iff `API_KEY_SECRET` matches across stores). `touchKeyLastUsed` is classified but deliberately not captured.
- **Atomic containment** — `withOutboxCapture()` opens a SAVEPOINT, runs the writer, writes the outbox row inside it, then RELEASEs; a writer failure rolls both back.
- **The pump** (`mirrorPump.js`, started by `src/shared/services/mirrorStartup.js`) — seq-ordered single writer, batch 100, healthy tick 15s, exponential backoff 5s → 5min. A **deterministic** replay failure poisons immediately; an **infra** failure burns `VELA_MIRROR_MAX_RETRIES` (default 5) then poisons. A poisoned row is skipped, never head-of-line-blocking, and writes a `mirrorPoison` ledger row for manual replay. Applied rows prune after 24h; **every** row ages out after 7 days regardless of status (an outage window must not become a plaintext token journal) — an aged-out unapplied row raises `mirrorAgeOut`.
- **S3 redaction** — `args` are replaced with `[REDACTED]` as soon as the twin answers, or on terminal poison.
- **The divergence sweep** (`mirrorSweep.js`) — fingerprints `providerConnections`, `providerNodes`, `proxyPools`, `combos`, `apiKeys`, `kv` on both sides and compares. It **refuses to fingerprint while outbox rows are pending** (a drain window is intentional lag, not drift). Mismatch above `VELA_MIRROR_DIVERGENCE_THRESHOLD` (default 0) writes `mirrorDivergence` and, unless `VELA_MIRROR_SWEEP_AUTORESYNC=false`, runs a full resync. Rhythm: `VELA_MIRROR_SWEEP_INTERVAL_MINUTES` (default 360), one pass ~10s after boot.
- **Fingerprint normalisation** (`mirrorFingerprint.js`) is engine-agnostic: `updatedAt` dropped everywhere, JSON columns re-canonicalised with sorted keys, fractional numbers rounded to 6dp (`DECIMAL(12,6)`), booleans to 0/1, and the row hash multiset is sorted so order never reads as drift. `apiKeys` is compared on `keyHash` + governance fields — the twin's rows carry `mirror:<hash>` ids by design.
- **Full resync** — generic-scope `exportDb({includeRequestDetails:false})` → stitch the twin's own live secret values over any `[REDACTED]` sentinel → `importDb(payload, {adoptKeys:true})` on the twin → advance the usage watermark to the copied max id → `mirrorResync` ledger row.
- **Usage resync** (`usageResync.js`) — the exempt class's only path: id-ordered batches beyond the watermark (`VELA_MIRROR_USAGE_BATCH_SIZE` 500, `VELA_MIRROR_USAGE_RESYNC_MAX_ROWS` 5000, every `VELA_MIRROR_USAGE_RESYNC_INTERVAL_SECONDS` 60), applied **verbatim** (no re-costing), watermark advanced only forward and only after a successful apply; `usageDaily` + `totalRequestsLifetime` ride the same pass.
- A down twin degrades, never downgrades: the pump backs off, the outbox accumulates, boot fires an immediate catch-up drain, and the twin is never probed at startup.

## Backup

Two halves behind `repos/backupRepo.js`: the **data** twin (`exportDb`/`importDb`/`initDb`/`writeLedger`/`listBackupLedger`/`purgeOldUsage`, dispatched by posture — mirror rides the sqlite primary) and the **engine** (`backupEngine.js`: crypto, artifacts, secret bundle, drill, retention; re-exported so old imports keep working).

- **Crypto** — scrypt `N=2^17, r=8, p=1` (32-byte key), per-artifact 16-byte salt + 12-byte IV in the header, AES-256-GCM with the tag verified **before** any restore step. Layout: `MAGIC("VELABAK1") | headerLen(4 BE) | headerJSON | ciphertext | tag(16)`. Key material comes from `VELA_BACKUP_ENCRYPTION_KEY` only — env-only, minimum 16 chars, and the engine **refuses to run** without it (key loss means unrecoverable backups; that refusal is the design).
- **S1 — restore is a trust crossing.** `importDb()` bounds the payload (`MAX_PAYLOAD_BYTES = 512 MiB`), shape-checks every table field, and quarantines `RESTORE_QUARANTINED_SETTING_KEYS` / `RESTORE_QUARANTINED_KEY_FIELDS` unless `adoptSecrets` is passed: current values are captured and stitched back. `adoptKeys` is the mirror-resync variant (key identity verbatim, settings still quarantined).
- **S2 — redaction below the completeness law.** `repos/backupSecurity.js` owns the field lists; `exportDb({redact:true})` is used **only** by the plaintext HTTP surface (`src/app/api/settings/database/route.js`). Full-fidelity is the default because the encrypted artifact and the mirror resync need real credentials. `apiKeys.key` is exported NULL always; userinfo-bearing URLs redact whole.
- **S3 — exclusions.** `EXPORT_EXCLUDED_TABLES = ["backupLedger","outbox","mirrorSeq"]`; the ledger's `error` column is never surfaced by `listBackupLedger`.
- **Artifacts** live in `DATA_DIR/db/backups/artifacts/<id>.velabak` (mode 0600 where honored; Windows ignores mode). The secret-file bundle carries `jwt-secret`, `api-key-secret`, `machine-id` from `DATA_DIR`; restoring it returns `restartRequired: true` because `dashboardSession` captures the secret at module load.
- **Retention & drill.** `pruneBackupArtifacts({retainDaily: 7, retainWeekly: 4})` keeps the newest artifact per day and per ISO week. The safety-net backups in `backup.js` keep only `KEEP_BACKUPS = 3` and exclude `requestDetails`. `runRestoreDrill()` decrypts the newest artifact into a scratch sqlite DB (`getScratchAdapter`, `os.tmpdir`), asserts every `TABLES` table exists, reads `settings` + `apiKeys`, and writes a `drill` ledger row — always cleaning up. "A backup never restored is a hope."
- **Off-site (S3)** — opt-in (`VELA_BACKUP_S3_ENABLED=true` **and** endpoint + bucket + keys), fail-open (an upload failure never fails the local backup; it lands as `s3Offsite/failed`), uploading only the already-sealed bytes plus a rolling `latest.velabak`. Env: `VELA_BACKUP_S3_{ENDPOINT,BUCKET,ACCESS_KEY,SECRET_KEY,REGION}`.
- **Scheduler ordering** (`src/shared/services/backupScheduler.js`, opt-in via `VELA_BACKUP_ENABLED`, `VELA_BACKUP_INTERVAL_HOURS` 24 + 10min jitter): **backup → retention prune → usage purge**, in that order, so purged rows still live in the artifact. `purgeOldUsage({retentionDays: VELA_USAGE_RETENTION_DAYS ?? 90})` deletes `usageHistory` in 5,000-row batches, then `requestDetails`, then writes a `purge` ledger row; `days <= 0` is a no-op. Retention tiers: `VELA_BACKUP_RETAIN_DAILY`, `VELA_BACKUP_RETAIN_WEEKLY`.
- Ledger kinds written today: `backup`, `failed`, `restore`, `drill`, `purge`, `s3Offsite`, `mirrorPoison`, `mirrorAgeOut`, `mirrorDivergence`, `mirrorResync`. Every ledger write is fail-open — a bookkeeping failure never breaks the operation it describes.

## Environment

| Var | Effect |
|---|---|
| `DATA_DIR` | Root of everything (`<DATA_DIR>/db/data.sqlite`). Resolved once per process — see Traps. |
| `VELA_DB_MODE` | `sqlite` (default) · `mysql` (needs `VELA_MYSQL_URL`) · `mirror` |
| `VELA_DB_DRIVER` | Pins one driver; loud failure if unknown or unavailable |
| `VELA_MYSQL_URL` | `mysql://user:pass@host:3306/vela` — probed at boot under mysql posture |
| `VELA_BACKUP_ENCRYPTION_KEY` | Required for any backup; ≥16 chars |
| `VELA_BACKUP_ENABLED`, `VELA_BACKUP_INTERVAL_HOURS`, `VELA_BACKUP_RETAIN_DAILY`, `VELA_BACKUP_RETAIN_WEEKLY`, `VELA_USAGE_RETENTION_DAYS`, `VELA_BACKUP_INCLUDE_REQUEST_DETAILS` | Scheduler + purge windows |
| `VELA_BACKUP_S3_*` | Off-site leg (opt-in, fail-open) |
| `VELA_MIRROR_MAX_RETRIES`, `VELA_MIRROR_DIVERGENCE_THRESHOLD`, `VELA_MIRROR_SWEEP_AUTORESYNC`, `VELA_MIRROR_SWEEP_INTERVAL_MINUTES`, `VELA_MIRROR_USAGE_BATCH_SIZE`, `VELA_MIRROR_USAGE_RESYNC_MAX_ROWS`, `VELA_MIRROR_USAGE_RESYNC_INTERVAL_SECONDS` | Mirror rhythms |
| `API_KEY_SECRET` | Not read here, but the mirror's `ensureInternalKey` determinism depends on it matching across stores |

`_meta` is the migration state; never write these keys by hand: `schemaVersion`, `backupSchemaVersion`, `appVersion`, `migratedAt`, `totalRequestsLifetime`, `mysqlSecurityClosures`, `mysqlM008Backfill`.

## Traps

- **The DB-harness trap.** `paths.js` freezes `DATA_DIR`/`DATA_FILE`/`BACKUPS_DIR` at first import (`dataDir.js` computes `const DATA_DIR = getDataDir()` at module evaluation), and `driver.js` binds `const state = global._dbAdapter` at module evaluation. So `delete global._dbAdapter` **alone** never rebinds, and `vi.resetModules()` alone leaves a live global holding the old instance. The working order is: `global._dbAdapter?.instance?.close?.()` → delete `global._dbAdapter` (and `global._mysqlAdapter`) → `vi.resetModules()` → set env → import. Skipping the `close()` leaves an earlier test's SQLite handle open and `fs.rmSync` dies with **EPERM on Windows** — the evidence is orphaned temp dirs holding `data.sqlite-wal`. `tests/contract/driver-mode-matrix.test.js` is the reference pattern; every DB suite sets its own per-test `DATA_DIR`.
- **`DATA_DIR` is re-implemented, not shared.** `src/lib/dataDir.js`, `src/mitm/paths.js`, `src/lib/mitmAliasCache.js`, `src/lib/appUpdater.js`, `src/lib/updater/updater.js`, `cli/src/cli/utils/keyVault.js`, and `cli/hooks/sqliteRuntime.js` each resolve their own copy of the rule at module load. Two consequences: a mid-process `process.env.DATA_DIR` change moves only modules that have not yet loaded, and the fallbacks are **silent** — a Unix-style absolute path on Windows is refused in favour of the platform default, and an unwritable directory falls back to `~/.vela` with only a warning. Never assume a test's `DATA_DIR` was honored by every subsystem.
- **The CLI carries its own driver copies.** `cli/hooks/sqliteRuntime.js` installs `better-sqlite3@12.6.2` / `sql.js@1.14.1` into `DATA_DIR/runtime/node_modules` and validates the native binary's magic bytes; the app's `package.json` optionally depends on `better-sqlite3 ^12.6.2`. A version pin lives in two places — change both.
- **sql.js is memory-bound by construction.** The whole database file is loaded into WASM on open and `db.export()` serializes the entire database to a Buffer on a 100ms debounce after every write. Large databases cost heap on both sides of every save. Give each test its own temp `DATA_DIR`/adapter, or pin `VELA_DB_DRIVER` to a native driver for tests that write a lot.
- **A sync caller cannot ride the mysql twin.** The mysql adapter is async at every method; `authStoreRepo`'s facade therefore skips `bindFacade` and re-exports the sqlite harbor directly (the login limiter's contract is synchronous, and the honest consequence — auth rows are not mirrored — is recorded in that repo's header).
- **`outbox` and `mirrorSeq` are sqlite-only on purpose.** Do not add them to `TABLES`: `bootstrap.js` would then create them on the twin where they mean nothing. `fallbackRules` is the opposite problem — absent from `TABLES` by drift, so only the versioned chain gives it columns.
