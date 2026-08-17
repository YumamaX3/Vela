import { EventEmitter } from "events";
import { getAdapter } from "../../driver.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";
import { getMeta, setMeta } from "../../helpers/metaStore.js";
import { deriveStatusClass } from "../../../usageStatus.js";

// Usage Observatory W1-B (plans/mirror-usage-observatory/SEALED-PLAN.md W1.3):
// the write-time enrichment covenant, mirrored verbatim in the mysql twin
// (parity-by-construction). Everything here is fail-open: absent measurements
// stay NULL, unpriceable RTK stays unfunded, classification falls back to ''.
//
//   latencyMs / ttftMs / httpStatus — NULL when the caller had no signal
//   statusClass — deriveStatusClass({status, httpStatus})
//   meta.rtk = {bytesSaved, tokensSavedEst} — the Gate-14 contract
//   meta.rtkSavedCostUsd — tokensSavedEst × the request's own model input
//     rate via the pricing chain at write time; null when unpriceable
//   latencyBuckets — 7 fixed log-scale edges (sealed plan item 6)
function latencyBucketOf(latencyMs) {
  const n = Number(latencyMs);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 100) return 0;
  if (n < 250) return 1;
  if (n < 500) return 2;
  if (n < 1000) return 3;
  if (n < 2500) return 4;
  if (n < 5000) return 5;
  return 6;
}

/** Telemetry integers ride NULL when absent (never 0-faked, never NaN).
 *  Number(null) === 0, so null/undefined are guarded BEFORE coercion — the
 *  forced-SSE path passes ttftMs: null to mean "unmeasured", and that must
 *  stay NULL in the row, not 0. */
function telemetryInt(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/** Build the `meta` column value: rtk savings carried through when present. */
function buildUsageMeta(entry) {
  const r = entry.rtk;
  if (r && (Number(r.bytesSaved) > 0 || Number.isFinite(Number(r.tokensSavedEst)))) {
    const meta = { rtk: { bytesSaved: Number(r.bytesSaved) || 0 } };
    const est = Number(r.tokensSavedEst);
    if (Number.isFinite(est)) meta.rtk.tokensSavedEst = est;
    return meta;
  }
  return {};
}

/** RTK Savings $ at write time — rtkSavedTokens × this request's own model
 *  input rate via the same pricing chain as cost. Never throws; null when
 *  unpriceable (the UI shows '—'). */
async function fundRtkSavedCost(entry, meta) {
  try {
    const est = Number(meta?.rtk?.tokensSavedEst);
    if (!Number.isFinite(est) || est <= 0) return;
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(entry.provider, entry.model);
    if (!pricing) return; // unpriceable — honest null
    meta.rtkSavedCostUsd = est * (Number(pricing.input) / 1e6);
  } catch { /* fail-open: cost stays unfunded */ }
}

/** Telemetry enrichment of the usageDaily rollup (sealed plan item 1: the
 *  day's JSON shape grows — statusByProvider + latencyBuckets, no schema
 *  change). Fail-open by construction: old days simply lack the fields. */
function aggregateTelemetryToDay(day, entry, statusClass) {
  const providerKey = entry.provider || "";
  if (statusClass) {
    day.statusByProvider ||= {};
    const cell = (day.statusByProvider[providerKey] ||= {});
    if (statusClass === "ok") {
      cell.ok = (cell.ok || 0) + 1;
    } else {
      cell.errors = (cell.errors || 0) + 1;
      cell[statusClass] = (cell[statusClass] || 0) + 1;
    }
  }
  const bucket = latencyBucketOf(entry.latencyMs);
  if (bucket !== null) {
    day.latencyBuckets ||= {};
    const buckets = (day.latencyBuckets[providerKey] ||= {});
    const key = `b${bucket}`;
    buckets[key] = (buckets[key] || 0) + 1;
  }
}

function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 8) return key.charAt(0) + "***";
  return key.slice(0, 8) + "***";
}

// Resolve a bearer token to its stable attribution identity (keyId/keyPrefix).
// Hash-at-rest means the raw key is never persisted — usage is keyed by keyId so
// attribution survives rotation. Fail-open: unresolved → null (local-no-key).
async function resolveUsageKeyIdentity(rawKey) {
  if (!rawKey || typeof rawKey !== "string") return { keyId: null, keyPrefix: null };
  try {
    const { resolveKey } = await import("./apiKeysRepo.js");
    const row = await resolveKey(rawKey);
    if (!row) return { keyId: null, keyPrefix: null };
    return { keyId: row.id, keyPrefix: row.keyPrefix || null };
  } catch {
    return { keyId: null, keyPrefix: null };
  }
}

const PENDING_TIMEOUT_MS = 60 * 1000;
const RING_CAP = 50;
const CONN_CACHE_TTL_MS = 30 * 1000;
const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

// In-memory state shared across Next.js modules
if (!global._pendingRequests) global._pendingRequests = { byModel: {}, byAccount: {} };
if (!global._lastErrorProvider) global._lastErrorProvider = { provider: "", ts: 0 };
if (!global._statsEmitter) {
  global._statsEmitter = new EventEmitter();
  global._statsEmitter.setMaxListeners(50);
}
if (!global._pendingTimers) global._pendingTimers = {};
if (!global._recentRing) global._recentRing = { items: [], initialized: false };
if (!global._connectionMapCache) global._connectionMapCache = { map: {}, ts: 0 };
if (!global._statsEmitTimers) global._statsEmitTimers = { pending: null, update: null };

const pendingRequests = global._pendingRequests;
const lastErrorProvider = global._lastErrorProvider;
const pendingTimers = global._pendingTimers;
const recentRing = global._recentRing;
const connCache = global._connectionMapCache;
const statsEmitTimers = global._statsEmitTimers;

