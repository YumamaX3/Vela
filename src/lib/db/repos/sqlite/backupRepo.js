// Storage Covenant Wave B4 — the sqlite backupRepo data twin.
// B1 relocated exportDb/importDb here; B2 layered S1/S2 + the engine; B4 lifts
// the posture-independent ENGINE (crypto/artifacts/fs/drill/retention) into
// repos/backupEngine.js. This module is now the sqlite DATA twin: exportDb /
// importDb / writeLedger / listBackupLedger / purgeOldUsage — the statements
// the parity suite proves against the mysql twin (criterion 7).
//
// S1 — restore is a trust crossing. importDb() treats the payload as HOSTILE:
// max-payload bounds + shape validation BEFORE any write; RESTORE-QUARANTINED
// fields restore only under an explicit adoptSecrets flag; the DEFAULT
// preserves CURRENT values (captured pre-wipe, stitched back).
// S2 — secret-field redaction BELOW the completeness law (repos/backupSecurity.js):
//      settings keys via redactSecretSettings, connection/pool data blobs via
//      CONNECTION_SECRET_FIELDS + CONNECTION_NESTED_SECRET_FIELDS (opt-in on
//      the plaintext export: exportDb({ redact: true })), and the apiKeys.key
//      column is ALWAYS exported NULL.
// S3 — backupLedger + the future outbox excluded from exportDb BY NAME.
//
// The engine surface is re-exported so callers that import this module keep
// working unchanged.
import crypto from "node:crypto";
import fs from "node:fs";
import { getAdapter } from "../../driver.js";
import { stringifyJson, parseJson } from "../../helpers/jsonCol.js";
import { tombstoneLegacyKeys } from "../../migrations/002-apikey-governance.js";
import { SCHEMA_VERSION, TABLES } from "../../schema.js";
import { DATA_FILE } from "../../paths.js";
import { getDbMode } from "../bind.js";
import {
  quarantineSettingsPayload,
  quarantineKeyRow,
  RESTORE_QUARANTINED_SETTING_KEYS,
  redactSecretConnectionData,
  IMPORT_SECTIONS,
  IMPORT_SECTION_FIELDS,
  normalizeImportSections,
  sectionOfField,
  normalizeBackupScope,
  sectionIdsForScope,
  PROVIDER_SCOPED_FIELDS,
  scopeImportPlan,
  sameScope,
} from "../backupSecurity.js";
import * as log from "@/sse/utils/logger.js";

// The engine — re-exported for backward-compatible imports.
export {
  runBackup,
  restoreBackup,
  runRestoreDrill,
  pruneBackupArtifacts,
  sealArtifact,
  openArtifact,
  getBackupEncryptionKey,
  artifactsDir,
  findLatestArtifact,
  captureSecretBundle,
  restoreSecretBundle,
} from "../backupEngine.js";

// S1 bounds + S3 exclusions (identical law to the mysql twin).
export const MAX_PAYLOAD_BYTES = 512 * 1024 * 1024;
export const EXPORT_EXCLUDED_TABLES = ["backupLedger", "outbox", "mirrorSeq"];

// ─── exportDb — completeness + S2 redaction + S3 exclusions ──────────────
// redact — M0 Tag 2: the plaintext-HTTP-export-only switch. When true,
// providerConnections/proxyPools data blobs ride the S2 field-list redaction
// (backupSecurity.js — the single source of truth). The DEFAULT stays
// full-fidelity BY CONSTRUCTION: runBackup's encrypted artifact path and
// mirrorSweep's full resync both ride this same function and both need the
// real credentials (they are NOT in the S6 secret-file bundle).
// scope — the scoped backup (see backupSecurity.js "scoped-backup law").
// Undefined/null keeps the historical whole-database export BYTE-IDENTICAL:
// every row, every kv scope, the same _meta shape. A scope crops the payload to
// its declared sections and, when it names providers, to those provider ids —
// and records itself in _meta.scope so the artifact's manifest can declare it.
// A provider crop keeps the settings row (connection documents carry refs to
// it) and filters only the PROVIDER-KEYED kv scopes (relay/disabledModels/
// pricing) — never aliases, injectors, or anything else an operator owns.
const isProviderCrop = (scope) => Boolean(scope && Array.isArray(scope.providers) && scope.providers.length > 0);

