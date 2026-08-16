// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs, getKeyUsageStats,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
  getProviderHealthFrame, // Usage Observatory W1-D — SSE perProvider frame
} from "@/lib/db/index.js";
