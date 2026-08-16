// Usage Observatory W1-C (plans/mirror-usage-observatory/SEALED-PLAN.md item 5)
// — usageNames: the ONE copy of the ledger's enrichment + identifier covenant.
//
// The identifier covenant (phase13 R8): every caller-controlled value that
// could reach a SQL identifier (sort column, dimension, granularity, metric)
// resolves through a FROZEN const map FIRST — allow-list before any
// interpolation, never interpolate the raw value, only map-to-literal. An
// unknown value throws FilterParamError (code INVALID_FILTER_PARAM); the API
// layer maps it to HTTP 400 (W2), the repo layer never interpolates it.
//
// Shared enrichment (connectionMap / providerNodeNameMap / apiKeyMap): one
// cached copy for BOTH harbor twins — the sqlite + mysql usageRepo
// implementations import from here so the enrichment can never drift between
// engines. Fail-open: an unreadable source yields an empty map, never a throw.
export class FilterParamError extends Error {
  constructor(field, value) {
    super(`unknown ${field}: ${JSON.stringify(value)}`);
    this.name = "FilterParamError";
    this.code = "INVALID_FILTER_PARAM";
    this.field = field;
    this.value = value;
  }
}

/** Breakdown/series dimensions — frozen map-to-literal (identifier covenant). */
export const DIMENSIONS = Object.freeze({
  provider: "provider",
  model: "model",
  keyId: "keyId",
  endpoint: "endpoint",
  statusClass: "statusClass", // W2-C — the error-anatomy/status-mix dimension
});

/** Series time-bucket sizes — frozen (bucketing is JS-side, so these are
 *  durations, never SQL fragments). */
export const GRANULARITIES = Object.freeze({
  "1h": 3_600_000,
  "6h": 21_600_000,
  "1d": 86_400_000,
});

/** Ledger sort columns — alias → the underlying usageHistory column. Only
 *  these literals may appear in ORDER BY; the alias itself never does. */
export const SORTABLE_COLUMNS = Object.freeze({
  timestamp: "timestamp",
  provider: "provider",
  model: "model",
  keyId: "keyId",
  endpoint: "endpoint",
  cost: "cost",
  status: "status",
  latencyMs: "latencyMs",
  ttftMs: "ttftMs",
  promptTokens: "promptTokens",
  completionTokens: "completionTokens",
});

/** Aggregation metrics for series + breakdown — frozen map-to-literal SQL
 *  expressions, identical on both engines (cache-inclusive prompt convention,
 *  same as the daily rollup writer). */
export const METRICS = Object.freeze({
  requests: "COUNT(*)",
  cost: "SUM(cost)",
  promptTokens: "SUM(promptTokens)",
  completionTokens: "SUM(completionTokens)",
  cachedTokens: "SUM(COALESCE(CAST(json_extract(tokens, '$.cached_tokens') AS INTEGER), 0) + COALESCE(CAST(json_extract(tokens, '$.cache_read_input_tokens') AS INTEGER), 0))",
  totalTokens: "SUM(promptTokens + completionTokens)",
});

/** Metric value from a rollup counter cell (the usageDaily JSON shape). */
export const ROLLUP_METRIC_VALUE = Object.freeze({
  requests: (c) => c?.requests || 0,
  cost: (c) => c?.cost || 0,
  promptTokens: (c) => c?.promptTokens || 0,
  completionTokens: (c) => c?.completionTokens || 0,
  cachedTokens: (c) => c?.cachedTokens || 0,
  totalTokens: (c) => (c?.promptTokens || 0) + (c?.completionTokens || 0),
});

/** Window periods → ms ("today" resolves to local midnight, not a fixed ms). */
export const PERIODS = Object.freeze({
  today: null,
  "24h": 86_400_000,
  "3d": 259_200_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
  "60d": 5_184_000_000,
  all: null,
});

/** Resolve a period to its {startMs, endMs} window ending now. */
export function resolvePeriodWindow(period, now = Date.now()) {
  if (!Object.prototype.hasOwnProperty.call(PERIODS, period)) {
    throw new FilterParamError("period", period);
  }
  if (period === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { startMs: d.getTime(), endMs: now };
  }
  if (period === "all") return { startMs: 0, endMs: now };
  return { startMs: now - PERIODS[period], endMs: now };
}

// ─── Shared enrichment — one cached copy for both harbors ─────────────────
const ENRICH_TTL_MS = 30_000;
if (!global._usageEnrichmentCache) global._usageEnrichmentCache = { ts: 0, connectionMap: {}, providerNodeNameMap: {}, apiKeyMap: {} };
const enrichCache = global._usageEnrichmentCache;

/** { connectionMap, providerNodeNameMap, apiKeyMap } — 30s cache, fail-open.
 *  @param repos "./repos/sqlite" or "./repos/mysql" (caller-relative string).
 *
 *  The enrichment repos load through LITERAL dynamic imports (the same
 *  pattern bindFacade uses) rather than `import(\`${repos}/...\`)` — a
 *  template-literal specifier has no static resolution handle, so Next's
 *  build-time resolver fails with "Can't resolve <dynamic>" even though
 *  vitest resolves it fine at runtime. Literals keep the import lazy (a
 *  static import would close an eager cycle: usageRepo → usageAggregation →
 *  usageNames → apiKeysRepo → usageRepo) while remaining statically
 *  resolvable. Unknown `repos` values fall back to the sqlite harbor — the
 *  identifier covenant upstream means callers never send one anyway. */
export async function getUsageEnrichment(repos) {
  if (Date.now() - enrichCache.ts < ENRICH_TTL_MS && enrichCache.loadedFor === repos) {
    return enrichCache;
  }
  const loadHarbor = (twin) => (twin === "./repos/mysql"
    ? Promise.all([
        import("./repos/mysql/connectionsRepo.js"),
        import("./repos/mysql/nodesRepo.js"),
        import("./repos/mysql/apiKeysRepo.js"),
      ])
    : Promise.all([
        import("./repos/sqlite/connectionsRepo.js"),
        import("./repos/sqlite/nodesRepo.js"),
        import("./repos/sqlite/apiKeysRepo.js"),
      ]));
  const [{ getProviderConnections }, { getProviderNodes }, { getApiKeys }] = await loadHarbor(repos);
  const connectionMap = {};
  try {
    for (const c of await getProviderConnections()) connectionMap[c.id] = c.name || c.email || c.id;
  } catch { /* fail-open */ }
  const providerNodeNameMap = {};
  try {
    for (const n of await getProviderNodes()) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch { /* fail-open */ }
  const apiKeyMap = {};
  try {
    // Keyed by keyId — the stable attribution identity (hash-at-rest)
    for (const k of await getApiKeys()) apiKeyMap[k.id] = { name: k.name, id: k.id, keyPrefix: k.keyPrefix, createdAt: k.createdAt };
  } catch { /* fail-open */ }
  enrichCache.ts = Date.now();
  enrichCache.loadedFor = repos;
  enrichCache.connectionMap = connectionMap;
  enrichCache.providerNodeNameMap = providerNodeNameMap;
  enrichCache.apiKeyMap = apiKeyMap;
  return enrichCache;
}
