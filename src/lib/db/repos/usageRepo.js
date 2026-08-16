// Facade — path-stable entry point for the usageRepo contract.
// Storage Covenant A9: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
// Non-function exports (statsEmitter) pass through untouched.
import * as sqlite from "./sqlite/usageRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/usageRepo.js"));

export const statsEmitter = bound.statsEmitter;
export const trackPendingRequest = bound.trackPendingRequest;
export const getActiveRequests = bound.getActiveRequests;
export const saveRequestUsage = bound.saveRequestUsage;
export const getUsageHistory = bound.getUsageHistory;
export const getUsageStats = bound.getUsageStats;
export const getKeyUsageStats = bound.getKeyUsageStats;
export const touchKeyLastUsed = bound.touchKeyLastUsed;
export const getUsageDailySince = bound.getUsageDailySince;
export const getChartData = bound.getChartData;
export const appendRequestLog = bound.appendRequestLog;
export const getRecentLogs = bound.getRecentLogs;
// Usage Observatory W1-C — the 7-function aggregation layer (sealed plan
// item 4). getExportCursor returns the async iterator; under the mysql
// posture the bind wrapper makes it a Promise OF the iterator, so callers
// always `await` first, then `for await` — one contract, both harbors.
export const getFilteredSeries = bound.getFilteredSeries;
export const getBreakdown = bound.getBreakdown;
export const getStackedSeries = bound.getStackedSeries; // W2-C — time × dimension
export const getPercentiles = bound.getPercentiles;
export const getProviderHealthFrame = bound.getProviderHealthFrame;
export const getKpis = bound.getKpis;
export const getLedgerRows = bound.getLedgerRows;
export const getExportCursor = bound.getExportCursor;
export const getPerProviderFrame = bound.getPerProviderFrame; // W1-D memo
