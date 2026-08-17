// Public API barrel — all DB functions.
//
// Storage Covenant Wave B1 (plan line 420): this file is now a PURE re-export
// barrel. The last raw-SQL functions (exportDb/importDb/initDb) moved into
// repos/sqlite/backupRepo.js behind the repos/backupRepo.js facade — the
// STAGED_DEBT=1 census debt (Wave A2) is paid. No SQL, no adapter access,
// no persistence statements live here anymore.
//
// Settings
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

// Provider connections
export {
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

// Provider nodes
export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

// Proxy pools
export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

// API keys
export {
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey,
  KeyLimitsValidationError, sanitizeCategory,
} from "./repos/apiKeysRepo.js";

// Combos
export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

// Aliases (model + custom + mitm)
export {
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
} from "./repos/aliasRepo.js";

// Pricing
export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
  replaceSyncedPricing, clearSyncedPricing, getSyncedPricing,
} from "./repos/pricingRepo.js";

// Disabled models
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

// Usage
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs, getKeyUsageStats,
  // Usage Observatory W1-D — the SSE contract reads the per-provider health
  // frame through the facade (twin-parity, posture-consistent). The route
  // consumes getPerProviderFrame (the ≤30s memoized frame), which re-scans
  // via getProviderHealthFrame underneath.
  getProviderHealthFrame,
  getPerProviderFrame,
  // Usage Observatory W2-B — the Metrics REST API consumes the full
  // aggregation layer through the facade. Every name the route layer
  // imports MUST ride this chain (the W1-D lesson: a facade export that
  // stops at the facade is a build-time break waiting to surface).
  getFilteredSeries,
  getBreakdown,
  getStackedSeries, // W2-C — time × dimension, top-N + Other
  getPercentiles,
  getKpis,
  getInsights, // W4-B — the Lookout signal registry
  getLedgerRows,
  getExportCursor,
} from "./repos/usageRepo.js";

// Usage Observatory W4-C — request tags (facade → repos/usageTagsRepo.js).
// The census pin demands every harness-registry name resolve from THIS barrel;
// the PUT tags route imports the facade directly, but the barrel keeps the
// bijection honest.
export { getTagsForUsageIds, getUsageTags, setUsageTags } from "./repos/usageTagsRepo.js";

// Request details
export {
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "./repos/requestDetailsRepo.js";

// Export/import + the backup engine — Wave B1/B2 harbor-home (repos/backupRepo.js facade).
export { exportDb, importDb, initDb } from "./repos/backupRepo.js";
export {
  runBackup, restoreBackup, runRestoreDrill,
  writeLedger, listBackupLedger,
  pruneBackupArtifacts, purgeOldUsage,
} from "./repos/backupRepo.js";
