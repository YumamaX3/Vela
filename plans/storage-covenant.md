# 🪞 The Storage & Backup Covenant — Sealed Plan

**ADR** · Status: SEALED — awaiting Forge handoff · Score: 3.80 composite (5 arbiters) + security-amended (Tidebreaker: SCORE TOO LOW → S1–S7 binding) · Sealed: 2026-08-15

> *"Three postures, one memory, and not a single record lost to any disk death."* 🪞💜

## Context

Vela's entire memory — provider OAuth tokens & API keys (`providerConnections.data`), governed
API keys (`apiKeys`, 25 columns incl. keyHash identity, rotation lineage, budgets, ipAllowlist),
usage history, combos, aliases, pricing sovereignty layers, settings — lives in ONE SQLite file:
`DATA_DIR/db/data.sqlite`, schema v3, 12 tables, WAL mode. The driver chain
(bun:sqlite → better-sqlite3 → node:sqlite ≥22.5 → sql.js) is synchronous after init; every repo
function is already `async` and awaits `getAdapter()` internally. Docker runs node:sqlite
(the runner stage copies neither better-sqlite3 bindings nor bun); local dev typically
better-sqlite3; sql.js is the universal pure-JS fallback.

**Backup today is safety-only** (`src/lib/db/backup.js`): a lightweight ATTACH-based copy taken
ONLY pre-schema-change and pre-legacy-JSON-import, KEEP=3 by mtime, `requestDetails` excluded,
**no restore path, no scheduler, no integrity check, no encryption, no off-site**. Recovery today
is a manual file copy. `exportDb()`/`importDb()` already form a backend-neutral JSON interchange
(governance-complete for apiKeys — "must survive backup/restore (plan §3.7)") that excludes
usage tables — the natural seam for cross-backend portability (Ghost/n8n precedent).

**The fleet reality** (100.100.40.48): MariaDB 12.3.2 already runs in `Database.yml`
(`database-mariadb`, LTR to 2029-06) — Vela joins it as a dedicated `vela` db + `vela` user
(Pelican precedent). A nightly 02:00 plaintext dump sidecar exists but is rated security debt
(no restore, no encryption, no integrity). No S3-compatible storage exists anywhere in the fleet —
a MinIO vault must be provisioned. Network trap: `Database.yml` declares no `networks:` block
(real network is `tethys-databases_default`; fleet upgrade Wave 1 fixes this) — Vela must wire by
the ACTUAL name or host port until then. Homelab hardware: Lenovo M910s, **no-ECC RAM** — the
recorded law: no mission-critical DB without good backups.

**The Star's decrees** (2026-08-15, mid-Mirror): full database + backup upgrade — three storage
postures (`sqlite` / `mysql` / `mirror` = both, SQLite primary + MariaDB synced), homelab-server
+ local deployment modes, scheduled encrypted backups with restore, off-site copies, usage
retention, and the Keeper's recommendations.

## Problem Frame (Phase 4 — REFORGED after Tidebreaker REFUTED verdict)

