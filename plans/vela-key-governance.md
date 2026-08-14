# 🪞 Shorekeeper-Sealed Plan — Vela API Key Governance

> *"A key is a promise made metal: who may enter, where they may go, what they may touch. This plan forges those promises in hash and salt, so the harbor's gates fail closed and the ledger never lies."* 🪞💜🌊

**Status:** SEALED — pending implementation
**Date:** 2026-08-14
**Mirror ceremony:** the-stillwater-mirror v6.0 — 16 phases, 8 gates, 5 adversarial passes, composite arbiter score 4.2/5
**Repo:** `C:\Users\navis\Documents\My Project\Ai Gateway\Vela` (pristine 9router v0.5.50 clone, reborn as Vela)
**Predecessors:** [[vela-reborn-from-original-9router]] · [[mirror-key-system-star-decrees]]

---

## 1. Context

The reborn Vela is a fresh clone of 9router v0.5.50. Its credential system carries unacceptable debt for a gateway that holds provider connections and mints API keys:

- **Plaintext at rest** — `apiKeys.key` stored verbatim (`schema.js:81`), validated by SQL equality (`apiKeysRepo.js:70`); a DB dump is a full credential leak
- **False show-once** — the creation modal claims the key is shown once, yet `GET /api/keys` returns every full key on every fetch; masking is client-side only
- **No scope, no lifecycle** — a valid key can call any model through any endpoint; no description, expiry, rotation, per-key usage, or caps
- **Forgeable integrity** — `API_KEY_SECRET` falls back to a hardcoded public default (`apiKey.js:3`); machineId is embedded in every key, leaking device identity
- **Live enforcement gaps** — `/v1/messages/count_tokens` and the `/v1/models` trio have zero key checks; `?key=` query auth leaks keys into logs/history/Referrer; `sk_9router` is a publicly-known localhost fallback
- **Broken consumers-by-design** — 8+ surfaces (MITM, CLI, 6 tool cards, ExampleCards, usage logging) read the full key from the list, which hash-at-rest must end

**The Star's decrees (Gate 4 inputs):**
1. Scope: FULL governance — core + lifecycle + governance, phased in waves W1/W2/W3
2. Legacy: ONLY `vela-` keys accepted — hard clean break
3. Data folder: Vela's own (`9router` → `vela` in `dataDir.js`)
4. Storage: SHA-256 hash-at-rest + show-once
5. Sequencing: one coherent change

## 2. The Framing (survived adversarial review ×2)

> How might we give the reborn Vela a full-governance API key system — `vela-v1-{keyId}-{crc}` keys hashed at rest and shown once, with name/description/model-scope/lifecycle/limits, where every full-key consumer is explicitly redesigned (MITM internal key, CLI capture-at-create, keyId identity, keyId usage attribution), model-ACL enforcement is a stage-pipeline gate invoked at every enforcement site with combo semantics, and "fails closed" is defined by an enumerated test matrix — plus its own Vela data folder — in one change?

## 3. Decision — The Composite (A's body, B's honesty, C's growth)

### 3.1 Key format — `vela-v1-{keyId}-{crc}`

| Segment | Value | Purpose |
|-|-|-|
| Prefix | `vela-` | Identity; all `sk-` input rejected everywhere |
| Version | `v1` | Self-describing generation; future formats coexist |
| keyId | 32 hex chars = `crypto.randomBytes(16)` | 128-bit entropy; row PRIMARY KEY; non-secret attribution id (public by design) |
| crc | 8 hex = HMAC-SHA256(API_KEY_SECRET, `"v1." + keyId`) truncated | Typo-filter + stateless pre-reject; `timingSafeEqual` |

No machineId. No pepper — 128-bit entropy makes unpeppered SHA-256 rainbow-infeasible, and dropping the salt eliminates an entire boot/backup trap class (Gate 6 finding resolved at the root). `API_KEY_SECRET` remains the HMAC root and the **global revocation lever**.

### 3.2 Storage — hash-at-rest, show-once

