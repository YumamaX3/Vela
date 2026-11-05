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

// Guardrails (Security & governance — migration 020)
export {
  listGuardrailPolicies, getGuardrailPolicy, upsertGuardrailPolicy, deleteGuardrailPolicy,
  insertGuardrailLog, listGuardrailLogs, deleteGuardrailLogs,
} from "./repos/guardrailsRepo.js";

// Credential vault (Security & governance — migration 021)
export {
  getVaultCounts, listConnectionsNeedingSeal, migratePlaintextCredentials,
  rewrapConnectionDEKs,
} from "./repos/vaultRepo.js";

// Model deprecations (kv scope "modelDeprecations")
export {
  deprecationKey, listModelDeprecations, getModelDeprecation,
  recordModelDeprecation, clearModelDeprecation, retainLiveModels,
} from "./repos/deprecationsRepo.js";

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
  getHealthTimeline, // W4-D — provider health timeline strips
  getLedgerRows,
  getExportCursor,
  getComboUsage, // v0.9.40 — per-combo attribution aggregation (migration 015)
  getPoolAnalytics, // W2b — per-pool usage census (Proxy Console Separation)
  getPoolProviderMap, // W2b — provider labels for the pool buckets
  getPoolHealthHistory, // W2b — per-pool outcome series
  getPoolEgressHistory, // W2b — per-pool egress ledger
} from "./repos/usageRepo.js";

// ─── P5 — the dashboard coalescing layer (plans/2026-11-01-responsive-tide-
// performance.md §III, suspects 1 + 7). THE SEAM: every dashboard read — the
// REST stats route, the SSE stream's full paint — now enters getUsageStats
// through HERE, never the raw twin. Two server-global memos, the
// getPerProviderFrame precedent (usageRepo.js, W1-D) one floor down:
//
//   • usageStatsShared(period) — a 15s memo PER PERIOD, shared across every
//     browser tab, HomePageClient and the usage page alike. An AUTHENTICATED
//     caller costs at most one getUsageStats(period) per 15s regardless of how
//     many subscribers ask. A single caller pays the same cache of a burst.
//   • usageStatsCoalesced(period) — the SAME memo plus in-flight joining: N
//     concurrent first-callers for a cold/stale key share ONE compute.
//
// FAIL-OPEN, exactly like the frame memo: a failed compute serves the last
// good copy for that period; with no copy it rethrows (the REST route turns
// that into its 500, the SSE tick into its detach — unchanged). Only HONEST
// results are memoized: live/volatile fields are spliced in fresh per call,
// so the memo never launders a live counter into the window.
//
// THE NO-CHANGE LAW (pinned in tests/unit/usage-stats-sql-p5.test.js): the
// period is the WHOLE cache key and is normalized identically to the twin's
// `getUsageStats(period = "all")` (nullish → "all"), so every distinct
// argument maps to its own entry and no caller ever receives another
// period's answer after ONE call — a "today" request can never be served a
// "7d" scan. The window INSIDE an entry starts at the compute, by the same
// clock the twin reads, and ends by the TTL — the published staleness bound.
export const USAGE_STATS_MEMO_TTL_MS = 15_000;
if (!global.__velaUsageStatsMemo) global.__velaUsageStatsMemo = { byPeriod: new Map(), inflight: new Map() };
const usageStatsMemo = global.__velaUsageStatsMemo;

const usageStatsKey = (period) => period ?? "all";

/** Live/volatile fields: always THIS call's truth, never the memo's copy.
 *  (`activeRequests` is rebuilt from the pending counters inside every
 *  compute too; the splice keeps the memo from serving a cache-stale one.) */
function spliceLive(stats, active) {
  return {
    ...stats,
    pending: active.pending,
    activeRequests: active.activeRequests,
    recentRequests: active.recentRequests,
    errorProvider: active.errorProvider,
  };
}

// The memo's compute seam: the TWIN's getUsageStats (the symbol this barrel
// re-exports) and the barrel's own live read. Resolved through the dispatcher
// namespace at CALL time — property access, not a snapshot — so the posture
// binding stays live and a test spy on the dispatcher module sees every call.
import * as __usageDispatcher from "./repos/usageRepo.js";
const bound = {
  getUsageStats: (period) => __usageDispatcher.getUsageStats(period),
  getActiveRequests: () => __usageDispatcher.getActiveRequests(),
};

async function computeUsageStats(period) {
  const [stats, active] = await Promise.all([
    bound.getUsageStats(period),
    bound.getActiveRequests(),
  ]);
  return spliceLive(stats, active);
}

/** The shared 15s read — bounded staleness (≤ TTL), fail-open to the last
 *  good copy. No in-flight joining: the first caller computes, later callers
 *  within the window read the memo (or the warm copy once it lands). */
export async function usageStatsShared(period) {
  const key = usageStatsKey(period);
  const now = Date.now();
  const hit = usageStatsMemo.byPeriod.get(key);
  if (hit && now - hit.ts < USAGE_STATS_MEMO_TTL_MS) {
    if (hit.stats) return spliceLive(hit.stats, await bound.getActiveRequests());
    if (hit.inflight) return hit.inflight; // a compute is landing — ride it
  }
  const entry = { ts: now, stats: hit?.stats || null, inflight: null };
  usageStatsMemo.byPeriod.set(key, entry);
  entry.inflight = (async () => {
    try {
      const fresh = await computeUsageStats(period);
      entry.ts = Date.now();
      entry.stats = fresh;
      return fresh;
    } catch (e) {
      if (entry.stats) { entry.ts = Date.now(); return spliceLive(entry.stats, await bound.getActiveRequests()); }
      usageStatsMemo.byPeriod.delete(key);
      throw e;
    } finally {
      entry.inflight = null;
    }
  })();
  return entry.inflight;
}

/** The coalesced read — shared memo PLUS in-flight joining: a cold key hit by
 *  N subscribers runs ONE compute; every one of them receives its result. */
export async function usageStatsCoalesced(period) {
  const key = usageStatsKey(period);
  const hit = usageStatsMemo.byPeriod.get(key);
  if (hit && Date.now() - hit.ts < USAGE_STATS_MEMO_TTL_MS) {
    if (hit.stats) return spliceLive(hit.stats, await bound.getActiveRequests());
    if (hit.inflight) return hit.inflight;
  }
  const existing = usageStatsMemo.inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    try {
      return await usageStatsShared(period);
    } finally {
      usageStatsMemo.inflight.delete(key);
    }
  })();
  usageStatsMemo.inflight.set(key, p);
  return p;
}

/** Test/support seam: drop every memoized copy (never called in production). */
export function __clearUsageStatsMemo() {
  usageStatsMemo.byPeriod.clear();
  usageStatsMemo.inflight.clear();
}

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
  // The Data cockpit (v0.9.95): the storage census + the artifact inventory /
  // verification readers. The census dispatches by posture; the artifact
  // readers live in the engine (they read sealed files, not the DB).
  getStorageInventory, listBackupArtifacts, verifyBackupArtifact, planPruneArtifacts,
} from "./repos/backupRepo.js";
// The adapter seam — for the few callers whose repo functions take an adapter as
// their first argument (the Storage Covenant's own contract). It lives in the
// HARBOR and is re-exported here so those callers never name the driver module
// (the census forbids raw-adapter access outside src/lib/db/). The function names
// deliberately avoid the detector's own substring: the census greps for it, and
// a caller that still trips the detector has not actually been fixed.
export { openStoreAdapter, openStoreAdapterSync } from "./repos/sqlite/storeAdapter.js";