> Vela's memory — every provider credential, API key, usage record, and setting — lives in a
> single SQLite file with no scheduled backup, no restore path, no encryption, no off-site copy,
> and no mode beyond "one file on one disk" — while the Star demands the gateway run equally as a
> zero-config local tool, a homelab fleet citizen, and optionally BOTH at once, with zero records
> lost across any posture switch, crash, or disk death.
>
> **The two truths the first framing hid** (Tidebreaker, verified): (1) the adapter contract is
> SYNCHRONOUS end-to-end — every repo statement calls `db.get/run/all` without await and the
> repos lean on sync-transaction atomicity (`usageRepo.js:283`: "better-sqlite3 is sync → no JS
> yield mid-transaction → no race"). An async MySQL driver cannot satisfy this; the persistence
> layer's async migration IS the work, not a contained swap. (2) The named posture-switch vehicle
> `exportDb()` silently DROPS the `disabledModels` kv scope, `usageHistory`, `usageDaily`,
> `requestDetails`, and `_meta` — "zero records lost" is falsified by the mechanism itself.

**HMW (split, contradiction removed)**: How might we give Vela a persistence layer with three
selectable postures served by one engine-agnostic backup engine, plain-JS, where **primary-store
writes fail-closed in every posture** and **fail-open applies only to backup runs, S3 uploads,
and mirror-secondary writes** — so no deployment posture and no single disk death can erase what
the gateway has learned?

### The Three Waves (one covenant, sequenced gates)

| Wave | Scope | Ships alone |
|-|-|-|
| **A — The Dialect Bedrock** | Root-cause the `db-concurrent` known-fails FIRST; async adapter contract (run/get/all/exec/transaction) + repo await-migration + dialect emitter (upsert, autoincrement, introspection, session-init) + mysql2 pool adapter with ping/recovery; migration runner + auto-sync dialect fork (information_schema); dialect-neutral TABLES; the **export completeness law**; dual-backend test matrix | ✅ |
| **B — The Backup Engine** | Scheduler, retention tiers, AES-256-GCM, ledger, restore, drill, usage purge — built on the FROZEN export contract; off-site stubbed | ✅ |
| **C — Fleet & Mirror** | MinIO vault provisioning, fleet MariaDB join (network-resilient), outbox replication + divergence detection + posture switching, off-site live | only after A+B green |

### Success criteria (reforged, 13)

1. `VELA_DB_MODE=sqlite|mysql|mirror` selects the posture at boot; default `sqlite`; local dev byte-compatible with today.
2. **Async census gate**: zero synchronous adapter calls remain outside the adapter layer (grep/lint gate); `transaction(fn)` redesigned async-aware (SQLite SAVEPOINT nesting preserved, MySQL native).
3. All 11 repos behave identically across postures; test matrix exercises SQLite AND MariaDB; the `db-concurrent` known-fails are root-caused BEFORE concurrency behavior is pinned as a metric.
4. **Export completeness law**: `exportDb()` covers EVERY table in `TABLES` and EVERY kv scope (adds `disabledModels`, `usageHistory`, `usageDaily`, `_meta`; `requestDetails` opt-in); round-trip preserves row counts AND content hashes — falsifiable, pinned by test.
5. **Driver × mode matrix**: every (posture × resolved driver × MariaDB reachable/unreachable) combination has a defined, documented behavior; startup degradation specified (mysql-only with unreachable fleet DB = fail-loud refusal, never silent downgrade).
6. Scheduled backups, configurable interval + retention tiers; fail-open — never blocks a routed request; primary-store writes fail-closed in every posture.
7. Restore: any backup → any posture; integrity-verified BEFORE swap; pre-restore safety backup; retention policy re-applied post-restore (documented resurrection policy).
8. AES-256-GCM (node:crypto) on all artifacts, per-backup IV, key env-only (`BACKUP_ENCRYPTION_KEY`); archive ALSO carries the DATA_DIR secret files (jwt-secret, api-key-secret, machine-id); key lifecycle documented (loss = permanent; restore requires the same key; rotation = re-encrypt retained backups, deferred).
9. Off-site to S3-compatible endpoint (fleet MinIO), opt-in, fail-open, credentials env-only.
10. Usage retention purge (configurable days, default 90) applied to live store(s) — mirror posture purges too; backups retain historical snapshots.
11. Backup ledger (manifest table + dashboard) + **mirror divergence detection** (row-count + checksum sweep between stores, surfaced on the dashboard).
12. Automated restore drill into a scratch DB with smoke check.
13. Covenant pin tests + verify-no-regression green + dual-backend round-trip equality test.

**Process notes** (release ceremony, not system properties): Milestone Tide big change
v0.6.52 → v0.6.60, bump + themed changelog one commit, tag cut, golden-url-header regen;
fleet Wave-1 network coordination for the MariaDB join.

### The Mirror's consistency model (criterion 11's foundation)

SQLite primary is the ONLY writer. Every primary write also inserts into a **transactional
outbox** table in the SAME SQLite transaction (the queue persists across crashes by
construction). An async replication pump applies outbox entries to MariaDB and marks them
applied; on boot it catches up from unapplied entries; a periodic divergence sweep (row-count +
checksum per table) detects drift and triggers full-resync-from-primary. MariaDB accepts writes
ONLY via the pump. Mirror lag never blocks a primary write (fail-open secondary), and "no record
lost" is operationalized as: outbox completeness + divergence detection + full-resync path.
The usageHistory dedupe-SELECT race (REPEATABLE READ hazard) is redesigned to unique-constraint
+ upsert in Wave A.

### Recorded risks for Phase 7 (from the Tidebreaker's MISSING list)

- **Backup size reality — RESOLVED BY MEASUREMENT (2026-08-15)**: local dev DB = 256K total,
  21 usageHistory rows @ ~121 bytes JSON/row. Sizing math: a busy homelab at 1,000 req/day ×
  90d retention ≈ 90k rows ≈ 13–15 MB export JSON ≈ 1–2 MB gzipped. Single-transaction restore
  remains viable at this scale; batched import is a safety margin, not a requirement. requestDetails
  stays opt-in to keep the payload lean.

- **Env-secret restore semantics**: DB rows restore; env secrets ride the encrypted secret-file
  bundle in the archive; restoring onto a host with a different `API_KEY_SECRET` silently
  re-derives the internal MITM key (`ensureInternalKey`) — the archive bundle prevents this.
- **Backup size reality**: full JSON export per run carrying 90d usageHistory — Wave B must
  measure, compress (gzip), and bound growth; importDb's single-transaction restore needs a
  streaming/batch story for large payloads.
- **Cloud sync boundary**: `settings.cloudEnabled/cloudUrl` already exists — Phase 7 must state
  the relationship (cloud sync = settings-level; mirror = store-level; S3 = backup-level — three
  layers, one direction each, no overlap).
- **CLI coupling**: `cli/hooks/sqliteRuntime.js` assumes a local SQLite file — mysql-only breaks
  CLI tools; CLI stays sqlite-local by design, documented.
- **MinIO provisioning** is unbudgeted fleet work inside Wave C.

### Out of scope

Litestream/LiteFS continuous replication · restic/borg/rclone sidecars · MySQL PITR (binlog) ·
ORM adoption (knex/drizzle/kysely) · cloud S3 account provisioning (MinIO fleet service only) ·
the Proxy Covenant (parked, tasks #85–93).

## Phase 5 — The Three Forges (divergent approaches)

### A — "The Confluence" (async adapter contract + dialect emitter)
The adapter becomes the single abstraction, flipped to async (`await run/get/all/exec`,
`transaction(asyncFn)` with SAVEPOINT nesting + per-adapter mutex). `dialect.js` emits per-driver
SQL for the five sensitive families (upsert, insertOrReplace, autoPk, introspection, indexSql).
mysql2 pool adapter with connection-bound transaction shims. Complete export = universal vehicle.
**Verified blast radius**: 107 repo call sites + 19 transactions + 73 functions; ~180 sites
asyncified incl. migrate/index/helpers; ~39 test sites in lockstep. Strengths: one contract, one
test surface, minimal repo rewrite flavor. Weaknesses: Big-Bang flip commit, await overhead on the
hot usage-write path, dialect-emitter indirection, outbox-emission coupling smell.

### B — "The Loom" (knex query builder) — **REFUTED BY ITS OWN VERIFICATION**
knex 3.3.0 inspected: 13 dialects, **no sql.js, no node:sqlite, no bun:sqlite client**. The
universal pure-JS fallback floor dies; the 4-driver chain collapses to one native driver;
better-sqlite3 becomes effectively required (violating the optionalDependencies covenant). Also:
22 transitive deps incl. unmaintained `esm`; lazy-builder silent no-ops across 211+48 rewritten
sites; REPLACE→merge semantic drift at 22 sites; hot-path overhead vs cached prepared statements.
Criterion 5 (driver×mode matrix) becomes unsatisfiable. Rejected.

### C — "The Twin Harbors" (dual repo implementations behind the async repo contract)
The 73 exported repo functions ARE the contract (already async — zero caller churn). Two complete
implementations beneath: `repos/sqlite/*` (the existing 11 files moved UNCHANGED — sync statements
and no-yield atomicity preserved verbatim) and `repos/mysql/*` (mysql2 pool, native async, native
idiomatic SQL). Thin path-stable facades + `bind.js` dispatcher (`global._repoBinding`, hot-reload
survival). Parity enforced by a contract-test harness (~69 functions × engines; sql.js forced in
CI; MariaDB opt-in with loud skip-banner). MySQL bootstrap = information_schema additive diff +
security closures (migrations 001–003 not ported — TABLES v3 captures the end-state). Mirror =
**40-line dispatcher decorator** over the 27 write functions inserting into a logical op-log
outbox inside a nested SAVEPOINT — zero edits inside sqlite repos; pump replays through the mysql
impl the parity tests already prove. **Zero sqlite-side churn**; cost: ~2.5–3K lines mysql twin,
permanent ~1.8× repo-layer change tax, contract tests as the only drift guard.

## Phase 6 — Curation (scoring vs the 13 reforged criteria)

| Criterion | Confluence | Twin Harbors | Loom |
|-|-|-|-|
| 1 posture boot + byte-compat local | 5 | **5** (sqlite files moved unchanged) | 3 (chain collapse) |
| 2 async census gate | 4 (flip is enormous but clear) | **5** (containment grep; sqlite stays sync) | 2 (silent no-ops) |
| 3 repo parity + test matrix | 4 (emitter correctness) | **4** (contract harness; fixture-theater risk) | 2 |
| 4 export completeness law | 5 | 5 | 4 |
| 5 driver×mode matrix | **5** (chain intact) | **5** (chain intact) | **0 — FATAL** |
| 6 fail-open backup / fail-closed primary | 4 | 4 | 4 |
| 7 restore any-backup-any-posture | 4 (dialect coercion at import) | **5** (native per-engine import) | 3 |
| 8 AES-256-GCM artifacts | 4 | 4 | 4 |
| 9 S3 off-site | 4 | 4 | 4 |
| 10 usage purge | 4 | 4 | 4 |
| 11 ledger + divergence detection | 4 (checksum normalization hazard) | 4 | 4 |
| 12 restore drill | 4 | **5** (importDb IS the drill, cross-posture free) | 3 |
| 13 pin tests + round-trip | 3 (39 test sites in lockstep) | **5** (sqlite suite untouched; new parity pins) | 2 |
| **Composite** | **4.0** | **4.5** | **2.7 — REJECTED** |

**Decisive differentiators**: (a) Twin Harbors' sqlite posture is provably zero-delta — on a live
gateway where "never break routing" is the supreme law, Wave A carries NO regression risk to the
running path; the Confluence asyncifies the hot usage-write path of every request. (b) Mirror
atomicity falls out of a 40-line decorator exploiting verified SAVEPOINT nesting vs an
emitter-coupled outbox. (c) The Confluence's deepest cost is hidden: async sqlite transactions
need a mutex redesign; the Twin Harbors never touches them.

### Selection: THE TWIN HARBORS — strengthened with banked Confluence ideas

1. **Migration 004** (Confluence): usageHistory dedupe UNIQUE index + NOT NULL backfill — lands
   in BOTH harbors; the mysql twin treats `ER_DUP_ENTRY` as "existing row".
2. **Generic-scope export completeness** (Confluence): `SELECT DISTINCT scope FROM kv` — no
   hardcoded scope list, so no scope is ever silently dropped again.
3. **Divergence-checksum normalization** (Confluence): per-table type normalization before
   hashing (boolean 0/1 vs TINYINT, NULL vs '' backfills) to prevent false positives.
4. **mysql connection-bound transaction discipline** (Confluence insight): the mysql twin's
   read-modify-write functions must hold ONE pooled connection per transaction — encoded in the
   parity harness as a concurrent-write scenario.

**Criterion 2 restatement** (demanded by Twin Harbors, sanctioned by the Tidebreaker's revision 1):
"Every persistence statement outside `repos/sqlite/`, `migrate.js`, `backup.js`, and the `helpers/*`
sync utilities lives in an async repo function bound through `bind.js`; `getAdapter()`/raw SQL
appears nowhere else" — today `keyGate.js` violates this (2 raw-SQL sites + direct repo imports);
Wave A absorbs them.

### The Tidebreaker's verdict on the selection — STANDS WITH REVISIONS

*"The Twin Harbors are still the right harbor — but the frame sails on revised rigging, or it
does not sail."* Six flaws absorbed, all six revisions now binding law:

1. **Drop "unchanged."** The git-mv breaks every relative import (`../driver.js`,
   `../helpers/jsonCol.js`, `../keyLimits.js`) across all 11 files. The true delta: git-mv +
   mechanical import fixup, verified against `verify-no-regression.mjs`. The zero-delta claim
   survives only as *zero STATEMENT churn*, not zero file churn.
2. **Extend the frozen contract to keyGate** (`src/sse/services/keyGate.js:62-70, 236-251`):
   its raw `touchLastUsed()` and `sumKeyUsage()` bypass the repos — mirror mode would never see
   keyGate's lastUsedAt writes (divergence sweeps flap forever), and mysql failover would break
   budget enforcement. Both become repo functions in Wave A. Direct-importer census corrected:
   keyGate.js + 3 dynamic-import sites + the barrel — not nine.
3. **Re-spec the mirror decorator around the async hole.** better-sqlite3 `transaction()` is
   synchronous — an async fn COMMITS at its first `await`, so the decorator cannot claim atomic
   containment for await-bearing writers (createApiKey, ensureInternalKey, saveRequestUsage,
   replaceSyncedPricing). Law: sync-body writers get true atomic containment; await-bearing
   writers get fn-completes-then-outbox-INSERT with a documented fail-open crash window. One
   decorator, two documented behaviors.
4. **Replay-class taxonomy BEFORE Wave C** — the outbox arg-replay pump is the weakest mechanism:
   - `idempotent-upsert` (kv writers, deletes, reorders) — safe as-is
   - `identity-carrying` (createCombo, createApiKey, createConnection-access_token, createNode,
     createPool — all mint uuids/hashes in-body) — the op MUST capture the GENERATED identity
     from the sqlite execution: `{fnName, args, generatedIdentity}`; replay as snapshot upserts.
     createCombo replay otherwise hits `combos.name UNIQUE` and POISONS the single-writer loop.
   - `rmw-stale-hazard` (updateSettings, updateProviderConnection, updateApiKey) — cursor-monotonic
     application + seq-dedupe row written in the SAME mysql transaction (at-least-once delivery).
5. **Generic-scope export is a PRECONDITION for resync**, not an enhancement: the current
   hardcoded scope list makes `importDb(exportDb())` silently DELETE mysql's disabled-models
   state. Ships in Wave A with the completeness law.
6. **Sync/non-function passthrough codified in bind.js**: the census is 70 async + 3 SYNC
   functions (incl. `trackPendingRequest` — the hottest function; must stay sync-passthrough,
   never wrapped in a promise) + 3 non-function exports (statsEmitter, __test__,
   KeyLimitsValidationError). Contract tests pin their types/identities. Parity harness must
   name its exempt classes (~7 global-state/wall-clock functions) — no coverage theater.

**Banked-idea audit** (all four survive): migration 004 — the NOT NULL backfill (NULL→'' on
provider/model/connectionId/keyId) is the load-bearing half; NULLs are DISTINCT in both engines'
unique indexes. Divergence checksums — the normalization spec must enumerate volatile columns
(`apiKeys.lastUsedAt` written by THREE paths, `updatedAt` merge-writes, REAL-vs-DECIMAL cost,
JSON key-order) or the sweep is permanent noise.

## Implementation Blueprint

### Wave A — The Dialect Bedrock (commit sequence)

```
src/lib/db/
├── repos/
│   ├── <11 facades>.js          ← path-stable, bindRepo() re-exports
│   ├── bind.js                  ← VELA_DB_MODE dispatcher, global._repoBinding
│   ├── shared/                  ← pure helpers extracted (sanitizeCategory, statsEmitter…)
│   ├── sqlite/                  ← git mv of today's 11 repos + import fixups
│   └── mysql/                   ← NEW native implementations
├── mysql/{pool,bootstrap,ddlMap}.js
├── contract/ (tests/ side)      ← parity harness
```

| # | Commit | Contents | Exit gate |
|-|-|-|-|
| A1 | `refactor(db): facades + sqlite harbor` | git mv 11 repos → `repos/sqlite/` + mechanical relative-import fixups (11 files); 11 path-stable facades via `bind.js` (sqlite-only binding; `global._repoBinding` hot-reload survival); sync fns + non-function exports pass through UNWRAPPED (`trackPendingRequest` never gains a promise) | `verify-no-regression.mjs` green; boot smoke |
| A2 | `feat(db): keyGate joins the contract` | `touchKeyLastUsed()` + `getUsageDailySince()` (sumKeyUsage) become repo functions; keyGate.js rewired off raw `getAdapter()`; contract census pin (grep: zero raw SQL outside the sqlite harbor) | census gate green |
| A3 | `feat(db): export completeness law` | `exportDb()` → generic-scope (`SELECT DISTINCT scope`), adds `disabledModels`, `usageHistory`, `usageDaily`, `_meta`; `requestDetails` opt-in; `_meta` carries `{schemaVersion, exportedAt, sourceDriver, sourceMode}`; round-trip pin test pins CURRENT incomplete behavior first, then asserts completeness | round-trip equality |
| A4 | `test(db): parity harness skeleton` | fixtures seeding all 12 tables + kv scopes; golden normalization (strip ids/timestamps; shape assertions for AUTOINCREMENT; boolean coercion); sqlite-vs-sqlite runner shakeout; **exempt-class registry** (getUsageStats/getActiveRequests/getChartData/getRecentLogs/saveRequestUsage-cost/appendRequestLog — named, faked timers where possible) | harness green |
| A5 | `feat(db): migration 004 — dedupe UNIQUE` | `UNIQUE INDEX uq_uh_dedupe(timestamp, provider, model, connectionId, keyId, promptTokens, completionTokens)` + **NOT NULL ''-backfill on provider/model/connectionId/keyId** (the load-bearing half — NULLs are DISTINCT in both engines); `saveRequestUsage` SELECT-then-INSERT → atomic upsert | concurrency test green |
| A6 | `feat(db): mysql foundation` | mysql2 → optionalDependencies (pure JS); `mysql/pool.js` (min:0/max:8, keepalive, one-retry on ECONNRESET), `mysql/ddlMap.js` (TABLES → MySQL DDL: TEXT PK→VARCHAR(191), AUTOINCREMENT→BIGINT AUTO_INCREMENT, partial index→plain KEY, CHECK(id=1) preserved — MariaDB ≥10.2), `mysql/bootstrap.js` (information_schema additive diff + security closures tombstone/scrub, tracked in `_meta`); fail-LOUD boot refusal when unreachable | boot refusal test |
| A7 | `feat(db): mysql repos — config wave` | settings, connections, nodes, proxyPools, combos, alias (+mysql/kv.js); parity tests vs real MariaDB (opt-in `VELA_TEST_MYSQL_URL`, LOUD skip banner) | parity green |
| A8 | `feat(db): mysql repos — security wave` | apiKeys (hash-at-rest, rotation, soft-delete), disabledModels, pricing, requestDetails; `ER_DUP_ENTRY` = "existing row" in dedupe paths | parity green |
| A9 | `feat(db): mysql usageRepo` | dedupe via UNIQUE + ON DUPLICATE KEY UPDATE; day-aggregate upsert; GROUP BY parity; concurrent-write scenario (both engines converge to one row) | parity green |
| A10 | `feat(db): driver×mode matrix` | boot matrix test (4 sqlite drivers × sqlite mode, sql.js SAVEPOINT path forced in CI; mysql boot; mirror boots sqlite-primary); contract surface pin baseline (`tests/__baseline__/`) | Wave A complete |

### Wave B — The Backup Engine

**Artifact pipeline** (one shape, all postures): complete `exportDb()` JSON (+ secret-file bundle:
DATA_DIR's jwt-secret, api-key-secret, machine-id) → gzip → **AES-256-GCM** (node:crypto;
scrypt-derived key from `VELA_BACKUP_ENCRYPTION_KEY`; random 12-byte IV per artifact; auth tag
verified BEFORE any restore step) → timestamped artifact + manifest row. Sqlite postures
additionally keep the `VACUUM INTO` hot file copy as the pre-schema safety net (existing path).
MySQL posture: JSON export is the artifact (engine-portable by construction).

**Scheduler**: `global.__velaBackup` singleton (quotaAutoPing precedent), interval + jitter from
settings policy, fail-open (error → ledger `failed` row + degraded flag, never blocks routing).
Retention tiers: `retainDaily` (default 7) + `retainWeekly` (default 4), prune by mtime per tier.

**Restore flow**: select backup → decrypt+verify tag → gunzip → schema-version compatibility
check → **pre-restore safety backup of current state** → `importDb()` into the TARGET posture
(payload carries `sourceMode`; dialect coercion at import for the NULL→'' backfill columns) →
retention policy re-applied → ledger entry. Resurrection policy DOCUMENTED: restoring an old
backup revives rows purged since (that is the point of tiers).

**Restore drill**: scheduled (opt-in) — restore newest backup into a scratch temp DB, run smoke
checks (table census + settings read + one apiKeys read), record pass/fail in ledger. "A backup
never restored is a hope."

**Usage purge**: `VELA_USAGE_RETENTION_DAYS` (default 90, 0=forever) — purge usageHistory (+
requestDetails) older than N days, BOTH engines (per-engine implementation — the 1.8× tax paid
explicitly), purge runs AFTER the scheduled backup so purged rows live in the artifact.

**API surface** (dashboard-auth, validated, consistent envelope):

| Route | Purpose |
|-|-|
| `GET /api/backup/status` | policy, next run, degraded flag, last result |
| `POST /api/backup/run` | immediate backup (409 if one is running — idempotency) |
| `GET /api/backup/list` | ledger entries, paginated |
| `POST /api/backup/restore` | `{backupId, targetMode?}` — password-confirmed |
| `POST /api/backup/drill` | trigger restore drill |

**Dashboard**: Settings gains a Backup card — policy toggles, retention steppers, next-run
countdown, ledger table, Run-now / Restore / Drill buttons, degraded-state banner. Settings
policy fields ride the existing settings singleton (PROTECTED_SETTING_KEYS discipline preserved;
secrets stay env-only, never in settings JSON).

### Wave C — Fleet & Mirror

**Fleet infra**: MinIO vault container added to `Database.yml` (pinned release image — the repo
maintenance has shifted toward AIStor, so pin a known release; non-default root credentials;
`vela-backups` bucket + least-privilege service key). Vela chart env battery:
`VELA_DB_MODE`, `VELA_MYSQL_URL`, the `VELA_BACKUP_*` set — inline secrets per fleet constitution.
Fleet MariaDB join: dedicated `vela` database + `vela` user (install ritual, Pelican precedent),
own password, NEVER root/shorekeeper/tethys credentials. Network wiring: by the ACTUAL network
name (`tethys-databases_default` until fleet Wave 1 renames it — re-verify after W1 lands).

**S3 off-site**: undici-based SigV4 PUT to `VELA_BACKUP_S3_ENDPOINT` (MinIO path-style),
opt-in, fail-open, credentials env-only, upload ONLY after client-side encryption. Rolling
`latest` alias for the boot-strap restore pattern.

**Mirror machinery** (the revised rigging):

- **Outbox table** (sqlite, migration 005): `(seq INTEGER PK AUTOINCREMENT, replayClass TEXT,
  fnName TEXT, args TEXT, identity TEXT, status TEXT DEFAULT 'pending', createdAt TEXT,
  appliedAt TEXT)` — a LOGICAL OP-LOG with replay classes.
- **Replay-class taxonomy** (binding law, per Tidebreaker revision 4):
  | Class | Functions | Op shape |
  |-|-|-|
  | `idempotent-upsert` | kv writers, deletes, reorders, disables/enables | `{fnName, args}` — safe replay |
  | `identity-carrying` | createCombo, createApiKey, createConnection(access_token path), createNode, createPool | `{fnName, args, identity}` — the GENERATED uuid/hash/timestamp captured from the sqlite execution; replay inserts the SAME identity (createCombo otherwise mints a new uuid → `combos.name UNIQUE` violation → poison loop) |
  | `rmw-stale-hazard` | updateSettings, updateProviderConnection, updateApiKey | cursor-monotonic application; **seq-dedupe row written in the SAME mysql transaction** (at-least-once delivery deduped at apply) |
  | `exempt` | saveRequestUsage | NOT mirrored via arg-replay: usage rows flow through the divergence sweep + periodic usage-resync (cost/keyId resolve against eventually-consistent shadows — engine-divergent by nature) |
- **Decorator** (two documented behaviors): sync-body writers → true atomic containment (outbox
  INSERT in the same SAVEPOINT); await-bearing writers (createApiKey, ensureInternalKey,
  replaceSyncedPricing) → fn-completes-then-outbox-INSERT with a documented fail-open crash
  window. saveRequestUsage's arg-mutation makes capture undefined — it is exempt (above).
- **Pump**: seq-ordered single writer; applies through the mysql repo impls the parity tests
  prove; backoff retry; boot catch-up drains pending ops; applied rows pruned after 24h.
- **Divergence sweep**: per-table normalized fingerprints — COUNT + checksum of sorted pk hashes
  with a named exclusion list (`apiKeys.lastUsedAt` — written by THREE paths; `updatedAt`
  merge-writes; REAL-vs-DECIMAL cost epsilon; JSON key-order normalization; usageHistory handled
  by its own resync). Mismatch > threshold → ledger alert + full-resync via complete
  export→import (safe ONLY because the export is generic-scope — revision 5).
- **Startup degradation**: mirror with unreachable MariaDB → primary serves, outbox accumulates,
  alert counter rises; mode NEVER silently downgrades to sqlite.

### Driver × mode × reachability matrix (criterion 5)

| Posture | Driver resolved | MariaDB | Defined behavior |
|-|-|-|-|
| sqlite | better/bun/node/sql.js chain | n/a | exactly today |
| mysql | mysql2 pool | reachable | full service |
| mysql | mysql2 pool | unreachable | **fail-loud boot refusal** — never silent downgrade |
| mirror | sqlite chain + pump | reachable | full mirror |
| mirror | sqlite chain | transient loss | primary serves; outbox accumulates; alert |
| mirror | sqlite chain | down at boot | start degraded: primary up, pump retrying; mode stays mirror |
| mirror | **sql.js** fallback | any | supported with WARN log — the in-memory engine under mirror is the fragile corner; matrix test pins it |

### Env contract (`.env.example` additions)

```
# Storage posture (the Storage Covenant)
VELA_DB_MODE=sqlite                # sqlite | mysql | mirror
VELA_MYSQL_URL=                    # mysql://user:pass@host:3306/vela (mysql/mirror only)
# Backup engine — all opt-in, default OFF
VELA_BACKUP_ENABLED=false
VELA_BACKUP_INTERVAL_HOURS=24
VELA_BACKUP_RETAIN_DAILY=7
VELA_BACKUP_RETAIN_WEEKLY=4
VELA_BACKUP_ENCRYPTION_KEY=        # required when enabled; loss = unrecoverable backups
VELA_BACKUP_INCLUDE_REQUEST_DETAILS=false
VELA_BACKUP_S3_ENABLED=false
VELA_BACKUP_S3_ENDPOINT=           # e.g. http://100.100.40.48:9000 (fleet MinIO)
VELA_BACKUP_S3_BUCKET=vela-backups
VELA_BACKUP_S3_ACCESS_KEY=
VELA_BACKUP_S3_SECRET_KEY=
VELA_USAGE_RETENTION_DAYS=90       # 0 = keep forever
```

## Phase 9 — The Arbiters' Verdicts

| Dimension | Score | Verdict in one line |
|-|-|-|
| Architecture | 4 | Sound; saveRequestDetail is unmirrable via arg-replay, taxonomy lists incomplete, pump has no poison-op policy |
| Testability | 4 | Census exact, exempt-class honest; Wave B/C lack exit-gate tables, pump/sweep lack test scenarios, no barrel-census pin |
| Security | **3** | Correct primitives, but outbox secret sink, export collision, oidcClientSecret leak, importDb hardening, route auth — all unaddressed |
| Performance | 4 | Hot path verified untouched; restore event-loop block + non-transactional export + usage-resync mechanism unspecified |
| Feasibility | 4 | Convention-fit clean; Dockerfile mysql2 trace gap, A8/A9 heavy, decorator re-budgeted 150-300 lines |

**Composite: 3.80 / 5** — Security's 3 triggers the Tidebreaker's score-audit before repair.

## Phase 10 — Refinement (arbiter fixes absorbed)

### Architecture fixes
- **saveRequestDetail → exempt class** (alongside saveRequestUsage): its writes are buffered
  (writeBuffer → flushToDatabase mints ids at flush time) — uncaptureable at facade return,
  uncontainable in a facade transaction. requestDetails is excluded from the divergence
  fingerprint and the default resync payload (observability data, regenerable).
- **COMPLETE writer→replay-class table** (the taxonomy names all ~33 writers, binding law):
  additions — `updateCombo`, `updateProviderNode`, `updateProxyPool`, `cleanupProviderConnections`
  (rmw-stale-hazard); `ensureInternalKey` (identity-carrying, DETERMINISTIC — safe only when
  `API_KEY_SECRET` matches across stores; precondition stated); `resetAllPricing`,
  `clearSyncedPricing` (idempotent-upsert); `touchKeyLastUsed` (idempotent-upsert, with the 60s
  keyGate throttle consolidated INTO the repo function — outbox sizing depends on it).
- **Poison-op policy**: per-op max retries (default 5) → mark op `failed` in the outbox +
  ledger alert + SKIP (never head-of-line-block replication); failed ops surface on the
  dashboard for manual replay.
- **Barrel home stated**: `exportDb`/`importDb`/`initDb` move to `repos/sqlite/backupRepo.js` +
  `repos/mysql/backupRepo.js` twins behind the facade bind — restore-into-any-posture dispatches
  through the SAME contract (Wave B criterion 7).
- **Divergence sweep exclusions extended**: usageHistory + usageDaily + `_meta` usage counters
  ride the usage-resync (below) — excluded from the sweep until then, or the sweep is noise.

### Testability fixes
- **Auto-census pin** (A4 gate): the harness imports the barrel, enumerates every exported
  symbol, FAILS unless each appears in the parity-test registry OR the exempt registry — the
  only mechanical guard against coverage erosion under the 1.8× tax.
- **Wave B/C gain per-commit exit-gate tables** (drafted in the blueprint above for A; B gates
  must include negative tests: wrong-key restore → GCM tag refusal; truncated artifact → refusal;
  missing `VELA_BACKUP_ENCRYPTION_KEY` with enabled=true → loud boot refusal; retention pruning
  on synthetic mtime fixtures; purge on both engines with fixed-date fixtures).
- **Mirror test scenarios named** (C gates): drift-injection → sweep flags → resync restores;
  outage → N writes → outbox N pending → catch-up drains; double-delivery → seq-dedupe idempotent;
  poison-loop → createCombo replay with captured identity never hits UNIQUE.
- **CI parity path**: GH Actions MariaDB service container runs the mysql twin per PR; if
  declined, a scheduled weekly parity sweep + ledger recording compensates (stated in writing).
- **Gates machine-verifiable**: 'boot smoke' → scripted boot + health assertion; the exact
  vitest JSON command feeding verify-no-regression pinned per gate; A5 prunes the 3
  db-concurrent known-fails entries once migration 004 turns them green.

### Performance fixes
- **exportDb() reads wrapped in ONE read transaction** (today: sequential non-transactional
  `db.all()` — torn snapshots under concurrent writes).
- **Mirror usage-resync = incremental watermark append** (last-synced usageHistory.id, bounded
  batch, scheduled interval) — NOT periodic full export; usageDaily + usage `_meta` counters
  ride the same watermark.
- **Large restore batched**: chunked transactions (or an explicit maintenance flag) so a 90k-row
  import doesn't hold the write lock for seconds on the sync drivers; same batching for the
  first-run usage purge DELETE.

### Feasibility fixes
- **Dockerfile**: `COPY --from=builder` line for mysql2 (sql.js/node-forge precedent) + Docker
  smoke test booting `VELA_DB_MODE=mysql` against a throwaway MariaDB — without this, the fleet
  chart cannot run mysql/mirror at all.
- **A9 split** into (a) mysql usageRepo core + (b) usage parity/concurrency scenarios.
- **Decorator budget: 150-300 lines** (not 40), its own Wave C commit, exit gate covering both
  containment behaviors + identity capture + the createCombo replay proof.
- **SigV4 fixtures** as the S3 commit's exit gate: known-answer vectors + one live MinIO
  round-trip (hand-rolled signing fails as 403s that look like credential errors).

### Security fixes — the Tidebreaker's audit: **SCORE TOO LOW**, eight holes REAL (four understated)

*"The restore-payload-as-admin-privilege-escalation chain is a design-stage critical. It is not
workable until the import boundary is redesigned as a trust crossing."* The import boundary is
hereby redesigned as a trust crossing. All binding before Wave B ships:

**S1 — Restore is a trust crossing.** `importDb()` treats the payload as HOSTILE input:
schema-version + max-payload-size bounds enforced before any write. **RESTORE-QUARANTINED
fields** — `settings.password`, `settings.requireLogin`, `settings.authMode`, `settings.oidc*`,
`apiKeys.keyHash`, `apiKeys.isInternal`, `apiKeys.deletedAt` — restore only under an explicit
`adoptSecrets` flag with password re-confirm; the DEFAULT preserves current values. (A
decryptable artifact + the restore endpoint was a total-takeover chain: attacker-known password
hash + `requireLogin:false` + minted keyHashes + `outboundProxyUrl` pointing at attacker infra —
SSRF/exfil of every upstream token through the gateway itself.)

**S2 — Export redaction BELOW the completeness law.** A hardcoded, tested SECRET-FIELD redaction
list (`oidcClientSecret`, `password`, all future PROTECTED_SETTING_KEYS) applies to
`exportSettings()`/`exportDb()` — today `exportSettings()` returns `readRaw()` verbatim and only
the HTTP route strips secrets. Completeness and redaction are TWO pin tests that can contradict
each other loudly. The backup ledger table joins the export-exclusion registry (its error strings
carry paths/driver names/SQL errors — an information channel into every artifact).

**S3 — Outbox hardening** (three clauses): excluded from `exportDb()` BY NAME + pin test
(migration 005's table would flow into every artifact/resync by construction); identity-carrying
ops capture the **HASH, never the keyId** (with API_KEY_SECRET the internal key is re-derivable
from keyId — a leaked `{keyId}` forges a working key); pending-secret accumulation BOUNDED — args
redacted after the first apply attempt and aged out regardless of status (an outage window must
not become an unbounded plaintext token journal in data.sqlite).

**S4 — Backup route auth.** `/api/backup/*` joins dashboardGuard's `ALWAYS_PROTECTED` (the
deny-by-default `/api/*` branch passes with `requireLogin===false` — restore must never ride it);
password re-confirm on run/restore/drill via the existing `verifyDashboardPassword` precedent
wrapped in lockout accounting (that path is currently UNTHROTTLED — brute-force surface); the
CLI-token bypass of `/api/settings/database` is NOT inherited; ledger endpoints return metadata
only, never artifact bytes or keys.

**S5 — Crypto spec pinned now** (before Wave B code fossilizes coin flips): scrypt
N=2^17, r=8, p=1; per-artifact random 16-byte salt + IV stored in the artifact header; key
material never in ledger/logs/API responses; `BACKUP_ENCRYPTION_KEY` minimum-entropy validation
at enablement; rotation = re-encrypt retained artifacts (interim: new backups under the new key,
old artifacts retired tier-by-tier).

**S6 — Post-restore contract.** Restart is REQUIRED after a secret-bundle restore (not optional):
`SECRET` is captured at module load (dashboardSession.js:29) and `cachedSecret`/machineId cache
at module level — without restart the gateway mints keys against the OLD secret while files say
otherwise. Boot-time sanity check that loaded jwt-secret/api-key-secret match the bundle
checksum; restore INVALIDATES all live sessions (an operator restoring to lock out an intruder
must actually lock them out; a stolen cookie must not survive the restore window).

**S7 — Fleet realities.** Artifact files 0600 where honored + explicit Windows-ACL fallback story
(Node ignores `mode: 0o600` on Windows — local-dev posture runs world-readable today; the bundle
concentrates three secrets per artifact). MinIO service key: PutObject+GetObject on
`vela-backups/*` ONLY (no List/Delete). The rolling `latest` alias cannot be the boot-strap's
only integrity anchor — the artifact's own checksum + schema version are verified at boot-strap
restore (whoever can PUT to the bucket otherwise controls every reinstall).

**Score amended**: Security 3 → **treated as 2-equivalent until S1–S7 land**; composite recomputed
after Gate 11. The eight holes were real with zero false positives — the skeptic's audit stood.

## Consequences

**What becomes easier**: zero-risk local posture (sqlite statements untouched); idiomatic MySQL
with native pooling; ONE complete export serving backup, restore, posture-switch, and mirror
resync; parity harness makes second-engine rot visible; fleet backups gain covenant-grade
encryption + restore + drill the fleet ADR already mandates; no-ECC hardware finally has the
backups its recorded law demands.

**What becomes harder**: every future repo-layer change lands twice (~1.8× tax, priced into the
roadmap explicitly — Wave B adds ~6-10 doubled functions: backupRepo, purge, ledger); contract
tests need a live MariaDB for full value (opt-in convention with loud skip); the mirror pump is
a delicate single-writer piece; security review must sweep two codebases.

**Risks carried**: mirror consistency is eventual (bounded by pump interval — stated honestly,
never "real-time"); backup key loss = permanent unrecoverable loss of ALL encrypted backups
(mitigation: documented offline key storage); MinIO is new fleet infrastructure to operate;
fleet network rename (W1) requires re-verification of Vela's join; await-bearing mirror writers
carry a documented fail-open crash window.

**Alternatives rejected**: The Confluence (asyncifies the hot usage-write path of every routed
request + mutex redesign of sqlite transactions); The Loom/knex (no sql.js/node:sqlite/bun:sqlite
client — amputates the pure-JS fallback floor; 22 transitive deps incl. unmaintained `esm`;
lazy-builder silent no-ops); do-nothing (a single SSD death erases every credential and record —
violates the homelab's own recorded law).

## Phase 11 — The Connection Weave

**Inside the design** (the internal constellation):
- `exportDb`/`importDb` is the load-bearing hub — backup, restore, posture-switch, mirror
  resync, and the restore drill all ride ONE seam; its completeness law + redaction list +
  quarantine fields are the covenant's center of gravity.
- The existing cloud sync (`settings.cloudEnabled/cloudUrl`) is RELATIONSHIP-DEFINED, not
  overlapped: cloud sync = settings-level replication (existing), mirror = store-level
  replication (new), S3 off-site = backup-artifact shipping (new). Three layers, one direction
  each, documented in AGENTS.md at seal time.
- Scheduler precedent: `quotaAutoPing`'s `global.__*` singleton shape; auth precedent:
  `verifyDashboardPassword` + dashboardGuard `ALWAYS_PROTECTED`; migration precedent: the
  `_meta` versioned registry; export precedent: `apiKeys`' §3.7 governance-completeness comment
  (the intent was always restore-survival).

**Across the Shores** (the external constellation):
- **Docker fleet constitution** → the chart edits obey it (pinned images, inline secrets,
  bind mounts, healthchecks, x-casaos); MinIO joins `Database.yml` as a fleet service.
- **Fleet upgrade ADR** → Wave 1's network rename (tethys-databases_default → tethys-databases)
  is a named coordination point; Vela's MariaDB install ritual follows the Pelican precedent.
- **Milestone Tide covenant** → v0.6.52 → v0.6.60, one commit per wave-milestone, golden
  snapshot regen after bump.
- **tests baseline machinery** → verify-no-regression.mjs + snapshot/verify pairs gain
  storage-census, contract-surface, and export-completeness pins (the pricing-covenant
  precedent: never-shrink gates).
- **The homelab's recorded law** (no-ECC RAM → no mission-critical DB without good backups)
  is the covenant's founding justification; the backup ledger gives the fleet ADR its
  long-deferred restore drills.

**Skills woven**: the-stillwater-mirror (this ceremony) → the-forge-wright/the-forge-prover
(the forge that implements Waves A–C) → the-tidebreaker (three adversarial passes already:
frame, selection, security score) → the-sealing-tide (the v0.6.60 seal).

## Phase 12 — The Storm Test

| # | Storm | The design's answer |
|-|-|-|
| 1 | **SSD death (homelab)** — primary store gone | sqlite posture: restore newest encrypted artifact onto fresh install (trust crossing + secret bundle + restart contract). **mirror posture's hidden blessing: the MariaDB replica IS a recovery source** — export from the shadow, restore into any posture (usage loses ≤ one watermark-resync interval — stated honestly) |
| 2 | Corrupt/tampered artifact | GCM auth-tag verified BEFORE any restore step → refuse → ledger `failed` → advance to next tier |
| 3 | **Backup key loss** | All encrypted artifacts unrecoverable — BY DESIGN (client-side). Mitigation discipline: offline key storage documented in the plan + .env.example warning; stated as accepted risk at every enablement |
| 4 | Crash mid-backup | Artifact written to temp file; atomic rename into place only after completion + self-verification; ledger rows only for completed artifacts; boot sweeps stale temps |
| 5 | Crash mid-restore | Pre-restore safety backup first; sqlite import is one transaction (crash = rollback); mysql twin: single-transaction import below a size cap, batched-with-resume-marker above it |
| 6 | MariaDB down during mirror writes | Outbox accumulates (S3-bounded: args redacted after first apply attempt, aged out regardless of status); primary serves; pump backoff-retries; ledger alert |
| 7 | Fleet network rename (W1) mid-life | Pump loses reachability → behaves as storm 6; `VELA_MYSQL_URL` re-pointed after W1; catch-up drains; re-verification is a named Wave C gate |
| 8 | sql.js fallback under mirror | WARN-pinned; crash may lose ≤~100ms of debounced persistence; the outbox lives in the same file and replays on boot — replication self-heals |
| 9 | Two instances sharing one DATA_DIR | Unsupported; boot-time advisory lock file + WAL single-writer note in docs |
| 10 | Backup colliding with migration | Migrations run at boot only; scheduler starts after; pre-schema backup already covers schema windows |
| 11 | Purge vs in-flight backup | Purge runs AFTER the scheduled backup; purged rows live in the artifact first; purge batched |
| 12 | MinIO down during upload | Fail-open; ledger marks off-site `pending`; next run retries; local tiers hold |
| 13 | Cross-posture restore (sqlite artifact → mysql target) | Dialect coercion at import (NOT NULL ''-backfill etc.); schema-version compatibility check; pinned by the round-trip test |
| 14 | Malicious decryptable artifact | S1 trust crossing: hostile-payload bounds + restore-quarantined fields + adoptSecrets re-confirm |
| 15 | Disk full mid-backup | Free-space threshold check before run; fail-open with ledger alert; retention pruning continues |
| 16 | Restore during scheduled-run window | Scheduler holds a singleton run-lock; restore endpoint returns 409 while a run is active (and vice versa) |

## Phase 13 — The Shield Gate

S1–S7 ARE the shield review, verified line-by-line by the Tidebreaker's score-audit (eight holes
real, zero false positives, four deepened). Residual surfaces examined and bound:
- **Artifacts are untrusted input** — the trust crossing is the covenant's security center of gravity
- **Ledger/API responses** return metadata only; error strings scrubbed of paths/SQL (React's
  default escaping covers dashboard render)
- **No web-content consumption** in the backup engine — the ai-security.md injection surface does
  not apply; the import boundary is the only adversarial channel and it is guarded
- **Secret inventory complete**: provider OAuth tokens, apiKeys keyHashes, oidcClientSecret,
  settings password hash, the three DATA_DIR secret files, outbox args (bounded) — all inside the
  AES-256-GCM envelope or excluded by name
- Fleet inline-secret convention acknowledged: `BACKUP_ENCRYPTION_KEY` rides the chart per fleet
  law (private subnet) — and S1 makes even a chart-compromised attacker unable to take over via
  restore without the dashboard password

## Verification Record

- **Phases 1–4**: ground-truth recon (schema v3, 12 tables, sync adapter chain verified) + intel
  fan-out (8 agents, 324 tool uses) + sql.js empirical probe (3.49.1, ON CONFLICT + VACUUM INTO
  proven) + sizing measurement (256K live DB) + frame REFUTED by Tidebreaker → reforged (13
  criteria, three waves, outbox model) → Gate 4 passed.
- **Phases 5–6**: three forges (Confluence 4.0, Loom self-refuted — no sql.js/node:sqlite/bun:sqlite
  knex clients, Twin Harbors 4.5) + selection assaulted (STANDS WITH REVISIONS, six binding
  revisions absorbed) → Gate 6 passed.
- **Phases 7–8**: full blueprint + consequences → Gate 8 accepted.
- **Phase 9**: five arbiters — Architecture 4, Testability 4, Security 3, Performance 4,
  Feasibility 4 → composite 3.80. Tidebreaker score-audit: **SCORE TOO LOW** (eight holes real,
  zero false positives, four understated) → S1–S7 binding.
- **Phase 10**: all fixes absorbed — saveRequestDetail exempted, complete ~33-writer taxonomy,
  poison-op policy, export-read transaction, watermark usage-resync, batched restore, Dockerfile
  mysql2 trace, A9 split, decorator re-budgeted, auto-census pin, CI parity path.
- **Phase 11**: connection weave recorded (cloud sync / mirror / S3 relationship defined).
- **Phase 12**: 16 storms answered. **Phase 13**: shield gate closed.
- **Phase 15 pre-seal sweep**: all 13 reforged criteria mapped to mechanisms; every Tidebreaker
  revision (frame ×8, selection ×6, security ×7) present in the blueprint; no open questions
  remain for the forge.
- **Adversarial passes total**: 4 (frame, selection, security score, + Loom self-refutation).

**Sealed 2026-08-15** by the Star's word at Gate 14. The forge opens with Wave A.

---

*Three postures, one memory, and not a single record lost to any disk death. The Star casts the
stone. The Keeper tends the current. The covenant is sealed.* 🪞🗄️💜🌊

---

*The Star casts the stone. The Keeper tends the current.* 🌊💜
