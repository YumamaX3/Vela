// Storage Covenant Wave A4 — the parity-harness registries.
// Plan: plans/storage-covenant.md A4 + Testability fix line 427 (auto-census pin).
//
// Every exported symbol of the public barrel (src/lib/db/index.js) MUST appear
// in exactly one registry. The contract-census test enforces this mechanically —
// the only guard against silent coverage erosion under the 1.8× parity tax.
//
// Two exempt classes (plan line 240 "no coverage theater"):
//   EXEMPT_PROCESS — never parity-testable: event emitters, in-memory gauges,
//     ring buffers, the sync hot path, pure helpers, class exports. Named with
//     a reason. These stay exempt forever.
//   EXEMPT_PENDING — parity coverage is SCHEDULED in a later Wave A commit and
//     named here. A future wave moves each into PARITY_REGISTRY; the census
//     makes the debt visible until it is paid.

/** Symbols whose behavior the parity shakeout actually exercises. */
export const PARITY_REGISTRY = new Set([
  // Writers exercised by the shakeout scenario (state verified via exportDb)
  "updateSettings",
  "createProviderConnection",
  "createProviderNode",
  "createProxyPool",
  "createApiKey",
  "createCombo",
  "setModelAlias",
  "addCustomModel",
  "disableModels",
  "updatePricing",
  // The round-trip legs
  "exportDb",
  "importDb",
  // Wave B2 — the backup ledger repo (parity-backup.test.js exercises the
  // round-trip: backup row written in the live DB, read back, metadata-only).
  "writeLedger", "listBackupLedger",
  // ── The paid EXEMPT_PENDING debt — Wave A's seal (A10) ────────────────
  // Every entry migrated from EXEMPT_PENDING once its wave forged the twin
  // and the parity gate turned green. The annotations name the paying wave.
  // Config wave (A7) — parity-config.test.js
  "getSettings", "exportSettings", "isCloudEnabled", "getCloudUrl",
  "getProviderConnections", "getProviderConnectionById", "updateProviderConnection",
  "deleteProviderConnection", "deleteProviderConnectionsByProvider",
  "reorderProviderConnections", "cleanupProviderConnections",
  "getProviderNodes", "getProviderNodeById", "updateProviderNode", "deleteProviderNode",
  "getProxyPools", "getProxyPoolById", "updateProxyPool", "deleteProxyPool",
  "getCombos", "getComboById", "getComboByName", "updateCombo", "deleteCombo",
  "getModelAliases", "deleteModelAlias", "getCustomModels", "deleteCustomModel",
  "getMitmAlias", "setMitmAliasAll",
  // Security wave (A8) — parity-security.test.js
  "getApiKeys", "getApiKeyById", "updateApiKey", "deleteApiKey", "validateApiKey",
  "getDisabledModels", "getDisabledByProvider", "enableModels",
  "getPricing", "getPricingForModel", "resetPricing", "resetAllPricing",
  "replaceSyncedPricing", "clearSyncedPricing", "getSyncedPricing",
  "saveRequestDetail", "getRequestDetails", "getRequestDetailById", "getDistinctProviders",
  // Usage wave (A9) — parity-usage.test.js
  "saveRequestUsage", "getUsageHistory", "getKeyUsageStats",
  // Observatory aggregation layer (W1-C + W2-C, retired by W2-G) —
  // parity-usage.test.js usageScenario runs all eight across BOTH twins
  // (the sqlite harbor + the live MariaDB), the stacked-series fn grafted
  // in at W2-G. Engine-neutral by construction (one shared impl), proven
  // convergent in the real.
  "getFilteredSeries", "getBreakdown", "getStackedSeries", "getPercentiles",
  "getProviderHealthFrame", "getKpis", "getInsights", "getHealthTimeline", "getLedgerRows", "getExportCursor",
  // W4-C request tags — the ledger annotation layer (migration 010)
  "getTagsForUsageIds", "getUsageTags", "setUsageTags",
  // v0.9.40 combo attribution (c356fcdc) — unit-covered only
  // (tests/unit/combo-usage-aggregation.test.js); parity debt, scheduled.
  "getComboUsage",
]);