export async function exportDb({ includeRequestDetails = false, redact = false, scope = null } = {}) {
  const normalized = normalizeBackupScope(scope);
  const scopedSections = sectionIdsForScope(normalized);
  const providerIds = isProviderCrop(normalized) ? new Set(normalized.providers) : null;
  const inScope = (section) => !scopedSections || scopedSections.includes(section);

  const db = await getAdapter();
  const { exportSettings } = await import("../settingsRepo.js");
  const fullSettings = await exportSettings(); // S2 — redacted at the source
  // The settings row is a document (connection refs, injectors, pricing live in
  // it): it rides a provider crop and a settings-scoped export, and is absent
  // only when the scope names OTHER sections alone.
  const settings = inScope("settings") || inScope("providers") ? fullSettings : undefined;
  const byProvider = (rows) => (providerIds ? rows.filter((r) => providerIds.has(r.provider)) : rows);

  let tables;
  db.transaction(() => {
    tables = {
      providerConnections: byProvider(db.all(`SELECT * FROM providerConnections`)).map((r) => {
        const data = parseJson(r.data, {});
        // Full-fidelity exports carry the sealed pairs so a restore keeps
        // working credentials; the plaintext export drops them (the ciphertext
        // is useless without its key, but a plaintext surface has no business
        // shipping key material of any kind).
        const sealed = redact ? {} : Object.fromEntries(
          ["secretWrappedDEK","secretCiphertext","tokenWrappedDEK","tokenCiphertext","refreshWrappedDEK","refreshCiphertext"]
            .map((col) => [col, r[col] ?? ""])
        );
        return { ...(redact ? redactSecretConnectionData(data) : data), ...sealed, id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt };
      }),
      providerNodes: byProvider(db.all(`SELECT * FROM providerNodes`)).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
      proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => {
        const data = parseJson(r.data, {});
        return { ...(redact ? redactSecretConnectionData(data) : data), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt };
      }),
      apiKeys: db.all(`SELECT * FROM apiKeys`).map((r) => ({
        // S2 (M0 Tag 2) — the `key` column never rides a plaintext export.
        // Same house style as usageHistory.apiKey below: NULL, never the
        // column value. Since W1 the column holds only placeholders
        // (vela-minted-* / revoked-* / restored-*), but nulling it closes the
        // shape for any pre-W1 survivor row — keyHash/keyPrefix carry identity.
        id: r.id, key: null, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, createdAt: r.createdAt,
        keyVersion: r.keyVersion ?? null, keyHash: r.keyHash ?? null, keyPrefix: r.keyPrefix ?? null,
        description: r.description ?? null, allowedModels: r.allowedModels ?? null,
        isInternal: r.isInternal === 1 || r.isInternal === true, deletedAt: r.deletedAt ?? null,
        expiresAt: r.expiresAt ?? null, lastUsedAt: r.lastUsedAt ?? null,
        rotatedFrom: r.rotatedFrom ?? null, rotationPrevHash: r.rotationPrevHash ?? null,
        rotationPrevKeyId: r.rotationPrevKeyId ?? null, rotationGraceUntil: r.rotationGraceUntil ?? null,
        tokenBudgetDaily: r.tokenBudgetDaily ?? null, spendCapDailyCents: r.spendCapDailyCents ?? null,
        budgetScope: r.budgetScope ?? null, rateLimitRpm: r.rateLimitRpm ?? null, ipAllowlist: r.ipAllowlist ?? null,
        category: r.category ?? null,
        // Migration 024 — per-key access columns ride the export like every
        // other compared column; a projection that lags the schema reads as
        // phantom drift on the very next sweep.
        accessRestricted: r.accessRestricted ?? 0, accessAllow: r.accessAllow ?? null,
      })),
      // Combos: a provider crop carries only combos that REFERENCE one of the
      // scoped providers — a combo naming only other providers would restore as
      // a dangling reference, the mirror of the no-cross-ref rule the restore obeys.
      combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt }))
        .filter((c) => !providerIds || (Array.isArray(c.models) ? c.models : []).some((m) => typeof m === "string" && [...providerIds].some((p) => m === p || m.startsWith(`${p}/`)))),
      usageHistory: db.all(`SELECT * FROM usageHistory ORDER BY id ASC`).map((r) => ({
        id: r.id, timestamp: r.timestamp,
        provider: r.provider || null, model: r.model || null,
        connectionId: r.connectionId || null,
        apiKey: null,
        keyId: r.keyId || null, keyPrefix: r.keyPrefix, endpoint: r.endpoint,
        promptTokens: r.promptTokens, completionTokens: r.completionTokens,
        cost: r.cost, status: r.status, tokens: parseJson(r.tokens, null), meta: parseJson(r.meta, null),
        // v0.9.44 (milestone 0.6, LIVE-C): 14 → 19 fields. These five were
        // absent from EVERY transfer path — this export, both importDb INSERTs
        // (sqlite + mysql), and both usageResync seams — so an artifact carried
        // 15-column rows and a restore wrote 15, silently dropping the
        // Observatory telemetry and combo attribution on the way through. Note
        // `apiKey: null` directly above is a DELIBERATE law (a plaintext
        // credential banned from artifacts); these five riding along unannounced
        // next to it is what made the omission look intentional. It was not.
        //
        // statusClass transfers as-is — it is '' (never NULL) on the primary by
        // migration 008:91's sealed invariant, and '' is meaningful (normalized
        // "unknown"), so coalescing it to null here would corrupt the value.
        latencyMs: r.latencyMs ?? null, ttftMs: r.ttftMs ?? null,
        httpStatus: r.httpStatus ?? null, statusClass: r.statusClass ?? "",
        combo: r.combo ?? null,
        // M6 §3: 19 → 21 fields. reqId/upstreamId ride every transfer path for
        // the same reason the five above were added — a restore that dropped
        // them would silently sever the usage ledger from the log ledger's
        // voyage view, and no sweep covers usageHistory. `?? null` is honest:
        // an artifact exported before the stamp carries no key, and one must
        // never be invented at either end.
        reqId: r.reqId ?? null, upstreamId: r.upstreamId ?? null,
      })),
      usageDaily: db.all(`SELECT * FROM usageDaily ORDER BY dateKey ASC`).map((r) => ({ dateKey: r.dateKey, data: parseJson(r.data, {}) })),
      // S3 — backupLedger + outbox EXCLUDED BY NAME (EXPORT_EXCLUDED_TABLES).
    };

    if (includeRequestDetails) {
      tables.requestDetails = db.all(`SELECT * FROM requestDetails ORDER BY timestamp DESC`).map((r) => ({
        id: r.id, timestamp: r.timestamp, provider: r.provider, model: r.model,
        connectionId: r.connectionId, status: r.status, data: parseJson(r.data, {}),
        // v0.9.44 (milestone 0.6, LIVE-D): 7 → 8 fields. Migration 015 added
        // `combo` to TABLES.requestDetails ("kept in parity with
        // usageHistory.combo so both ledgers tell the same story") and to the
        // LIVE writer (requestDetailsRepo.js:65, which inserts 8 columns and
        // even updates combo in its ON CONFLICT clause) — but this export
        // emitted 7 and the restore INSERT below took 7, so combo was dropped on
        // the way out AND on the way back in. Same negligence class as LIVE-C,
        // from the same migration, in the adjacent table.
        //
        // Found while checking a DIFFERENT claim — which is the argument for
        // tracing paths rather than accepting summaries: no research stream
        // reported this one.
        combo: r.combo ?? null,
      }));
    }
  });

  const kvScopes = {};
  db.transaction(() => {
    for (const row of db.all(`SELECT DISTINCT scope FROM kv ORDER BY scope ASC`)) {
      const scope = row.scope;
      // A provider crop filters ONLY the provider-keyed scopes; every other
      // scope (aliases, customModels, injectors, …) rides untouched.
      if (providerIds && PROVIDER_SCOPED_FIELDS.includes(scope)) {
        const entries = {};
        for (const r of db.all(`SELECT key, value FROM kv WHERE scope = ? ORDER BY key ASC`, [scope])) {
          if (providerIds.has(r.key)) entries[r.key] = parseJson(r.value, null);
        }
        kvScopes[scope] = entries;
        continue;
      }
      const entries = {};
      for (const r of db.all(`SELECT key, value FROM kv WHERE scope = ? ORDER BY key ASC`, [scope])) {
        entries[r.key] = parseJson(r.value, null);
      }
      kvScopes[scope] = entries;
    }
  });

  const payload = {
    settings,
    ...tables,
    kvScopes,
    modelAliases: kvScopes.modelAliases || {},
    customModels: Object.values(kvScopes.customModels || {}),
    mitmAlias: kvScopes.mitmAlias || {},
    pricing: kvScopes.pricing || {},
    pricingSync: kvScopes.pricing_sync || {},
    disabledModels: kvScopes.disabledModels || {},
    _meta: {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      sourceDriver: db.driver,
      sourceMode: getDbMode(),
    },
  };

  // The full export returns the payload EXACTLY as before — same keys, same
  // _meta shape (no `scope`, no `injections`). A scope is the only thing that
  // ever adds or removes a key.
  if (!normalized) return payload;

  // The declared scope rides _meta (provenance); the artifact's manifest copies
  // it so a RESTORE declares exactly the sections it replaces.
  payload._meta.scope = { sections: scopedSections, providers: normalized.providers ?? null };
  // The injection list becomes a first-class field: it lives inside
  // settings.userInjectors, and a file carrying it must declare — and restore —
  // it on its own.
  // The injector list's TRUE home is the kv scope 'userInjectors' — the
  // settings document never carried it (exportSettings() redacts injectors at
  // the source). Read it from kvScopes and carry it as the top-level field a
  // scoped file declares, so a list-only artifact restores on its own.
  if (inScope("injections")) {
    const injFromKv = payload.kvScopes?.userInjectors;
    const injList = injFromKv && typeof injFromKv === "object" ? Object.values(injFromKv) : null;
    if (Array.isArray(fullSettings?.userInjectors)) {
      payload.injections = fullSettings.userInjectors;
    } else if (injList) {
      payload.injections = injList;
    }
  }
  // Sections the file does not carry are ABSENT — never an empty stand-in that
  // would read as "this section was empty" when the truth is "not asked for".
  if (!inScope("proxyPools")) delete payload.proxyPools;
  if (!inScope("keys")) delete payload.apiKeys;
  if (!inScope("combos")) delete payload.combos;
  if (!inScope("providers")) {
    delete payload.providerConnections;
    delete payload.providerNodes;
  }
  // The observability ledgers are not a scope section of their own: a crop
  // carries none of them (a scoped backup is configuration cargo by design).
  payload.usageHistory = [];
  payload.usageDaily = [];
  return payload;
}

