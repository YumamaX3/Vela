// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
// Kept for backward compatibility with existing imports.
export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl,
  getProviderConnections, getProviderConnectionById,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
  getApiKeys, getApiKeyById, createApiKey, updateApiKey, deleteApiKey, validateApiKey, resolveKey, KeyLimitsValidationError, sanitizeCategory,
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
  getModelAliases, setModelAlias, deleteModelAlias,
  getCustomModels, addCustomModel, deleteCustomModel,
  getMitmAlias, setMitmAliasAll,
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
  replaceSyncedPricing, clearSyncedPricing, getSyncedPricing,
  exportDb, importDb,
  // Usage (from db/index.js — the Twin Harbors seam)
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs, getKeyUsageStats,
  getProviderHealthFrame, getPerProviderFrame,
  getFilteredSeries, getBreakdown, getStackedSeries,
  getPercentiles, getKpis, getInsights, getHealthTimeline,
  getLedgerRows, getExportCursor,
  getTagsForUsageIds, getUsageTags, setUsageTags,
  // Request details
  saveRequestDetail, getRequestDetails, getRequestDetailById, getDistinctProviders,
  // Disabled models
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "@/lib/db/index.js";
