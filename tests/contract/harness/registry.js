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

/** Parity coverage scheduled in a later Wave A commit. */
export const EXEMPT_PENDING = {
  // Config wave (A7)
  getSettings: "A7",
  exportSettings: "A7",
  isCloudEnabled: "A7",
  getCloudUrl: "A7",
  getProviderConnections: "A7",
  getProviderConnectionById: "A7",
  updateProviderConnection: "A7",
  deleteProviderConnection: "A7",
  deleteProviderConnectionsByProvider: "A7",
  reorderProviderConnections: "A7",
  cleanupProviderConnections: "A7",
  getProviderNodes: "A7",
  getProviderNodeById: "A7",
  updateProviderNode: "A7",
  deleteProviderNode: "A7",
  getProxyPools: "A7",
  getProxyPoolById: "A7",
  updateProxyPool: "A7",
  deleteProxyPool: "A7",
  getCombos: "A7",
  getComboById: "A7",
  getComboByName: "A7",
  updateCombo: "A7",
  deleteCombo: "A7",
  getModelAliases: "A7",
  deleteModelAlias: "A7",
  getCustomModels: "A7",
  deleteCustomModel: "A7",
  getMitmAlias: "A7",
  setMitmAliasAll: "A7",
  // Security wave (A8)
  getApiKeys: "A8",
  getApiKeyById: "A8",
  updateApiKey: "A8",
  deleteApiKey: "A8",
  validateApiKey: "A8",
  getDisabledModels: "A8",
  getDisabledByProvider: "A8",
  enableModels: "A8",
  getPricing: "A8",
  getPricingForModel: "A8",
  resetPricing: "A8",
  resetAllPricing: "A8",
  replaceSyncedPricing: "A8",
  clearSyncedPricing: "A8",
  getSyncedPricing: "A8",
  saveRequestDetail: "A8",
  getRequestDetails: "A8",
  getRequestDetailById: "A8",
  getDistinctProviders: "A8",
  // Usage wave (A9)
  saveRequestUsage: "A9 — cost lookup + wall-clock; needs faked timers",
  getUsageHistory: "A9",
  getKeyUsageStats: "A9",
};

/** The full set of classified symbols — the census compares the barrel to this. */
export function allClassified() {
  return new Set([
    ...PARITY_REGISTRY,
    ...Object.keys(EXEMPT_PROCESS),
    ...Object.keys(EXEMPT_PENDING),
  ]);
}