// ─── importDb — S1 trust crossing ────────────────────────────────────────
// adoptSecrets  — restore the payload's RESTORE-QUARANTINED settings + key
//                 identity (hostile-input restore; requires re-confirm).
// adoptKeys     — Wave C4 mirror full-resync: adopt the payload's KEY identity
//                 (keyHash/isInternal/deletedAt) while settings still ride the
//                 safe quarantine path. A primary→twin resync is the primary's
//                 own truth flowing to its replica — NOT hostile input — so key
//                 identity must land verbatim or key-gated traffic breaks. The
//                 twin's mirror-minted rows use `mirror:${keyHash}` ids, so the
//                 by-id quarantine re-stitch would otherwise null the keyHash.
// scope — the scoped restore. A scoped artifact (.velabak) carries its scope in
// the payload's _meta (the manifest mirrors it); the engine passes it HERE so
// the restore replaces EXACTLY the declared sections and leaves every other
// row untouched. When the caller ALSO names a scope, the two must AGREE
// (sameScope) — a full file blessed by a scoped request, or the reverse, is a
// refusal, never a guess. A full payload with no scope is the historical whole
// restore, byte-identical.
//
// A scope with an explicit provider list is ROW-GRANULAR: it never wipes a
// touched table. Directly-scoped fields mutate only rows whose provider is in
// the list; fields that reference providers only by a column (usageHistory,
// requestDetails) are NOT deleted (no cross-reference collateral — the restore
// adds nothing it did not declare and removes nothing it did not name).
export async function importDb(payload, { adoptSecrets = false, adoptKeys = false, sections = null, dryRun = false, scope: requestedScope = null } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Invalid database payload");
  }
  const serialized = JSON.stringify(payload);
  if (serialized.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`[backup] payload exceeds the ${MAX_PAYLOAD_BYTES}-byte restore bound (S1)`);
  }
  const TABLE_FIELDS = [
    "providerConnections", "providerNodes", "proxyPools", "apiKeys",
    "combos", "usageHistory", "usageDaily", "requestDetails",
  ];
  for (const f of TABLE_FIELDS) {
    if (payload[f] !== undefined && !Array.isArray(payload[f])) {
      throw new Error(`[backup] payload field "${f}" must be an array (S1 shape bound)`);
    }
  }
  if (payload.settings !== undefined && (typeof payload.settings !== "object" || Array.isArray(payload.settings))) {
    throw new Error("[backup] payload field \"settings\" must be an object (S1 shape bound)");
  }
  // Selective restore (the sections law, backupSecurity.js): `sections` names
  // the ONLY partitions this restore touches. When null — no selection, or all
  // seven named — every guard below falls through open and the wipe is the
  // historical whole-restore: byte-identical behaviour for the backup engine,
  // the mirror resync, and every caller that has never heard of sections.
  // A selected section still refuses to move when the file carries nothing for
  // it: an empty selection must read as a mistake, not as success.
  const selected = normalizeImportSections(sections);
  const wantSections = (section) => !selected || selected.includes(section);
  // The scope narrows the same law. Its DECLARED crop rides in _meta.scope;
  // a caller-named crop must match it.
  const payloadScope = normalizeBackupScope(payload._meta?.scope ?? null);
  const callerScope = normalizeBackupScope(requestedScope);
  if (payloadScope && callerScope && !sameScope(payloadScope, callerScope)) {
    throw new Error("[backup] scope mismatch — the artifact declares a different scope than the restore requested");
  }
  const restoreScope = payloadScope || callerScope;
  const plan = scopeImportPlan(restoreScope);
  const want = (section) => wantSections(section) && (!plan || plan.want(section));
  const mayDelete = (section) => !plan || plan.mayDelete(section);
  if (selected) {
    const carried = [];
    for (const f of TABLE_FIELDS) {
      if (Array.isArray(payload[f]) && payload[f].length > 0 && want(sectionOfField(f))) carried.push(f);
    }
    if (payload.settings !== undefined && payload.settings !== null && want("settings")) carried.push("settings");
    const hasKv = want("kv") && (
      (payload.kvScopes && typeof payload.kvScopes === "object" && Object.keys(payload.kvScopes).length > 0) ||
      ["modelAliases", "customModels", "mitmAlias", "pricing", "pricingSync", "disabledModels"].some(
        (f) => payload[f] && typeof payload[f] === "object" && Object.keys(payload[f]).length > 0
      )
    );
    if (hasKv) carried.push("kv");
    if (carried.length === 0) {
      throw new Error("No selected sections are present in this backup file — nothing would change");
    }
  }
  // The plan a dry run answers. Built BEFORE any adapter is touched: analysis
  // only — no connection, no transaction, no wipe, no writes.
  if (dryRun) {
    const countFor = (section) => {
      const fields = IMPORT_SECTION_FIELDS[section] || [];
      let count = 0;
      for (const f of fields) {
        const v = payload[f];
        if (Array.isArray(v)) count += v.length;
        else if (v && typeof v === "object") count += Object.keys(v).length;
      }
      return count;
    };
    const plan = (selected || [...IMPORT_SECTIONS]).map((section) => ({
      section,
      items: countFor(section),
      inFile: countFor(section) > 0,
    }));
    return { dryRun: true, plan, _meta: payload._meta ?? null };
  }
  const db = await getAdapter();

  let currentQuarantined = { settings: {}, keys: new Map() };
  if (!adoptSecrets) {
    const curSettings = db.get(`SELECT data FROM settings WHERE id = 1`);
    const curSettingsObj = curSettings ? parseJson(curSettings.data, {}) : {};
    for (const k of RESTORE_QUARANTINED_SETTING_KEYS) {
      if (k in curSettingsObj) currentQuarantined.settings[k] = curSettingsObj[k];
    }
    for (const r of db.all(`SELECT id, keyHash, isInternal, deletedAt FROM apiKeys`)) {
      currentQuarantined.keys.set(r.id, {
        keyHash: r.keyHash ?? null,
        isInternal: r.isInternal === 1 || r.isInternal === true,
        deletedAt: r.deletedAt ?? null,
      });
    }
  }

  const settingsToRestore = adoptSecrets
    ? payload.settings
    : quarantineSettingsPayload(payload.settings);
  const keysToRestore = (payload.apiKeys || []).map((k) =>
    adoptSecrets || adoptKeys ? k : quarantineKeyRow(k)
  );

  // The counters the route's per-section verdict reads: which sections this
  // restore actually touched, and how many payload items each carried. A whole
  // restore reports all seven — same writes as before, richer report only.
  const appliedSections = [];
  let appliedRows = 0;
  const countSectionItems = (section) => {
    let count = 0;
    for (const f of IMPORT_SECTION_FIELDS[section] || []) {
      const v = payload[f];
      if (Array.isArray(v)) count += v.length;
      else if (v && typeof v === "object") count += Object.keys(v).length;
    }
    return count;
  };
  const beginSection = (section) => {
    appliedSections.push(section);
    appliedRows += countSectionItems(section);
  };
  // A PROVIDER-SCOPED restore deletes NOTHING here: every touched table is
  // mutated row-by-row below (plan.providerSubset), so a crop can never take a
  // sibling provider's rows, its combos, or its relay keys with it. An
  // injection-scoped restore deletes only that one kv scope.
  const rowGranular = Boolean(plan?.providerSubset);
  const providerFilter = rowGranular ? ` WHERE provider IN (${plan.scope.providers.map(() => "?").join(", ")})` : "";
  const providerArgs = rowGranular ? plan.scope.providers : [];
  db.transaction(() => {
    if (want("settings") && mayDelete("settings") && !rowGranular) {
      db.run(`DELETE FROM settings`);
      beginSection("settings");
    }
    if (want("connections") && !rowGranular) {
      db.run(`DELETE FROM providerConnections`);
      db.run(`DELETE FROM providerNodes`);
      beginSection("connections");
    }
    if (want("pools") && !rowGranular) {
      db.run(`DELETE FROM proxyPools`);
      beginSection("pools");
    }
    if (want("keys") && !rowGranular) {
      db.run(`DELETE FROM apiKeys`);
      beginSection("keys");
    }
    if (want("combos") && !rowGranular) {
      db.run(`DELETE FROM combos`);
      beginSection("combos");
    }
    if (want("kv") && !rowGranular) {
      // The kv section is touched ONLY when this restore carries kv cargo:
      // an explicit injections/settings/keys scope (it declares what replaces
      // the injections list), or a whole file carrying kvScopes/legacy views.
      // A list-only artifact writes its injections above and NOTHING here —
      // a delete with no refill would be the wipe this guard exists to stop.
      const hasKvCargo = payload.kvScopes && typeof payload.kvScopes === "object"
        ? Object.keys(payload.kvScopes).length > 0
        : ["modelAliases", "customModels", "mitmAlias", "pricing", "pricingSync", "disabledModels"]
            .some((f) => payload[f] && typeof payload[f] === "object" && Object.keys(payload[f]).length > 0);
      const declaredKv = (plan?.scope.sections || []).some((s) => ["injections", "settings", "keys"].includes(s));
      if (!plan || declaredKv || hasKvCargo) {
        // A scope whose ONLY kv cargo is the injection list deletes exactly
        // that scope; a whole kv restore keeps the whole table.
        if (plan && (plan.scope.sections || []).includes("injections") && !(plan.scope.sections || []).includes("settings")) {
          db.run(`DELETE FROM kv WHERE scope = 'userInjectors'`);
        } else {
          db.run(`DELETE FROM kv`);
        }
        beginSection("kv");
      }
    }
    if (want("usage") && !rowGranular) {
      db.run(`DELETE FROM usageHistory`);
      db.run(`DELETE FROM usageDaily`);
      db.run(`DELETE FROM requestDetails`);
      beginSection("usage");
    }

    // Settings is a DOCUMENT: an implicitly-scoped restore (a provider crop's
    // settings references) is never part of the payload's crop — only an
    // explicit settings scope or a full restore replaces it.
    const settingsCarried = (plan ? plan.want("settings") && plan.mayDelete("settings") : true);
    if (settingsToRestore && want("settings") && settingsCarried) {
      const merged = adoptSecrets
        ? settingsToRestore
        : { ...settingsToRestore, ...currentQuarantined.settings };
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(merged)]);
    }

    // The pure provider-subset rule. Delete-and-refill is correct for a whole
    // section; for a crop it is a LIE — refreshing "openai" would delete every
    // anthropic row with it. So a row-granular restore removes only rows whose
    // OWN provider column is in the list, and replaces only such rows. Every
    // reference-carrying field (combos naming other providers, relay keys of
    // other providers) is left standing: the provider id list is the whole
    // truth of the crop, and the crop never reaches past it.
    const providers = rowGranular ? plan.scope.providers : [];
    // The provider column differs by table, and two tables have NONE:
    //   providerConnections → `provider`
    //   providerNodes       → `type` (the schema's own name for it)
    //   combos / apiKeys    → no provider column at all. A combo references
    //     providers through its `models` JSON list, so the export already
    //     carries only combos naming a scoped provider — the crop DELETES
    //     exactly the payload's own combo ids, never a column. apiKeys is
    //     handled below through its bound connection ids.
    const providerCol = (table) => (table === "providerNodes" ? "type" : "provider");
    const providerRowDelete = (table) =>
      db.run(`DELETE FROM ${table} WHERE ${providerCol(table)} IN (${providers.map(() => "?").join(", ")})`, providers);
    if (rowGranular) {
      providerRowDelete("providerConnections");
      providerRowDelete("providerNodes");
      beginSection("connections");
      if (want("combos")) {
        const comboIds = (payload.combos || []).map((c) => c.id).filter(Boolean);
        if (comboIds.length) {
          db.run(`DELETE FROM combos WHERE id IN (${comboIds.map(() => "?").join(", ")})`, comboIds);
        }
        beginSection("combos");
      }
      if (want("keys")) {
        // apiKeys carries NO provider column — a key is bound to a connection,
        // and its id IS where the bound provider's id rides (a key minted
        // against connection C belongs to C.provider). So: the scoped
        // providers' connection ids bound the key crop, and nothing else.
        const ids = (payload.providerConnections || []).map((c) => c.id).filter(Boolean);
        if (ids.length) {
          db.run(`DELETE FROM apiKeys WHERE id IN (${ids.map(() => "?").join(", ")})`, ids);
        }
        beginSection("keys");
      }
    }
    if (want("connections")) for (const c of payload.providerConnections || []) {
      const {
        id, provider, authType, name, email, priority, isActive, createdAt, updatedAt,
        secretWrappedDEK, secretCiphertext, tokenWrappedDEK, tokenCiphertext,
        refreshWrappedDEK, refreshCiphertext, ...rest
      } = c;
      db.run(
        `INSERT OR REPLACE INTO providerConnections(
          id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt,
          secretWrappedDEK, secretCiphertext, tokenWrappedDEK, tokenCiphertext,
          refreshWrappedDEK, refreshCiphertext
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, provider, authType || "oauth", name || null, email || null, priority || null,
          isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString(),
          secretWrappedDEK || "", secretCiphertext || "", tokenWrappedDEK || "", tokenCiphertext || "",
          refreshWrappedDEK || "", refreshCiphertext || "",
        ]
      );
    }
    if (want("connections")) for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    if (want("pools")) for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    if (want("kv") && plan) {
      // Injection cargo — the kv scope 'userInjectors'. The scope section
      // `injections` maps to the IMPORT section `kv` (IMPORT_SECTION_FOR_SCOPE),
      // so the plan-side gate asks `want("kv")`: a list-only artifact declares
      // sections:["injections"] and carries no key cargo at all. A user
      // injector is not a credential (validateUserInjectors judges it; the
      // restore carries it verbatim).
      const list = Array.isArray(payload.injections)
        ? payload.injections
        : (payload.kvScopes?.userInjectors ? Object.values(payload.kvScopes.userInjectors) : null);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('userInjectors', ?, ?)`, [String(i), stringifyJson(list[i])]);
        }
        beginSection("kv");
      }
    }
    if (want("keys")) for (const k of keysToRestore) {
      const cur = adoptSecrets || adoptKeys ? null : currentQuarantined.keys.get(k.id);
      const keyHash = adoptSecrets || adoptKeys ? (k.keyHash ?? null) : (cur?.keyHash ?? null);
      const isInternal = adoptSecrets || adoptKeys ? (k.isInternal === true || k.isInternal === 1) : (cur?.isInternal ?? false);
      const deletedAt = adoptSecrets || adoptKeys ? (k.deletedAt ?? null) : (cur?.deletedAt ?? null);
      db.run(
        `INSERT OR REPLACE INTO apiKeys(
          id, key, name, machineId, isActive, createdAt,
          keyVersion, keyHash, keyPrefix, description, allowedModels, isInternal, deletedAt,
          expiresAt, lastUsedAt, rotatedFrom, rotationPrevHash, rotationPrevKeyId, rotationGraceUntil,
          tokenBudgetDaily, spendCapDailyCents, budgetScope, rateLimitRpm, ipAllowlist, category
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          k.id, k.key || `restored-${k.id}`, k.name || null, k.machineId || null,
          k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString(),
          k.keyVersion ?? null, keyHash, k.keyPrefix ?? null,
          k.description ?? null, k.allowedModels ?? null,
          isInternal ? 1 : 0, deletedAt,
          k.expiresAt ?? null, k.lastUsedAt ?? null,
          k.rotatedFrom ?? null, k.rotationPrevHash ?? null, k.rotationPrevKeyId ?? null, k.rotationGraceUntil ?? null,
          k.tokenBudgetDaily ?? null, k.spendCapDailyCents ?? null, k.budgetScope ?? null,
          k.rateLimitRpm ?? null, k.ipAllowlist ?? null, k.category ?? null,
        ]
      );
    }
    if (want("keys")) tombstoneLegacyKeys(db);
    if (want("combos")) for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }

    const kvRows = [];
    // An injection-scoped artifact may carry the list as `injections` (the
    // export's first-class field) with no kvScopes at all. It is written above.
    const injectionOnly = plan && !plan.scope.sections.some((s) => s !== "injections");
    if (injectionOnly) {
      // nothing more to write into kv
    } else if (payload.kvScopes && typeof payload.kvScopes === "object") {
      for (const [scope, entries] of Object.entries(payload.kvScopes)) {
        if (!entries || typeof entries !== "object") continue;
        for (const [key, value] of Object.entries(entries)) kvRows.push([scope, key, value]);
      }
    } else {
      for (const [a, m] of Object.entries(payload.modelAliases || {})) kvRows.push(["modelAliases", a, m]);
      for (const m of payload.customModels || []) {
        kvRows.push(["customModels", `${m.providerAlias}|${m.id}|${m.type || "llm"}`, m]);
      }
      for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) kvRows.push(["mitmAlias", tool, mappings]);
      for (const [provider, models] of Object.entries(payload.pricing || {})) kvRows.push(["pricing", provider, models]);
      for (const [provider, models] of Object.entries(payload.pricingSync || {})) kvRows.push(["pricing_sync", provider, models]);
      for (const [providerAlias, models] of Object.entries(payload.disabledModels || {})) kvRows.push(["disabledModels", providerAlias, models]);
    }
    if (want("kv")) {
      // A provider crop filters provider-keyed kv ROWS too — only rows whose
      // scope key is a scoped provider id are touched; no cross-ref collateral.
      const filtered = rowGranular
        ? kvRows.filter(([scope, key]) => !PROVIDER_SCOPED_FIELDS.includes(scope) || plan.scope.providers.includes(key))
        : kvRows;
      for (const [scope, key, value] of filtered) {
        db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES(?, ?, ?)`, [scope, key, stringifyJson(value)]);
      }
    }

    if (want("usage")) for (const h of payload.usageHistory || []) {
      // v0.9.44 (milestone 0.6, LIVE-C): 15 → 20 bound columns, matching the
      // export above. Without these the RESTORE silently dropped the Observatory
      // telemetry and combo attribution even from an artifact that carried them
      // — so the loss was not twin-only. `apiKey` stays a literal NULL in the
      // VALUES list (the plaintext column is banned from artifacts by law),
      // which is why the column count (20) exceeds the placeholder count (19).
      //
      // Coalescing rules, both load-bearing:
      //   statusClass → '' (migration 008:91's sealed invariant; idx_uh_ts_status
      //   aggregates on it, and NULL would make "unknown" invisible to the index)
      //   latencyMs/ttftMs/httpStatus → NULL, never 0 (NULL = unmeasured)
      //
      // An OLD artifact (exported before this fix) simply has no such keys, so
      // every `?? ` falls through to the documented default — the restore stays
      // backward-compatible with artifacts written by v0.9.43 and earlier.
      db.run(
        `INSERT OR REPLACE INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta, latencyMs, ttftMs, httpStatus, statusClass, combo, reqId, upstreamId) VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [h.id, h.timestamp, h.provider || "", h.model || "", h.connectionId || "", h.keyId || "", h.keyPrefix ?? null, h.endpoint ?? null, h.promptTokens ?? 0, h.completionTokens ?? 0, h.cost ?? 0, h.status ?? null, stringifyJson(h.tokens ?? null), stringifyJson(h.meta ?? null), h.latencyMs ?? null, h.ttftMs ?? null, h.httpStatus ?? null, h.statusClass ?? "", h.combo ?? null, h.reqId ?? null, h.upstreamId ?? null]
      );
    }
    if (want("usage")) for (const d of payload.usageDaily || []) {
      db.run(`INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`, [d.dateKey, stringifyJson(d.data ?? {})]);
    }
    if (want("usage") && Array.isArray(payload.requestDetails)) {
      for (const rd of payload.requestDetails) {
        // v0.9.44 (milestone 0.6, LIVE-D): 7 → 8 columns, matching the export
        // above. `combo` is NULL for a direct (non-combo) request per migration
        // 015, so `?? null` is the honest default and an older artifact with no
        // `combo` key restores exactly as it did before.
        db.run(
          `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data, combo) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
          [rd.id, rd.timestamp, rd.provider ?? null, rd.model ?? null, rd.connectionId ?? null, rd.status ?? null, stringifyJson(rd.data ?? {}), rd.combo ?? null]
        );
      }
    }
  });

  // The selective report: which sections this restore actually touched and
  // how many payload items each carried, riding ahead of the whole-database
  // read-back. The export stays whole — it is the read, not the write, and
  // its shape is pinned by the A3 completeness suite.
  return {
    appliedSections,
    appliedRows,
    // The scope this restore honoured (null ⇒ full restore). A scoped artifact
    // restores EXACTLY its declared sections — this field is the receipt.
    scope: restoreScope ? { sections: [...(restoreScope.sections || [])], providers: restoreScope.providers ?? null } : null,
    ...(await exportDb({ includeRequestDetails: Array.isArray(payload.requestDetails) })),
  };
}