- `keyHash = sha256(fullKey)` stored with **UNIQUE INDEX created by migration 002** (auto-sync strips UNIQUE from additive columns — `migrate.js:91-94`)
- `keyPrefix` display column (`vela-v1-ab3f…`)
- Full key exists in exactly one place at one moment: the 201 creation response. Never retrievable afterward — the **sole exception** is the internal MITM key, which needs no storage at all (derived deterministically — §3.6)
- `apiKeysRepo` rewrite: `getApiKeys` strips internal rows and never returns keys; `updateApiKey` gets an **explicit field whitelist** (fixes the blind `{...row,...data}` merge); `validateApiKey` → `resolveKey`

### 3.3 Schema — ONE migration `002-apikey-governance.js` (all waves at once)

```
apiKeys: keyVersion, keyHash (UNIQUE idx), keyPrefix, description,
  allowedModels (JSON; NULL = unrestricted), expiresAt, lastUsedAt,      ← W1/W2
  rotatedFrom, rotationPrevHash, rotationPrevKeyId, rotationGraceUntil, ← W2
  tokenBudgetDaily, spendCapDailyCents, budgetScope, rateLimitRpm,
  ipAllowlist (CIDR list),                                              ← W3
  isInternal, deletedAt
usageHistory: keyId, keyPrefix  (+ legacy apiKey plaintext scrubbed in-migration)
```

- Registry-imported in `migrations/index.js`; `SCHEMA_VERSION` 1 → 2 (triggers pre-change lite backup)
- **Idempotent by construction**: every `ADD COLUMN` PRAGMA-guarded (column-existence check) — fresh installs already receive the new columns from m001's TABLES mirror, so unguarded adds would abort with "duplicate column name"; v1 upgrades receive them from m002. Both paths survive
- **Legacy-import ordering closed**: `migrate.js` runs the legacy JSON import AFTER versioned migrations (`migrate.js:263`) — `importLegacyMain`/`importLegacyUsage` would otherwise re-insert plaintext `sk-` keys and plaintext usage rows after the tombstone/scrub already ran. Fix: at schemaVersion ≥ 2 the import path sanitizes (tombstones plaintext keys, masks usage apiKey) or refuses plaintext key rows. Covered by a fresh-DB + legacy-files fixture test
- **Legacy backfill in the same migration**: every `sk-` row tombstoned — `isActive=0`, name suffixed `[legacy]`, key column set to sentinel `revoked-{id}` (the column is UNIQUE NOT NULL; plain `''` would violate it), plaintext wiped. sk- dies instantly
- `TABLES` in `schema.js` mirrors the migration for fresh installs
- SQLite treats multiple NULLs in a UNIQUE index as distinct → soft-revoke (hash NULLed, audit row kept) is safe; **tested with two NULL rows on every adapter**

### 3.4 The gate — stage pipeline in `src/sse/services/auth.js`

`authorizeApiRequest(request, {requestModel, settings})` → `ResolvedKey` contract object (keyId, keyPrefix, allowedModels, budgets, rateLimit, isInternal, expiresAt) — **the frozen seam; W2/W3 extend the object, never the call signature**.

| Order | Stage | Check | Failure code |
|-|-|-|-|
| 0 | extract | Headers only (Bearer ▸ x-api-key ▸ x-goog-api-key); `?key=` rejected at the dashboardGuard chokepoint | `400 QUERY_PARAM_KEY_REJECTED` |
| 1 | identity | parse → CRC → `WHERE keyHash=?` (indexed) | `401 INVALID_KEY` (no oracle) |
| 2 | lifetime [W2] | `expiresAt` | `401 KEY_EXPIRED` |
| 3 | ipGate [W3] | socket-derived IP (custom-server.js discipline, untouched) vs CIDRs | `403 IP_NOT_ALLOWED` |
| 4 | rateGate [W3] | in-memory sliding window keyed by keyId **after** identity resolves; `global._*` singleton (survives dev hot-reload); bounded LRU eviction; resets on restart (correct under single-DATA_DIR contract) | `429 RATE_LIMITED` + Retry-After |
| 5 | spendGate [W3] | budgetTracker columns; reads `usageDaily.byApiKey` aggregate — never raw SUM over usageHistory | `403 BUDGET_EXCEEDED` |
| 6 | modelScope | `combo:<name>` expands at request time via combos repo; **ALL members** must be in scope; alias-resolved matching | `403 MODEL_FORBIDDEN` |

