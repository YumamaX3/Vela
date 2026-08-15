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
};

/** Parity coverage scheduled in a later Wave A commit — PAID IN FULL at A10.
 *  Every entry migrated into PARITY_REGISTRY with its paying-wave annotation.
 *  The object stays (empty) so the census's three-way classification keeps
 *  its shape; any new pending debt must land here, named with its wave. */
export const EXEMPT_PENDING = {};

/** The full set of classified symbols — the census compares the barrel to this. */
export function allClassified() {
  return new Set([
    ...PARITY_REGISTRY,
    ...Object.keys(EXEMPT_PROCESS),
    ...Object.keys(EXEMPT_PENDING),
  ]);
}