export const statsEmitter = global._statsEmitter;

function scheduleStatsEvent(event, delayMs = 150) {
  const key = event === "update" ? "update" : "pending";
  if (statsEmitTimers[key]) return;
  statsEmitTimers[key] = setTimeout(() => {
    statsEmitTimers[key] = null;
    statsEmitter.emit(event);
  }, delayMs);
  statsEmitTimers[key]?.unref?.();
}

function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addToCounter(target, key, values) {
  if (!target[key]) target[key] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
  target[key].requests += values.requests || 1;
  target[key].promptTokens += values.promptTokens || 0;
  target[key].completionTokens += values.completionTokens || 0;
  target[key].cachedTokens += values.cachedTokens || 0;
  target[key].cost += values.cost || 0;
  if (values.meta) Object.assign(target[key], values.meta);
}

function aggregateEntryToDay(day, entry) {
  const promptTokens = entry.tokens?.prompt_tokens || entry.tokens?.input_tokens || 0;
  const completionTokens = entry.tokens?.completion_tokens || entry.tokens?.output_tokens || 0;
  const cachedTokens = entry.tokens?.cached_tokens || entry.tokens?.cache_read_input_tokens || 0;
  const cost = entry.cost || 0;
  const vals = { promptTokens, completionTokens, cachedTokens, cost };

  day.requests = (day.requests || 0) + 1;
  day.promptTokens = (day.promptTokens || 0) + promptTokens;
  day.completionTokens = (day.completionTokens || 0) + completionTokens;
  day.cachedTokens = (day.cachedTokens || 0) + cachedTokens;
  day.cost = (day.cost || 0) + cost;

  day.byProvider ||= {};
  day.byModel ||= {};
  day.byAccount ||= {};
  day.byApiKey ||= {};
  day.byEndpoint ||= {};

  if (entry.provider) addToCounter(day.byProvider, entry.provider, vals);

  const modelKey = entry.provider ? `${entry.model}|${entry.provider}` : entry.model;
  addToCounter(day.byModel, modelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });

  if (entry.connectionId) {
    addToCounter(day.byAccount, entry.connectionId, { ...vals, meta: { rawModel: entry.model, provider: entry.provider } });
  }

  const apiKeyVal = entry.keyId && typeof entry.keyId === "string" ? entry.keyId : "local-no-key";
  const akModelKey = `${apiKeyVal}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byApiKey, akModelKey, { ...vals, meta: { rawModel: entry.model, provider: entry.provider, keyId: entry.keyId || null, keyPrefix: entry.keyPrefix || null } });

  const endpoint = entry.endpoint || "Unknown";
  const epKey = `${endpoint}|${entry.model}|${entry.provider || "unknown"}`;
  addToCounter(day.byEndpoint, epKey, { ...vals, meta: { endpoint, rawModel: entry.model, provider: entry.provider } });
}

function pushToRing(entry) {
  recentRing.items.push(entry);
  if (recentRing.items.length > RING_CAP) {
    recentRing.items = recentRing.items.slice(-RING_CAP);
  }
}

async function getConnectionMapCached() {
  if (Date.now() - connCache.ts < CONN_CACHE_TTL_MS) return connCache.map;
  try {
    const { getProviderConnections } = await import("./connectionsRepo.js");
    const all = await getProviderConnections();
    const map = {};
    for (const c of all) map[c.id] = c.name || c.email || c.id;
    connCache.map = map;
    connCache.ts = Date.now();
  } catch {}
  return connCache.map;
}

async function ensureRingInitialized() {
  if (recentRing.initialized) return;
  recentRing.initialized = true;
  try {
    const db = await getAdapter();
    const rows = db.all(`SELECT timestamp, provider, model, connectionId, keyId, keyPrefix, endpoint, cost, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`, [RING_CAP]);
    recentRing.items = rows.reverse().map((r) => ({
      timestamp: r.timestamp, provider: r.provider, model: r.model, connectionId: r.connectionId,
      keyId: r.keyId, keyPrefix: r.keyPrefix, endpoint: r.endpoint, cost: r.cost, status: r.status,
      tokens: parseJson(r.tokens, {}),
    }));
  } catch {}
}

async function calculateCost(provider, model, tokens) {
  if (!tokens || !provider || !model) return 0;
  try {
    const { getPricingForModel } = await import("./pricingRepo.js");
    const pricing = await getPricingForModel(provider, model);
    if (!pricing) return 0;

    // Delegate the actual math to the single source of truth (avoids the two
    // copies drifting apart — see open-sse/providers/pricing.js for the
    // cache-inclusive prompt_tokens convention this assumes).
    const { calculateCostFromTokens } = await import("open-sse/providers/pricing.js");
    return calculateCostFromTokens(tokens, pricing);
  } catch (e) {
    console.error("Error calculating cost:", e);
    return 0;
  }
}

export function trackPendingRequest(model, provider, connectionId, started, error = false) {
  const modelKey = provider ? `${model} (${provider})` : model;
  const timerKey = `${connectionId}|${modelKey}`;

  if (!pendingRequests.byModel[modelKey]) pendingRequests.byModel[modelKey] = 0;
  pendingRequests.byModel[modelKey] = Math.max(0, pendingRequests.byModel[modelKey] + (started ? 1 : -1));
  if (pendingRequests.byModel[modelKey] === 0) delete pendingRequests.byModel[modelKey];

  if (connectionId) {
    if (!pendingRequests.byAccount[connectionId]) pendingRequests.byAccount[connectionId] = {};
    if (!pendingRequests.byAccount[connectionId][modelKey]) pendingRequests.byAccount[connectionId][modelKey] = 0;
    pendingRequests.byAccount[connectionId][modelKey] = Math.max(0, pendingRequests.byAccount[connectionId][modelKey] + (started ? 1 : -1));
    if (pendingRequests.byAccount[connectionId][modelKey] === 0) {
      delete pendingRequests.byAccount[connectionId][modelKey];
      if (Object.keys(pendingRequests.byAccount[connectionId]).length === 0) {
        delete pendingRequests.byAccount[connectionId];
      }
    }
  }

  if (started) {
    clearTimeout(pendingTimers[timerKey]);
    pendingTimers[timerKey] = setTimeout(() => {
      delete pendingTimers[timerKey];
      if (pendingRequests.byModel[modelKey] > 0) pendingRequests.byModel[modelKey] = 0;
      if (connectionId && pendingRequests.byAccount[connectionId]?.[modelKey] > 0) {
        pendingRequests.byAccount[connectionId][modelKey] = 0;
      }
      scheduleStatsEvent("pending");
    }, PENDING_TIMEOUT_MS);
  } else {
    clearTimeout(pendingTimers[timerKey]);
    delete pendingTimers[timerKey];
  }

  if (!started && error && provider) {
    lastErrorProvider.provider = provider.toLowerCase();
    lastErrorProvider.ts = Date.now();
  }

  // [PENDING] console line removed; lifecycle is visible via "▶" and "📊 done" lines
  scheduleStatsEvent("pending");
}

export async function getActiveRequests() {
  const activeRequests = [];
  const connectionMap = await getConnectionMapCached();

  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  await ensureRingInitialized();
  const seen = new Set();
  const recentRequests = [...recentRing.items]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .map((e) => {
      const t = e.tokens || {};
      return {
        timestamp: e.timestamp, model: e.model, provider: e.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        status: e.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const errorProvider = (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "";
  return { activeRequests, recentRequests, errorProvider };
}

export async function saveRequestUsage(entry) {
  try {
    const db = await getAdapter();

    if (!entry.timestamp) entry.timestamp = new Date().toISOString();
    entry.cost = await calculateCost(entry.provider, entry.model, entry.tokens);

    // Resolve stable attribution identity. The raw bearer token is NEVER
    // persisted (hash-at-rest, plan §3.6) — masked-dual-write from W1.
    // Keyless fast-path: skip the async resolution entirely when there is no
    // bearer token, keeping the hot path synchronous (matches pre-governance
    // timing for the overwhelmingly common local-no-key case).
    let keyId = null, keyPrefix = null;
    if (typeof entry.apiKey === "string" && entry.apiKey) {
      ({ keyId, keyPrefix } = await resolveUsageKeyIdentity(entry.apiKey));
    }
    entry.keyId = keyId;
    entry.keyPrefix = keyPrefix;
    delete entry.apiKey; // never reach the INSERT

    const tokens = entry.tokens || {};
    const promptTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
    const completionTokens = tokens.completion_tokens || tokens.output_tokens || 0;

    // Observatory telemetry (W1-B): NULL when absent, never 0-faked. statusClass
    // derives from exactly what lands in the `status` column (entry.status ||
    // "ok" — completed usage is ok) + httpStatus when instrumented, so the row
    // and the day-rollup — and every era of data — can never disagree.
    const latencyMs = telemetryInt(entry.latencyMs);
    const ttftMs = telemetryInt(entry.ttftMs);
    const httpStatus = telemetryInt(entry.httpStatus);
    const statusClass = deriveStatusClass({ status: entry.status || "ok", httpStatus: entry.httpStatus ?? null });
    const meta = buildUsageMeta(entry);
    await fundRtkSavedCost(entry, meta); // fail-open: unfunded stays null

    let inserted = false;

    // Dedupe identity (Storage Covenant A5, plan line 270): enforced by the
    // UNIQUE index uq_uh_dedupe from migration 004, so the write is ATOMIC —
    // the old SELECT-then-INSERT raced across processes and over-collapsed
    // same-millisecond writes. ON CONFLICT DO NOTHING ≡ the mysql twin's
    // ER_DUP_ENTRY treatment (plan lines 98/274). The four text columns write
    // '' (not NULL): migration 004 normalized '' as the "unset" form so the
    // UNIQUE index dedupes keyless rows identically in both engines (NULLs
    // are DISTINCT in UNIQUE indexes). changes === 0 marks a duplicate.
    //
    // All 3 writes (history insert, daily upsert, lifetime counter) stay in
    // ONE transaction — better-sqlite3 is sync → no JS yield mid-transaction
    // → no race in same process.
    // Observatory telemetry rides the first INSERT — the dedupe UNIQUE does
    // not include the telemetry columns, so a duplicate group's telemetry is
    // dropped with the conflict (endpoint-only backfill below). Accepted at
    // Gate 14: telemetry on the first write, never retrofit.
    db.transaction(() => {
      const res = db.run(
        `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, status, tokens, meta, latencyMs, ttftMs, httpStatus, statusClass) VALUES(?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(timestamp, provider, model, connectionId, keyId, promptTokens, completionTokens) DO NOTHING`,
        [
          entry.timestamp, entry.provider || "", entry.model || "",
          entry.connectionId || "", entry.keyId || "", entry.keyPrefix || null,
          entry.endpoint || null,
          promptTokens, completionTokens, entry.cost || 0, entry.status || "ok",
          stringifyJson(tokens), stringifyJson(meta),
          latencyMs, ttftMs, httpStatus, statusClass,
        ]
      );

      if (!res || Number(res.changes ?? 0) === 0) {
        // Duplicate group — backfill the endpoint exactly as the old
        // SELECT-then-INSERT path did (idempotent, endpoint-only).
        if (entry.endpoint) {
          db.run(
            `UPDATE usageHistory SET endpoint = ?
             WHERE timestamp = ? AND provider = ? AND model = ? AND connectionId = ? AND keyId = ?
               AND promptTokens = ? AND completionTokens = ?
               AND (endpoint IS NULL OR endpoint = '')`,
            [
              entry.endpoint,
              entry.timestamp, entry.provider || "", entry.model || "",
              entry.connectionId || "", entry.keyId || "",
              promptTokens, completionTokens,
            ]
          );
        }
        return;
      }

      const dateKey = getLocalDateKey(entry.timestamp);
      const row = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]);
      const day = row ? parseJson(row.data, {}) : {
        requests: 0, promptTokens: 0, completionTokens: 0, cost: 0,
        byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
      };
      aggregateEntryToDay(day, entry);
      aggregateTelemetryToDay(day, entry, statusClass); // W1-B: rollup telemetry
      db.run(`INSERT INTO usageDaily(dateKey, data) VALUES(?, ?) ON CONFLICT(dateKey) DO UPDATE SET data = excluded.data`, [dateKey, stringifyJson(day)]);

      // Atomic counter increment in same transaction
      const cur = db.get(`SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'`);
      const next = (cur ? parseInt(cur.value, 10) : 0) + 1;
      db.run(`INSERT INTO _meta(key, value) VALUES('totalRequestsLifetime', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [String(next)]);
      inserted = true;
    });

    if (inserted) {
      pushToRing(entry);
      scheduleStatsEvent("update", 250);
    }
  } catch (e) {
    console.error("Failed to save usage stats:", e);
  }
}

export async function getUsageHistory(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const rows = db.all(`SELECT timestamp, provider, model, connectionId, keyId, keyPrefix, endpoint, cost, status, tokens FROM usageHistory ${where} ORDER BY id ASC`, params);

  return rows.map((r) => ({
    timestamp: r.timestamp, provider: r.provider, model: r.model,
    connectionId: r.connectionId, keyId: r.keyId || null,
    apiKeyMasked: r.keyPrefix || null, endpoint: r.endpoint,
    cost: r.cost, status: r.status, tokens: parseJson(r.tokens, {}),
  }));
}

function loadDaysInRange(adapter, maxDays) {
  if (maxDays == null) {
    return adapter.all(`SELECT dateKey, data FROM usageDaily`);
  }
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - maxDays + 1);
  const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  return adapter.all(`SELECT dateKey, data FROM usageDaily WHERE dateKey >= ?`, [cutoffKey]);
}

export async function getUsageStats(period = "all") {
  const db = await getAdapter();

  const [{ getProviderConnections }, { getApiKeys }, { getProviderNodes }] = await Promise.all([
    import("./connectionsRepo.js"),
    import("./apiKeysRepo.js"),
    import("./nodesRepo.js"),
  ]);

  let allConnections = [];
  try { allConnections = await getProviderConnections(); } catch {}
  const connectionMap = {};
  for (const c of allConnections) connectionMap[c.id] = c.name || c.email || c.id;

  const providerNodeNameMap = {};
  try {
    const nodes = await getProviderNodes();
    for (const n of nodes) if (n.id && n.name) providerNodeNameMap[n.id] = n.name;
  } catch {}

  let allApiKeys = [];
  try { allApiKeys = await getApiKeys(); } catch {}
  const apiKeyMap = {};
  // Keyed by keyId — the stable attribution identity (hash-at-rest, plan §3.6)
  for (const k of allApiKeys) apiKeyMap[k.id] = { name: k.name, id: k.id, keyPrefix: k.keyPrefix, createdAt: k.createdAt };

  // recentRequests from live history (last 100 entries enough for 20 deduped)
  const recentRows = db.all(`SELECT timestamp, provider, model, tokens, status FROM usageHistory ORDER BY id DESC LIMIT 100`);
  const seen = new Set();
  const recentRequests = recentRows
    .map((r) => {
      const t = parseJson(r.tokens, {}) || {};
      return {
        timestamp: r.timestamp, model: r.model, provider: r.provider || "",
        promptTokens: t.prompt_tokens || t.input_tokens || 0,
        completionTokens: t.completion_tokens || t.output_tokens || 0,
        cachedTokens: t.cached_tokens || t.cache_read_input_tokens || 0,
        status: r.status || "ok",
      };
    })
    .filter((e) => {
      if (e.promptTokens === 0 && e.completionTokens === 0) return false;
      const minute = e.timestamp ? e.timestamp.slice(0, 16) : "";
      const key = `${e.model}|${e.provider}|${e.promptTokens}|${e.completionTokens}|${minute}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);

  const stats = {
    totalRequests: 0,
    totalPromptTokens: 0, totalCompletionTokens: 0, totalCachedTokens: 0, totalCost: 0,
    byProvider: {}, byModel: {}, byAccount: {}, byApiKey: {}, byEndpoint: {},
    last10Minutes: [],
    pending: pendingRequests,
    activeRequests: [],
    recentRequests,
    errorProvider: (Date.now() - lastErrorProvider.ts < 10000) ? lastErrorProvider.provider : "",
  };

  // Active requests
  for (const [connectionId, models] of Object.entries(pendingRequests.byAccount)) {
    for (const [modelKey, count] of Object.entries(models)) {
      if (count > 0) {
        const accountName = connectionMap[connectionId] || `Account ${connectionId.slice(0, 8)}...`;
        const match = modelKey.match(/^(.*) \((.*)\)$/);
        stats.activeRequests.push({
          model: match ? match[1] : modelKey,
          provider: match ? match[2] : "unknown",
          account: accountName, count,
        });
      }
    }
  }

  // last10Minutes — query 10min window
  const now = new Date();
  const currentMinuteStart = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const tenMinutesAgo = new Date(currentMinuteStart.getTime() - 9 * 60 * 1000);
  const bucketMap = {};
  for (let i = 0; i < 10; i++) {
    const ts = currentMinuteStart.getTime() - (9 - i) * 60 * 1000;
    bucketMap[ts] = { requests: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    stats.last10Minutes.push(bucketMap[ts]);
  }
  const recent10 = db.all(
    `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?`,
    [tenMinutesAgo.toISOString(), now.toISOString()]
  );
  for (const r of recent10) {
    const tt = new Date(r.timestamp).getTime();
    const minuteStart = Math.floor(tt / 60000) * 60000;
    if (bucketMap[minuteStart]) {
      bucketMap[minuteStart].requests++;
      bucketMap[minuteStart].promptTokens += r.promptTokens || 0;
      bucketMap[minuteStart].completionTokens += r.completionTokens || 0;
      bucketMap[minuteStart].cost += r.cost || 0;
    }
  }

  const useDailySummary = period !== "24h" && period !== "today";

  if (useDailySummary) {
    const periodDays = { "7d": 7, "30d": 30, "60d": 60 };
    const maxDays = periodDays[period] || null;
    const dayRows = loadDaysInRange(db, maxDays);

    for (const dr of dayRows) {
      const dateKey = dr.dateKey;
      const day = parseJson(dr.data, {});
      stats.totalPromptTokens += day.promptTokens || 0;
      stats.totalCompletionTokens += day.completionTokens || 0;
      stats.totalCachedTokens += day.cachedTokens || 0;
      stats.totalCost += day.cost || 0;

      for (const [prov, p] of Object.entries(day.byProvider || {})) {
        if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
        stats.byProvider[prov].requests += p.requests || 0;
        stats.byProvider[prov].promptTokens += p.promptTokens || 0;
        stats.byProvider[prov].completionTokens += p.completionTokens || 0;
        stats.byProvider[prov].cachedTokens += p.cachedTokens || 0;
        stats.byProvider[prov].cost += p.cost || 0;
      }

      for (const [mk, m] of Object.entries(day.byModel || {})) {
        const rawModel = m.rawModel || mk.split("|")[0];
        const provider = m.provider || mk.split("|")[1] || "";
        const statsKey = provider ? `${rawModel} (${provider})` : rawModel;
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byModel[statsKey]) {
          stats.byModel[statsKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, lastUsed: dateKey };
        }
        stats.byModel[statsKey].requests += m.requests || 0;
        stats.byModel[statsKey].promptTokens += m.promptTokens || 0;
        stats.byModel[statsKey].completionTokens += m.completionTokens || 0;
        stats.byModel[statsKey].cachedTokens += m.cachedTokens || 0;
        stats.byModel[statsKey].cost += m.cost || 0;
        if (dateKey > (stats.byModel[statsKey].lastUsed || "")) stats.byModel[statsKey].lastUsed = dateKey;
      }

      for (const [connId, a] of Object.entries(day.byAccount || {})) {
        const accountName = connectionMap[connId] || `Account ${connId.slice(0, 8)}...`;
        const rawModel = a.rawModel || "";
        const provider = a.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const accountKey = `${rawModel} (${provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, connectionId: connId, accountName, lastUsed: dateKey };
        }
        stats.byAccount[accountKey].requests += a.requests || 0;
        stats.byAccount[accountKey].promptTokens += a.promptTokens || 0;
        stats.byAccount[accountKey].completionTokens += a.completionTokens || 0;
        stats.byAccount[accountKey].cachedTokens += a.cachedTokens || 0;
        stats.byAccount[accountKey].cost += a.cost || 0;
        if (dateKey > (stats.byAccount[accountKey].lastUsed || "")) stats.byAccount[accountKey].lastUsed = dateKey;
      }

      for (const [akKey, ak] of Object.entries(day.byApiKey || {})) {
        const rawModel = ak.rawModel || "";
        const provider = ak.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        const keyId = ak.keyId;
        const keyInfo = keyId ? apiKeyMap[keyId] : null;
        const keyName = keyInfo?.name || (keyId ? `vela-v1-${keyId.slice(0, 8)}…` : "Local (No API Key)");
        const apiKeyMasked = keyInfo?.keyPrefix || ak.keyPrefix || (keyId ? `vela-v1-${keyId.slice(0, 8)}…` : null);
        const apiKeyKey = keyId || "local-no-key";
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey, lastUsed: dateKey };
        }
        stats.byApiKey[akKey].requests += ak.requests || 0;
        stats.byApiKey[akKey].promptTokens += ak.promptTokens || 0;
        stats.byApiKey[akKey].completionTokens += ak.completionTokens || 0;
        stats.byApiKey[akKey].cachedTokens += ak.cachedTokens || 0;
        stats.byApiKey[akKey].cost += ak.cost || 0;
        if (dateKey > (stats.byApiKey[akKey].lastUsed || "")) stats.byApiKey[akKey].lastUsed = dateKey;
      }

      for (const [epKey, ep] of Object.entries(day.byEndpoint || {})) {
        const endpoint = ep.endpoint || epKey.split("|")[0] || "Unknown";
        const rawModel = ep.rawModel || "";
        const provider = ep.provider || "";
        const providerDisplayName = providerNodeNameMap[provider] || provider;
        if (!stats.byEndpoint[epKey]) {
          stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel, provider: providerDisplayName, lastUsed: dateKey };
        }
        stats.byEndpoint[epKey].requests += ep.requests || 0;
        stats.byEndpoint[epKey].promptTokens += ep.promptTokens || 0;
        stats.byEndpoint[epKey].completionTokens += ep.completionTokens || 0;
        stats.byEndpoint[epKey].cachedTokens += ep.cachedTokens || 0;
        stats.byEndpoint[epKey].cost += ep.cost || 0;
        if (dateKey > (stats.byEndpoint[epKey].lastUsed || "")) stats.byEndpoint[epKey].lastUsed = dateKey;
      }
    }

    // Overlay precise lastUsed timestamps from history
    const overlayCutoff = maxDays ? Date.now() - maxDays * 86400000 : 0;
    const histRows = db.all(
      `SELECT timestamp, provider, model, connectionId, keyId, endpoint FROM usageHistory WHERE timestamp >= ?`,
      [new Date(overlayCutoff).toISOString()]
    );
    for (const e of histRows) {
      const ts = e.timestamp;
      const modelKey = e.provider ? `${e.model} (${e.provider})` : e.model;
      if (stats.byModel[modelKey] && new Date(ts) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = ts;

      if (e.connectionId) {
        const accountName = connectionMap[e.connectionId] || `Account ${e.connectionId.slice(0, 8)}...`;
        const accountKey = `${e.model} (${e.provider} - ${accountName})`;
        if (stats.byAccount[accountKey] && new Date(ts) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = ts;
      }

      const apiKeyKey = (e.keyId && typeof e.keyId === "string")
        ? `${e.keyId}|${e.model}|${e.provider || "unknown"}`
        : "local-no-key";
      if (stats.byApiKey[apiKeyKey] && new Date(ts) > new Date(stats.byApiKey[apiKeyKey].lastUsed)) stats.byApiKey[apiKeyKey].lastUsed = ts;

      const endpoint = e.endpoint || "Unknown";
      const endpointKey = `${endpoint}|${e.model}|${e.provider || "unknown"}`;
      if (stats.byEndpoint[endpointKey] && new Date(ts) > new Date(stats.byEndpoint[endpointKey].lastUsed)) stats.byEndpoint[endpointKey].lastUsed = ts;
    }
  } else {
    // 24h / today: live history
    let cutoff;
    if (period === "today") {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      cutoff = startOfDay.toISOString();
    } else {
      cutoff = new Date(Date.now() - PERIOD_MS["24h"]).toISOString();
    }
    const filtered = db.all(
      `SELECT timestamp, provider, model, connectionId, keyId, keyPrefix, endpoint, promptTokens, completionTokens, cost, tokens FROM usageHistory WHERE timestamp >= ?`,
      [cutoff]
    );

    for (const r of filtered) {
      const tokens = parseJson(r.tokens, {}) || {};
      const promptTokens = tokens.prompt_tokens || 0;
      const completionTokens = tokens.completion_tokens || 0;
      const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
      const entryCost = r.cost || 0;
      const providerDisplayName = providerNodeNameMap[r.provider] || r.provider || null;

      stats.totalPromptTokens += promptTokens;
      stats.totalCompletionTokens += completionTokens;
      stats.totalCachedTokens += cachedTokens;
      stats.totalCost += entryCost;

      // migration 004: '' is the normalized form of "unset" — key the display
      // map on null so live stats and artifacts agree.
      const prov = r.provider || null;
      if (!stats.byProvider[prov]) stats.byProvider[prov] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0 };
      stats.byProvider[prov].requests++;
      stats.byProvider[prov].promptTokens += promptTokens;
      stats.byProvider[prov].completionTokens += completionTokens;
      stats.byProvider[prov].cachedTokens += cachedTokens;
      stats.byProvider[prov].cost += entryCost;

      const modelKey = r.provider ? `${r.model} (${r.provider})` : r.model;
      if (!stats.byModel[modelKey]) {
        stats.byModel[modelKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      stats.byModel[modelKey].requests++;
      stats.byModel[modelKey].promptTokens += promptTokens;
      stats.byModel[modelKey].completionTokens += completionTokens;
      stats.byModel[modelKey].cachedTokens += cachedTokens;
      stats.byModel[modelKey].cost += entryCost;
      if (new Date(r.timestamp) > new Date(stats.byModel[modelKey].lastUsed)) stats.byModel[modelKey].lastUsed = r.timestamp;

      if (r.connectionId) {
        const accountName = connectionMap[r.connectionId] || `Account ${r.connectionId.slice(0, 8)}...`;
        const accountKey = `${r.model} (${r.provider} - ${accountName})`;
        if (!stats.byAccount[accountKey]) {
          stats.byAccount[accountKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, connectionId: r.connectionId, accountName, lastUsed: r.timestamp };
        }
        stats.byAccount[accountKey].requests++;
        stats.byAccount[accountKey].promptTokens += promptTokens;
        stats.byAccount[accountKey].completionTokens += completionTokens;
        stats.byAccount[accountKey].cachedTokens += cachedTokens;
        stats.byAccount[accountKey].cost += entryCost;
        if (new Date(r.timestamp) > new Date(stats.byAccount[accountKey].lastUsed)) stats.byAccount[accountKey].lastUsed = r.timestamp;
      }

      if (r.keyId && typeof r.keyId === "string") {
        const keyInfo = apiKeyMap[r.keyId];
        const keyName = keyInfo?.name || `vela-v1-${r.keyId.slice(0, 8)}…`;
        const apiKeyMasked = keyInfo?.keyPrefix || r.keyPrefix || `vela-v1-${r.keyId.slice(0, 8)}…`;
        const akKey = `${r.keyId}|${r.model}|${r.provider || "unknown"}`;
        if (!stats.byApiKey[akKey]) {
          stats.byApiKey[akKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked, keyName, apiKeyKey: r.keyId, lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey[akKey];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      } else {
        if (!stats.byApiKey["local-no-key"]) {
          stats.byApiKey["local-no-key"] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, rawModel: r.model, provider: providerDisplayName, apiKeyMasked: null, keyName: "Local (No API Key)", apiKeyKey: "local-no-key", lastUsed: r.timestamp };
        }
        const ake = stats.byApiKey["local-no-key"];
        ake.requests++; ake.promptTokens += promptTokens; ake.completionTokens += completionTokens; ake.cachedTokens += cachedTokens; ake.cost += entryCost;
        if (new Date(r.timestamp) > new Date(ake.lastUsed)) ake.lastUsed = r.timestamp;
      }

      const endpoint = r.endpoint || "Unknown";
      const epKey = `${endpoint}|${r.model}|${r.provider || "unknown"}`;
      if (!stats.byEndpoint[epKey]) {
        stats.byEndpoint[epKey] = { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cost: 0, endpoint, rawModel: r.model, provider: providerDisplayName, lastUsed: r.timestamp };
      }
      const epe = stats.byEndpoint[epKey];
      epe.requests++; epe.promptTokens += promptTokens; epe.completionTokens += completionTokens; epe.cachedTokens += cachedTokens; epe.cost += entryCost;
      if (new Date(r.timestamp) > new Date(epe.lastUsed)) epe.lastUsed = r.timestamp;
    }
  }

  stats.totalRequests = Object.values(stats.byProvider).reduce((sum, p) => sum + (p.requests || 0), 0);
  return stats;
}

// Per-key usage rollup for the Endpoints page — one GROUP BY over the ledger.
// Attribution is by keyId (hash-at-rest: the raw bearer never reaches these
// rows), so totals survive key rotation. Returns { [keyId]: { requests,
// promptTokens, completionTokens, cachedTokens, totalTokens, cost,
// lastUsed } } — keys with zero usage in the window are simply absent.
const KEY_USAGE_PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };
export async function getKeyUsageStats(period = "all") {
  const db = await getAdapter();
  const periodKey = KEY_USAGE_PERIOD_MS[period] ? period : "all";
  const where = periodKey === "all" ? "" : "WHERE timestamp >= ?";
  const params = periodKey === "all" ? [] : [new Date(Date.now() - KEY_USAGE_PERIOD_MS[periodKey]).toISOString()];
  const rows = db.all(
    `SELECT keyId,
            COUNT(*) AS requests,
            SUM(promptTokens) AS promptTokens,
            SUM(completionTokens) AS completionTokens,
            SUM(cost) AS cost,
            MAX(timestamp) AS lastUsed
     FROM usageHistory ${where}
     GROUP BY keyId`,
    params
  );
  const byKey = {};
  for (const r of rows) {
    if (!r.keyId) continue; // local-no-key traffic is not a key's story
    const promptTokens = r.promptTokens || 0;
    const completionTokens = r.completionTokens || 0;
    byKey[r.keyId] = {
      requests: r.requests || 0,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cost: r.cost || 0,
      lastUsed: r.lastUsed || null,
    };
  }
  return byKey;
}

// Awakens the dormant lastUsedAt column whenever the gate resolves a key
// (see apiKeysRepo.resolveKey) — cheap UPDATE, one ledger touch per request.
// Throttled ~60s per keyId INSIDE the repo (the Twin Harbors seam) so the hot
// path does not rewrite the same row on every request; the first touch always
// lands so a fresh key stamps immediately. Fail-open: a missed touch is
// cosmetic — lastUsedAt catches up on the next un-throttled request.
const _lastUsedWrites = new Map();
const LAST_USED_THROTTLE_MS = 60_000;
export async function touchKeyLastUsed(keyId) {
  const now = Date.now();
  const prev = _lastUsedWrites.get(keyId) || 0;
  if (now - prev < LAST_USED_THROTTLE_MS) return;
  _lastUsedWrites.set(keyId, now);
  try {
    const db = await getAdapter();
    db.run(`UPDATE apiKeys SET lastUsedAt = ? WHERE id = ?`, [new Date().toISOString(), keyId]);
  } catch {}
}

/**
 * Parsed usageDaily ledger for every day >= startDateKey, oldest first.
 * Malformed rows are skipped. Part of the frozen contract — keyGate's spend
 * stage sums through this seam rather than reaching past the harbor for the
 * raw adapter.
 */
export async function getUsageDailySince(startDateKey) {
  const db = await getAdapter();
  const rows = db.all(`SELECT data FROM usageDaily WHERE dateKey >= ? ORDER BY dateKey ASC`, [startDateKey]);
  const days = [];
  for (const row of rows) {
    try { days.push(JSON.parse(row.data)); } catch { /* malformed row — skip */ }
  }
  return days;
}

export async function getChartData(period = "7d") {
  const db = await getAdapter();
  const now = Date.now();

  if (period === "today") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startTime = startOfDay.getTime();
    const endTime = startTime + bucketCount * bucketMs;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t >= endTime) continue;
      const idx = Math.floor((t - startTime) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
        buckets[idx].cost += r.cost || 0;
      }
    }
    return buckets;
  }

  if (period === "24h") {
    const bucketCount = 24;
    const bucketMs = 3600000;
    const labelFn = (ts) => new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
    const startTime = now - bucketCount * bucketMs;
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({ label: labelFn(startTime + i * bucketMs), tokens: 0, cost: 0 }));

    const rows = db.all(
      `SELECT timestamp, promptTokens, completionTokens, cost FROM usageHistory WHERE timestamp >= ?`,
      [new Date(startTime).toISOString()]
    );
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      if (t < startTime || t > now) continue;
      const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
      buckets[idx].tokens += (r.promptTokens || 0) + (r.completionTokens || 0);
      buckets[idx].cost += r.cost || 0;
    }
    return buckets;
  }

  const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  const today = new Date();
  const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  // Build map of dateKey → day data
  const dayRows = loadDaysInRange(db, bucketCount);
  const dayMap = {};
  for (const r of dayRows) dayMap[r.dateKey] = parseJson(r.data, {});

  return Array.from({ length: bucketCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (bucketCount - 1 - i));
    const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayData = dayMap[dateKey];
    return {
      label: labelFn(d),
      tokens: dayData ? (dayData.promptTokens || 0) + (dayData.completionTokens || 0) : 0,
      cost: dayData ? (dayData.cost || 0) : 0,
    };
  });
}

function formatLogDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// No-op: request log is now derived from usageHistory table on read.
export async function appendRequestLog() {}

export async function getRecentLogs(limit = 200) {
  try {
    const db = await getAdapter();
    const rows = db.all(
      `SELECT timestamp, provider, model, connectionId, promptTokens, completionTokens, status, tokens FROM usageHistory ORDER BY id DESC LIMIT ?`,
      [limit],
    );
    if (!rows.length) return [];

    const connMap = {};
    try {
      const { getProviderConnections } = await import("./connectionsRepo.js");
      const connections = await getProviderConnections();
      for (const c of connections) connMap[c.id] = c.name || c.email || "";
    } catch {}

    return rows.map((r) => {
      const ts = formatLogDate(new Date(r.timestamp));
      const p = r.provider?.toUpperCase() || "-";
      const m = r.model || "-";
      const account = connMap[r.connectionId] || (r.connectionId ? r.connectionId.slice(0, 8) : "-");
      const tk = r.tokens ? parseJson(r.tokens, {}) : {};
      const sent = r.promptTokens ?? tk.prompt_tokens ?? "-";
      const received = r.completionTokens ?? tk.completion_tokens ?? "-";
      return `${ts} | ${m} | ${p} | ${account} | ${sent} | ${received} | ${r.status || "-"}`;
    });
  } catch (e) {
    console.error("[usageRepo] getRecentLogs failed:", e.message);
    return [];
  }
}

// ─── Usage Observatory W1-C — the 7-function aggregation layer ────────────
// Sealed plan item 4: twin-parity fns with the identifier covenant. The
// machinery is ONE engine-neutral copy (../usageAggregation.js); this twin
// owns the adapter access + its dialect fragments (compile-time constants —
// the ONLY sqlite-specific literals, never caller input; phase13 R8).
import {
  filteredSeriesImpl,
  breakdownImpl,
  stackedSeriesImpl,
  percentilesImpl,
  providerHealthFrameImpl,
  kpisImpl,
  insightsImpl,
  healthTimelineImpl,
  ledgerRowsImpl,
  exportCursorImpl,
} from "../../usageAggregation.js";

/** sqlite's JSON dialect for the two JSON-backed KPI expressions. */
const SQLITE_KPI_DIALECT = Object.freeze({
  cachedRowExpr:
    "COALESCE(CAST(json_extract(tokens, '$.cached_tokens') AS INTEGER), 0) + COALESCE(CAST(json_extract(tokens, '$.cache_read_input_tokens') AS INTEGER), 0)",
  rtkRowExpr: "COALESCE(CAST(json_extract(meta, '$.rtkSavedCostUsd') AS REAL), 0)",
});

export async function getFilteredSeries(opts) {
  return filteredSeriesImpl(await getAdapter(), opts);
}

export async function getBreakdown(opts) {
  return breakdownImpl(await getAdapter(), opts);
}

export async function getStackedSeries(opts) {
  return stackedSeriesImpl(await getAdapter(), opts);
}

export async function getPercentiles(opts) {
  return percentilesImpl(await getAdapter(), opts);
}

export async function getProviderHealthFrame(opts) {
  return providerHealthFrameImpl(await getAdapter(), opts);
}

export async function getKpis(opts) {
  return kpisImpl(await getAdapter(), { ...opts, dialect: SQLITE_KPI_DIALECT });
}

export async function getLedgerRows(opts) {
  return ledgerRowsImpl(await getAdapter(), { ...opts, repos: "./repos/sqlite" });
}

export function getExportCursor(opts) {
  return (async function* () {
    yield* exportCursorImpl(await getAdapter(), { ...opts, repos: "./repos/sqlite" });
  })();
}

// ─── Usage Observatory W1-D — the SSE contract's memoized health frame ────
// Sealed plan item 7 + phase13 R5: the per-provider rolling frame feeds every
// SSE client's quickStats.perProvider, and a per-event DB scan would multiply
// the cost by every subscriber. ONE server-global memo, TTL ≤30s, shared
// across all clients and both send paths — a down twin or a busy window just
// serves the last good frame (fail-open, never throws to the stream).
const PERPROVIDER_MEMO_TTL_MS = 30_000;
if (!global.__velaPerProviderMemo) global.__velaPerProviderMemo = { frame: null, ts: 0 };
const perProviderMemo = global.__velaPerProviderMemo;

export async function getPerProviderFrame(windowMs = 60_000) {
  const now = Date.now();
  if (perProviderMemo.frame && now - perProviderMemo.ts < PERPROVIDER_MEMO_TTL_MS) {
    return perProviderMemo.frame;
  }
  try {
    const frame = await getProviderHealthFrame({ windowMs, now });
    perProviderMemo.frame = frame;
    perProviderMemo.ts = now;
    return frame;
  } catch {
    // Fail-open: serve the stale frame if we have one, else an empty window.
    return perProviderMemo.frame || { perProvider: {}, windowMs, ts: now };
  }
}

// W4-B — auto-insights (the Lookout). Engine-neutral evaluator in
// usageInsights.js; this twin owns the dialect fragments (same as getKpis).
export async function getInsights(opts) {
  return insightsImpl(await getAdapter(), { ...opts, dialect: SQLITE_KPI_DIALECT });
}

// W4-D — provider health timeline strips. Engine-neutral two-tier builder in
// usageAggregation.js; this twin passes its own harbor for the enrichment.
export async function getHealthTimeline(opts) {
  return healthTimelineImpl(await getAdapter(), { ...opts, repos: "./repos/sqlite" });
}