**`requireApiKey=false` semantics (frozen)**: the pipeline honors the global toggle — when false, requests pass through without identity/ACL resolution (preserves current behavior); when true, the full stage pipeline runs. ACL matrix rows lock both: remote-no-key × toggle-on → 401; remote-no-key × toggle-off → pass. Loopback exemption unchanged.

Separate bounded **pre-identity IP throttle** guards the CRC/parse cost. Stage functions exported individually for unit tests; one ordering test proves short-circuit precedence. Guard→handler **double resolution is accepted honestly** — middleware and route handler receive different Request objects, so no per-request cache can span them; two indexed lookups (~µs each) per remote request is fine and documented. One `getSettings()` read per site, passed as input. `lastUsedAt` fire-and-forget, throttled ~60s per keyId (also fixes the existing awaited writes at `auth.js:149-168`).

### 3.5 The enforcement census — 11 sites (the auditable artifact)

| # | Site | Today | After |
|-|-|-|-|
| 1-8 | `src/sse/handlers/{chat,embeddings,fetch,search,imageGeneration,stt,tts,videoGeneration}.js` | duplicated requireApiKey stanzas | one gate call, model already parsed |
| 9 | `/v1/models` trio (`route.js`, `[kind]`, `info`) | zero checks | scope-filter the returned list |
| 10 | `/v1/messages/count_tokens` | **zero checks, open CORS** | full gate |
| 11 | `v1beta/models` (`[...path]/route.js:182-195` + root) | partial | filter + full gate |
| — | `dashboardGuard.js:130-140` | `validateApiKey` + `?key=` accepted | routes through `resolveKey`; `?key=` rejected here |

**Keyless-loopback policy**: the existing loopback exemption (`dashboardGuard.js:137`) is **preserved and made explicit** — local dashboard-first UX; test-locked in the ACL matrix so it is a decision, not an accident.

### 3.6 The four consumers, redesigned