/**
 * The HTTP export door's entry (GET /api/settings/database ?scope=): a full
 * export is unchanged; a SCOPED one is returned as an artifact-ready object
 * declared by its manifest — { velaBackup: true, format, artifactId, manifest,
 * payload }. `persistDefault` marks an unscoped request as the operator's
 * default crop (recorded in the manifest so a plain download prefers the
 * default sections over the whole harbour).
 */
export async function exportBackup({ scope = null, persistDefault = false, redact = true } = {}) {
  const normalized = normalizeBackupScope(scope);
  let manifestScope = normalized;
  if (!normalized && persistDefault) {
    const { getSettings } = await import("../settingsRepo.js");
    const settings = await getSettings();
    const saved = normalizeBackupScope(settings?.backupDefaultScope ?? null);
    if (saved) manifestScope = { ...saved, default: true };
  }
  const payload = await exportDb({ redact, scope: manifestScope });
  const sectionIds = sectionIdsForScope(manifestScope);
  const present = Object.keys(payload).filter(
    (k) => !k.startsWith("_") && k !== "settings" && Array.isArray(payload[k]) && payload[k].length > 0
  );
  const manifest = {
    format: "vela-backup",
    version: payload._meta?.schemaVersion ?? null,
    date: payload._meta?.exportedAt ?? null,
    // null ⇒ a full backup (declares no crop). Otherwise the section ids the
    // crop declared + the explicit provider list (null = the whole section).
    scope: manifestScope
      ? { sections: sectionIds || [], providers: manifestScope.providers ?? null, ...(manifestScope.default ? { default: true } : {}) }
      : null,
    sections: manifestScope ? (sectionIds || []) : [...IMPORT_SECTIONS],
    present,
    providers: manifestScope?.providers ?? null,
    complete: !manifestScope || Boolean(manifestScope.default),
  };
  return {
    velaBackup: true,
    format: "vela-backup",
    artifactId: `vela-export-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`,
    manifest,
    payload,
  };
}

