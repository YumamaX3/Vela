// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs, getKeyUsageStats,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
  getProviderHealthFrame, // Usage Observatory W1-D — raw health scanner
  getPerProviderFrame,    // W1-D — the ≤30s memoized frame the SSE route imports
  // Usage Observatory W2-B — the Metrics REST API layer
  getFilteredSeries, getBreakdown, getStackedSeries, getPercentiles,
  getKpis, getInsights, getLedgerRows, getExportCursor,
  getHealthTimeline, // Usage Observatory W4-D — provider health timeline strips
  // v0.9.40 — per-combo attribution aggregation (migration 015)
  getComboUsage,
} from "@/lib/db/index.js";