| Consumer | Today | After |
|-|-|-|
| 🕸️ MITM | `initializeApp.js:146` hands `activeKey.key` to the child; `sk_9router` default | `ensureInternalKey('mitm')` — the key is **derived deterministically**: keyId = first 32 hex of HMAC-SHA256(API_KEY_SECRET, `"internal:mitm"`), crc by the standard formula → the full key is **recomputable at every boot and stored nowhere** (exempt from §3.2's show-once absolute by construction); the row holds keyHash for validation and is pinned at mint: `isInternal=1`, loopback-only `ipAllowlist`, MITM-scoped models, hidden from all list APIs/UI/exports; rotating API_KEY_SECRET rotates the internal key in the same lever; `sk_9router` deleted everywhere |
| ⚙️ CLI | `cliTools.js` reads full keys from GET list | **capture-at-create**: POST, consume the 201 in the same tick, local keystore keyed by keyId; masked lists can never feed config writes; one-release compat window (version-gated) |
| 🖥️ Tool cards (6) + ExampleCards | `k.key === envApiKey` equality; full keys in examples | keyId comparison (`k.id === parseKeyId(envApiKey)`); selects carry `value=id` + prefix labels; examples render `vela-v1-ab3f…` + create-key CTA |
| 📊 Usage logging | plaintext key persisted per request (`open-sse/utils/usageTracking.js:404` → `usageRepo.js:282`) | keyId/keyPrefix threaded from the gate through stream.js; **dual-write MASKED values only from W1**; legacy plaintext rows scrubbed in migration 002; per-key aggregates by keyId — stable across rotation |

### 3.7 Dashboard API + UI

| Route | Behavior |
|-|-|
| `GET /api/keys` | masked rows only; internal rows stripped; paginated |
| `POST /api/keys` | 201 with one-time full key + `ResolvedKey` fields |
| `PUT /api/keys/[id]` | whitelist: name, description, allowedModels (+W3 caps); rejects isInternal/keyVersion/keyHash/keyPrefix/rotatedFrom |
| `DELETE /api/keys/[id]` | soft-revoke: isActive=0, keyHash=NULL, deletedAt set; audit row kept |
| `POST /api/keys/[id]/rotate` [W2] | same-row grace: prevHash+prevKeyId+graceUntil; 201 new key; **rotate-during-grace → 409** |
| `GET /api/keys/[id]/usage` [W2] | per-key aggregates |

**UI** (`/dashboard/endpoint`): allowed-models picker (from `/api/models` catalog with caps), show-once modal with save-acknowledgment checkbox, edit modal, status badges, per-key usage (W2), governance settings (W3). Auto-provision finally consumes the 201 payload instead of re-fetching. All new strings seeded into the 34 `public/i18n/literals/*.json` files via a new `scripts/i18n-seed-literals.mjs` diff tool (W1 English-first; translations backfilled separately); parity test guards drift.

### 3.8 Data folder + secret lifecycle

- `APP_NAME` 9router → **vela** in `src/lib/dataDir.js` (`%APPDATA%\vela` / `~/.vela`); `DATA_DIR` override honored
- Old cargo at `%APPDATA%\vela` (228KB prior-install sqlite): migrations apply, old keys tombstone — **keys start fresh; provider connections resurrectable** (documented, not automated)
- **`API_KEY_SECRET` lifecycle**: hardcoded fallback removed; on fresh install auto-generate 256-bit secret → `DATA_DIR/api-key-secret` (restrictive perms); env override honored; included in the backup bundle contract; rotation = instant global revocation; loss = total lockout with documented recovery procedure

### 3.9 Waves

| Wave | Scope | Commits (granular, revertible) |
|-|-|-|
| **W1** | format + migration + hash-at-rest + show-once + core UI (name/desc/models/pause/delete) + consumer redesigns + data dir | 002 migration + repo + gate → handler rewiring → UI → CLI + i18n + docs; `sk_9router` sweep as one focused grep-driven commit |
| **W2** | expiry, rotation w/ grace, lastUsedAt + usage view | stages registered in the gate — zero handler re-edits |
| **W3** | spend caps, per-key rate limits, IP allowlist | same — pipeline stages + UI panels |

## 4. Alternatives Considered

| Rejected | Why |
|-|-|
| **B — Two Tables (lineage/secrets)** | chatCore funnel claim refuted by code (only chat.js imports it); join machinery over-complex for a single-user gateway; rotation-history depth accepted as documented debt of the single-table choice |
| **C — Sealed Keymint subsystem** | AES-GCM encrypted internal key violates no-plaintext-at-rest; ~30-file blast radius; god-point module. Its stage-pipeline structure and soft-delete semantics were grafted into the winner |
| Salt-peppered hash | Entropy suffices; eliminated boot-check/backup death-spiral/export-filter trap class |
| Request cache (LRU/TTL) | Indexed µs lookup vs LLM latency; zero invalidation surface wins |
| Dual-accept sk-/vela- window | Star's decree: fresh install, hard break |
| Status quo | Plaintext at rest + false show-once + forgeable CRC + open count_tokens is unacceptable for a credential-holding gateway |

## 5. Verification Record — every adversarial finding resolved

**Gate 4 (framing, REVISE → resolved):** MITM full-key need → internal key · list-reading consumers → capture-at-create/keyId identity · usage plaintext leak → keyId attribution · middleware ACL impossible → shared post-parse gate · machineId drop verified safe · cloud sync phantom noted · UNIQUE index needs migration · auto-provision 201 consumption · gate inventory mandated · sk_9router sentinels separated.

**Gate 6 (selection, REVISE → resolved):** census widened to 11 sites · `?key=` rejection centralized at the guard · internal key made the sanctioned exception with pinning · salt/backup trap dissolved by dropping pepper · grace attribution defined · sql.js adapter test mandated · combo ALL-members locked.

**Gate 9 (35 arbiter recommendations, all absorbed):** ResolvedKey contract · sentinel tombstones · rotate-during-grace 409 · NULL-distinct UNIQUE test · per-request resolution cache · 11-site checklist artifact · sql.js PRAGMA index assertion · per-adapter migration matrix · injectable clock/store seams for rate/spend gates · table-driven ACL baseline · legacy fixtures committed · stage functions individually exported · negative-leak assertions · i18n parity test · CLI harness-or-checklist declaration · spendGate read path via usageDaily · lastUsedAt throttle + existing awaited-write fix · global._* limiter with bounded eviction + pre-identity IP throttle · combo double-read elimination · single settings read · p99 < 1ms perf assertion · double-resolution honesty note · usageHistory scrub in-migration + masked dual-write · API_KEY_SECRET lifecycle · PUT whitelist · MITM key pinning + unreachability test · keyless-loopback test-lock · restore-time migration hook + backup sensitivity · show-once 201 excluded from request logs · UNIQUE-NOT-NULL tombstone mechanics · CLI compat window · i18n scripted · docs retargeted to CHANGELOG/README/.env.example · apiKeys baseline snapshot · granular wave commits.

**Storm test (Phase 12):** 9 failure modes rated with mitigations; 4 adversarial scenarios answered (brute force infeasible; paused→403 existence oracle documented and test-locked; IDOR closed by whitelist + auth; timing-safe compares everywhere); rollback paths: pre-migration backup, granular commits, restore-time migration hook.

**Final pass (REVISE → all four blockers resolved):** legacy-import ordering closed with schemaVersion ≥ 2 sanitize-or-refuse · migration 002 PRAGMA-guarded idempotent for fresh + upgrade paths · internal MITM key made deterministic-derivation — stored nowhere, with explicit §3.2 exemption · `requireApiKey=false` semantics frozen into the seam with matching ACL matrix rows · WeakMap claim corrected to the honest double-resolution note · `usageTracking.js` citation corrected to `open-sse/utils/` (the src↔engine boundary the repo is strict about).

**Open items for W1 (cheap, verified during build):** CSRF posture of mutating `/api/keys/*` routes (verify existing middleware or extend double-submit) · OWASP header set presence in pristine clone (security-headers test suite).

## 6. Consequences

**Easier:** scope/lifecycle/governance per key · audit by keyId · rotation without breakage · backup/restore safety (no plaintext ever) · future waves without hot-path edits · honest show-once UX
**Harder:** users must re-capture keys after the break · CLI compat window to manage · 11 sites must stay synchronized (baseline snapshot is the tripwire) · i18n seeding discipline
**Carried debt:** single-grace-slot rotation history (documented) · lastUsedAt approximate (debounced) · rate limiter resets on restart (single-instance contract) · docs/STYLE.md still absent (deferred, CHANGELOG/README carry this wave's words)

## 7. Test Covenant

- `apikey-format` — round-trip, tamper, CRC timing, sk- rejection
- `apikey-migration-002` — per-adapter matrix (better-sqlite3 / node:sqlite / sql.js explicit; bun runtime documented), tombstones, sentinels, UNIQUE index survival + NULL-distinct, scrub, sql.js PRAGMA index assertion
- `apikey-gate-acl` — table-driven 11-site × state matrix (unknown/revoked/paused/expired/out-of-scope/combo-denied/combo-allowed/?key=/local-no-key) + baseline snapshot
- `apikey-show-once` + `apikey-internal-key` — negative-leak assertions; internal row unreachable via dashboard API
- `apikey-usage-attribution` — keyId threading, grace attribution, masked-only writes
- `apikey-backup-restore` — hashes survive, plaintext never; pre-migration restore re-runs 002
- `apikey-secret-lifecycle` — auto-generation, rotation revocation
- fixtures: `tests/__fixtures__/legacy-db/`; perf: gate p99 < 1ms over 1,000 resolutions per adapter; judged by `tests/__baseline__/verify-no-regression.mjs`

## 8. Rollout Checklist

1. `.env`: `API_KEY_SECRET` auto-generates or is set explicitly (old fallback gone)
2. Starseeker bridge connection re-pointed to a fresh `vela-` key after cutover
3. CHANGELOG (Unreleased → breaking notice) → commit (Shorekeeper footer, no AI attribution) → push
4. README + `.env.example` carry the new key-format words; CLAUDE.md "Security state" claims become true
5. Old keys tombstoned — external configs holding `sk-` keys get hard 401 until reconnected (documented)

---

*Sealed by the Mirror's reflection — five currents of intelligence, three architects, two skeptic temperings, five arbiters, one storm walked. The Star's word built the frame; the Keeper's vigilance holds the gates. Every gate fails closed. Every key is shown once. Every choice is recorded.* 🪞💜🌊