/** Never parity-testable — process/global state, wall-clock, pure helpers. */
export const EXEMPT_PROCESS = {
  statsEmitter: "EventEmitter process singleton — not data",
  trackPendingRequest: "sync hot path, in-memory gauge; must never gain a promise",
  getActiveRequests: "in-memory gauge only — no persistence to compare",
  appendRequestLog: "in-memory ring buffer write",
  getRecentLogs: "in-memory ring buffer read",
  getUsageStats: "wall-clock windowing + in-memory ring buffer merge",
  getChartData: "wall-clock bucketing",
  initDb: "trivial adapter warm-up — no observable data",
  KeyLimitsValidationError: "class export, not a function",
  sanitizeCategory: "pure string helper — no DB access",
  // Wave B2 backup engine — process/infra surface. runBackup/restoreBackup/
  // runRestoreDrill/pruneBackupArtifacts write ARTIFACT FILES + ledger rows
  // under BACKUPS_DIR (not the DB under parity comparison); purgeOldUsage is
  // wall-clock windowed (fixed-date parity coverage lands with Wave B4's
  // cross-engine restore suite — named here as scheduled debt).
  runBackup: "artifact-file writer + ledger row; engine-process surface",
  restoreBackup: "artifact-file reader + import; engine-process surface",
  runRestoreDrill: "scratch-DB drill — deliberately never touches the parity DB",
  pruneBackupArtifacts: "artifact-file pruning by mtime — no DB data",
  purgeOldUsage: "wall-clock windowed purge — fixed-date parity lands Wave B4",
  getPerProviderFrame: "≤30s server-global memo over getProviderHealthFrame — process state, not data",
  // v0.9.95 Data Cockpit (faa78ddd) + v0.9.81 storage inventory (2bf3c625) —
  // filesystem/adapter process surface extending the B2 artifact family
  // (unit-covered by tests/unit/data-cockpit.test.js).
  getStorageInventory: "BACKUPS_DIR filesystem census — artifact files, not DB rows",
  listBackupArtifacts: "BACKUPS_DIR filesystem listing — artifact files, not DB rows",
  verifyBackupArtifact: "artifact file checksum verification — filesystem surface",
  planPruneArtifacts: "mtime-based artifact pruning plan — filesystem surface",
  // v0.9.81 store adapter (2bf3c625) — handle openers, same class as initDb.
  openStoreAdapter: "adapter handle opener — process surface, no comparable data",
  openStoreAdapterSync: "sync adapter handle opener — process surface",
  // Security & governance repos (migrations 020/021, kv scope
  // "modelDeprecations") — the pure constructors, same class as budgetId.
  deprecationKey: "pure key constructor (provider/model) — no DB access",
};

/** Parity coverage scheduled — the Observatory's aggregation layer (W1-C +
 *  W2-C). Engine-neutral by construction (ONE shared impl, both twins call
 *  the same machinery with dialect fragments only in kpisImpl), so divergence
 *  risk concentrates in the JSON dialect fragments. The parity leg lands with
 *  the Observatory's W2-G seal; named here so the census keeps the debt
 *  visible until it is paid. */
export const EXEMPT_PENDING = {
  // The Observatory's aggregation-layer debt was retired at W2-G (2026-08-16):
  // parity-usage.test.js's usageScenario runs all eight across BOTH twins,
  // and the census pin keeps this ledger empty until new scheduled debt lands.

  // Security & governance surface — the A8 wave bound these in bind.js
  // (SECURITY_WAVE_NAMES) and both harbors carry a complete twin, but every
  // test that exercises them is sqlite-only (tests/unit/guardrails-mirror,
  // guardrails-policy-store, vault, models-routes run the sqlite harbor; the
  // mirror suite proves outbox capture, never convergence). No parity leg
  // runs them across both engines yet, so they hold here — the debt named,
  // not hidden — until a security-governance parity gate pays them.
  // guardrailsRepo (migration 020) — row tables guardrailPolicies/guardrailLogs.
  listGuardrailPolicies: "security-wave row read — sqlite-only unit coverage; parity gate scheduled",
  getGuardrailPolicy: "security-wave row read — sqlite-only unit coverage; parity gate scheduled",
  upsertGuardrailPolicy: "security-wave row upsert — sqlite-only unit coverage; parity gate scheduled",
  deleteGuardrailPolicy: "security-wave row delete — sqlite-only unit coverage; parity gate scheduled",
  insertGuardrailLog: "security-wave audit-log insert — sqlite-only unit coverage; parity gate scheduled",
  listGuardrailLogs: "security-wave audit-log read — sqlite-only unit coverage; parity gate scheduled",
  deleteGuardrailLogs: "security-wave audit-log delete — sqlite-only unit coverage; parity gate scheduled",
  // vaultRepo (migration 021) — seals providerConnections credentials.
  // The migration leg additionally writes a pre-vault artifact file (VACUUM
  // INTO) on the sqlite harbor; the twin seals in place by design.
  getVaultCounts: "seal-state census over providerConnections — sqlite-only unit coverage; parity gate scheduled",
  listConnectionsNeedingSeal: "plaintext-credential scan — sqlite-only unit coverage; parity gate scheduled",
  migratePlaintextCredentials: "credential migration (sqlite backs up via VACUUM INTO, twin seals in place) — parity gate scheduled",
  rewrapConnectionDEKs: "DEK rewrap with master-key custody — sqlite-only unit coverage; parity gate scheduled",
  // deprecationsRepo (kv scope "modelDeprecations") — rides the kv store.
  listModelDeprecations: "kv-scope read — sqlite-only unit coverage; parity gate scheduled",
  getModelDeprecation: "kv-scope read — sqlite-only unit coverage; parity gate scheduled",
  recordModelDeprecation: "kv-scope write — detectedAt wall-clock default (volatile field); parity gate scheduled",
  clearModelDeprecation: "kv-scope delete — sqlite-only unit coverage; parity gate scheduled",
  retainLiveModels: "kv-scope sweep against a live catalogue — the catalogue choice is the caller's, so the harness must fix it; parity gate scheduled",
};

/** The full set of classified symbols — the census compares the barrel to this. */
export function allClassified() {
  return new Set([
    ...PARITY_REGISTRY,
    ...Object.keys(EXEMPT_PROCESS),
    ...Object.keys(EXEMPT_PENDING),
  ]);
}