export async function initDb() {
  await getAdapter();
  // F-5 — seal credentials left plaintext by a pre-vault install. Fail-safe:
  // a row that cannot be sealed keeps working in plaintext, and the gateway
  // still boots. No key configured = no work and no statement issued.
  try {
    const { getVault } = await import("../../../vault.js");
    if (getVault().enabled) {
      const { migratePlaintextCredentials } = await import("./vaultRepo.js");
      const result = await migratePlaintextCredentials();
      if (result.error) {
        log.warn("DB", `[vault] plaintext credential migration skipped: ${result.error}`);
      } else if (result.sealed > 0 || result.skipped.length > 0) {
        log.info(
          "DB",
          `credential migration complete — sealed ${result.sealed}` +
          (result.backup ? `, backup ${result.backup}` : "") +
          (result.skipped.length ? `, skipped ${result.skipped.length}` : "")
        );
      }
    }
  } catch (e) {
    log.warn("DB", `[vault] plaintext credential migration skipped: ${e.message}`);
  }
}

// ─── Storage footprint (the Data cockpit, v0.9.95) ───────────────────────
// What this instance actually occupies, per table, plus the DB file size and
// the usage retention posture. Counts are exact (COUNT(*) per table, never a
// sqlite_stat1 estimate — an estimate is a guess wearing a number's clothes).
// The DB file size is the on-disk truth; WAL/SHM ride alongside because a
// busy harbor keeps them.
export async function getStorageInventory({ retentionDays } = {}) {
  const db = await getAdapter();
  const tables = [];
  for (const name of Object.keys(TABLES)) {
    try {
      const row = db.get(`SELECT COUNT(*) AS n FROM ${name}`);
      tables.push({ name, rows: Number(row?.n ?? 0) });
    } catch {
      // A table the schema declares but this DB has not migrated yet is a real
      // state during an upgrade — report it, never crash the census.
      tables.push({ name, rows: null });
    }
  }
  const bytes = (p) => {
    try {
      return fs.statSync(p).size;
    } catch {
      return null;
    }
  };
  const days = Number(retentionDays ?? process.env.VELA_USAGE_RETENTION_DAYS ?? 90);
  const retention = Number.isFinite(days) && days > 0 ? days : 0;
  let usageRows = null;
  let cutoffRows = null;
  if (retention > 0) {
    const cutoff = new Date(Date.now() - retention * 86400000).toISOString();
    usageRows = Number(db.get(`SELECT COUNT(*) AS n FROM usageHistory`)?.n ?? 0);
    cutoffRows = Number(db.get(`SELECT COUNT(*) AS n FROM usageHistory WHERE timestamp < ?`, [cutoff])?.n ?? 0);
  }
  return {
    driver: db.driver ?? "sqlite",
    mode: getDbMode(),
    schemaVersion: SCHEMA_VERSION,
    tables,
    totalRows: tables.reduce((sum, t) => sum + (t.rows ?? 0), 0),
    dbFileBytes: bytes(DATA_FILE),
    walBytes: bytes(`${DATA_FILE}-wal`),
    shmBytes: bytes(`${DATA_FILE}-shm`),
    retention: { days: retention, usageRows, purgeableRows: cutoffRows },
  };
}

