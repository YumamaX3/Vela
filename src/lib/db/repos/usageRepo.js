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
