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
  "getProviderHealthFrame", "getKpis", "getInsights", "getLedgerRows", "getExportCursor",
  // W4-C request tags — the ledger annotation layer (migration 010)
  "getTagsForUsageIds", "getUsageTags", "setUsageTags",
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
};

/** The full set of classified symbols — the census compares the barrel to this. */
export function allClassified() {
  return new Set([
    ...PARITY_REGISTRY,
    ...Object.keys(EXEMPT_PROCESS),
    ...Object.keys(EXEMPT_PENDING),
  ]);
}