export async function writeLedger(kind, fields = {}) {
  try {
    const db = await getAdapter();
    db.run(
      `INSERT INTO backupLedger(id, createdAt, kind, status, artifactId, sizeBytes, schemaVersion, sourceMode, targetMode, error, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        new Date().toISOString(),
        kind,
        fields.status || "ok",
        fields.artifactId ?? null,
        fields.sizeBytes ?? null,
        fields.schemaVersion ?? null,
        fields.sourceMode ?? null,
        fields.targetMode ?? null,
        fields.error ? String(fields.error).slice(0, 500) : null,
        stringifyJson(fields.meta ?? null),
      ]
    );
  } catch (err) {
    log.warn("DB", "[backup] ledger write failed (fail-open):", err?.message);
  }
}

export async function listBackupLedger({ limit = 50, offset = 0 } = {}) {
  const db = await getAdapter();
  const lim = Math.max(1, Math.min(Number(limit) || 50, 200));
  const off = Math.max(0, Number(offset) || 0);
  return db
    .all(`SELECT * FROM backupLedger ORDER BY createdAt DESC, id LIMIT ? OFFSET ?`, [lim, off])
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      kind: r.kind,
      status: r.status,
      artifactId: r.artifactId ?? null,
      sizeBytes: r.sizeBytes ?? null,
      schemaVersion: r.schemaVersion ?? null,
      sourceMode: r.sourceMode ?? null,
      targetMode: r.targetMode ?? null,
      meta: parseJson(r.meta, null),
      // S4 — error omitted from every ledger surface.
    }));
}

export async function purgeOldUsage({ retentionDays = Number(process.env.VELA_USAGE_RETENTION_DAYS ?? 90) } = {}) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return { purged: false, usageHistory: 0, requestDetails: 0 };
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const db = await getAdapter();
  const BATCH = 5000;
  let usageRemoved = 0;
  let detailsRemoved = 0;
  for (;;) {
    const r = db.run(`DELETE FROM usageHistory WHERE id IN (SELECT id FROM usageHistory WHERE timestamp < ? LIMIT ?)`, [cutoff, BATCH]);
    const n = r.changes ?? 0;
    usageRemoved += n;
    if (n < BATCH) break;
  }
  for (;;) {
    const r = db.run(`DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails WHERE timestamp < ? LIMIT ?)`, [cutoff, BATCH]);
    const n = r.changes ?? 0;
    detailsRemoved += n;
    if (n < BATCH) break;
  }
  // W2a (plan R4) — the telemetry seams age on the SAME schedule as the rows
  // they describe. A table that does not exist yet (pre-030) is nothing to purge.
  let telemetryRemoved = 0;
  for (const table of ["proxyPoolHealthHistory", "proxyPoolEgressHistory"]) {
    try {
      const r = db.run(`DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE createdAt < ? LIMIT ?)`, [cutoff, BATCH]);
      telemetryRemoved += r?.changes ?? 0;
    } catch { /* table absent on a pre-030 harbor */ }
  }
  await writeLedger("purge", {
    meta: { retentionDays: days, cutoff, usageHistory: usageRemoved, requestDetails: detailsRemoved, telemetry: telemetryRemoved },
  });
  return { purged: true, usageHistory: usageRemoved, requestDetails: detailsRemoved };
}
