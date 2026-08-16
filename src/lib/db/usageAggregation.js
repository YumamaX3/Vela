// Usage Observatory W1-C — the aggregation machinery, ONE copy for both
// harbor twins (sealed plan item 4: "7 fns ... with sqlite+mysql twins").
//
// Division of labor: this module is engine-neutral SQL + JS aggregation. Each
// twin (sqlite/usageRepo.js, mysql/usageRepo.js) owns its adapter access and
// its dialect fragments (the JSON-extract row expressions for cachedTokens
// and rtkSavedCostUsd — the ONLY engine-specific literals, compile-time
// constants, never caller input) and delegates everything else here.
//
// The identifier covenant (phase13 R8) lives in usageNames.js: DIMENSIONS,
// GRANULARITIES, SORTABLE_COLUMNS, METRICS are frozen maps; every
// caller-controlled identifier resolves through them BEFORE interpolation.
// Unknown values throw FilterParamError (code INVALID_FILTER_PARAM → 400 at
// the API layer). Nothing caller-supplied ever reaches a SQL identifier.
import {
  DIMENSIONS,
  GRANULARITIES,
  SORTABLE_COLUMNS,
  METRICS,
  ROLLUP_METRIC_VALUE,
  FilterParamError,
  resolvePeriodWindow,
  getUsageEnrichment,
} from "./usageNames.js";

const PERCENTILES = [
  ["p50", 0.5],
  ["p95", 0.95],
  ["p99", 0.99],
];
const BUCKET_UPPER_EDGES_MS = [100, 250, 500, 1000, 2500, 5000, Infinity]; // b0..b6
const EXACT_WINDOW_MS = 3 * 86_400_000; // ≤3d exact; 7d+ rides the rollup
export const EXPORT_ROW_CAP = 200_000; // DoS rail (phase13); truncation noted by the API layer

const iso = (ms) => new Date(ms).toISOString();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Escape LIKE metacharacters so `q` is a literal search, never a pattern. */
export function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, "\\$&");
}

/** The shared WHERE-builder — export never disagrees with the screen
 *  (sealed plan item 4). Time bounds are added by the caller. */
export function buildUsageCensus(filters = {}) {
  const clauses = [];
  const params = [];
  if (filters.provider) { clauses.push("provider = ?"); params.push(filters.provider); }
  if (filters.model) { clauses.push("model = ?"); params.push(filters.model); }
  if (filters.keyId) { clauses.push("keyId = ?"); params.push(filters.keyId); }
  if (filters.endpoint) { clauses.push("endpoint = ?"); params.push(filters.endpoint); }
  if (filters.statusClass) { clauses.push("statusClass = ?"); params.push(filters.statusClass); }
  if (filters.q) {
    const like = `%${escapeLike(String(filters.q).slice(0, 100))}%`; // 100-char cap (phase13)
    clauses.push(`(model LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\' OR endpoint LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  return { clauses, params };
}

function censusWithWindow(filters, startMs, endMs) {
  const census = buildUsageCensus(filters);
  const clauses = ["timestamp >= ?", "timestamp < ?", ...census.clauses];
  const params = [iso(startMs), iso(endMs), ...census.params];
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

// ─── getFilteredSeries ─────────────────────────────────────────────────────

/** ≤3d: one indexed range scan, GROUP BY time bucket (JS-side bucketing). */
async function seriesExact(db, opts) {
  const { startMs, endMs, bucketMs, metric, where, params } = opts;
  const { where: w, params: p } = where;
  // Portable metrics ride SQL aggregates; cachedTokens has no portable SQL
  // (JSON dialect) → it scans rows and sums in JS (still the indexed range).
  if (metric === "cachedTokens") {
    const rows = await db.all(
      `SELECT timestamp, tokens FROM usageHistory ${w} ORDER BY timestamp ASC`, p
    );
    const buckets = new Map();
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      const b = Math.floor(t / bucketMs) * bucketMs;
      const tok = typeof r.tokens === "string" ? safeJson(r.tokens) : (r.tokens || {});
      buckets.set(b, (buckets.get(b) || 0) + num(tok?.cached_tokens) + num(tok?.cache_read_input_tokens));
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, value]) => ({ t, value }));
  }
  const rows = await db.all(
    `SELECT timestamp, ${METRICS[metric]} AS value FROM usageHistory ${w} GROUP BY timestamp ORDER BY timestamp ASC`, p
  );
  // timestamp is the raw ISO string — bucket it in JS after aggregation.
  const buckets = new Map();
  for (const r of rows) {
    const b = Math.floor(new Date(r.timestamp).getTime() / bucketMs) * bucketMs;
    buckets.set(b, (buckets.get(b) || 0) + num(r.value));
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, value]) => ({ t, value }));
}

/** 7d+: the usageDaily rollup — O(days), never O(rows). Days missing the
 *  rollup fields (pre-008) contribute honestly zero. */
async function seriesFromRollup(db, opts) {
  const { startMs, endMs, bucketMs, metric, filters } = opts;
  const days = await loadDaysInRange(db, startMs, endMs, filters);
  const buckets = new Map();
  for (const { dayData } of days) {
    const dayTotal = rollupDayMetric(dayData, metric, filters);
    if (dayTotal === 0) continue;
    const t = Math.floor(dayData.__dayStartMs / bucketMs) * bucketMs;
    buckets.set(t, (buckets.get(t) || 0) + dayTotal);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, value]) => ({ t, value }));
}

function rollupDayMetric(dayData, metric, filters) {
  const pick = ROLLUP_METRIC_VALUE[metric];
  if (!pick) throw new FilterParamError("metric", metric);
  const dim = filters?.provider ? "byProvider" : filters?.keyId ? "byApiKey" : filters?.model ? "byModel" : filters?.endpoint ? "byEndpoint" : null;
  if (!dim) return pick(dayData);
  const group = dayData[dim];
  if (!group) return 0;
  let total = 0;
  for (const [key, cell] of Object.entries(group)) {
    // Rollup keys are compound ("model|provider", "keyId|model|provider") —
    // the leading segment is the dimension's own value.
    const lead = key.split("|")[0];
    const wanted = dim === "byProvider" ? filters.provider : dim === "byApiKey" ? filters.keyId : dim === "byModel" ? filters.model : filters.endpoint;
    if (dim === "byEndpoint" ? key.startsWith(`${wanted}|`) : lead === wanted) total += pick(cell);
  }
  return total;
}

/** Load usageDaily rows for [startMs, endMs), filtered + annotated with the
 *  day's local start (the rollup writer keys days by local date). */
async function loadDaysInRange(db, startMs, endMs, filters = {}) {
  const startKey = localDateKey(startMs);
  const endKey = localDateKey(endMs);
  const rows = await db.all(
    `SELECT dateKey, data FROM usageDaily WHERE dateKey >= ? AND dateKey <= ? ORDER BY dateKey ASC`,
    [startKey, endKey]
  );
  const out = [];
  for (const r of rows) {
    const dayData = typeof r.data === "string" ? safeJson(r.data) : r.data;
    if (!dayData) continue;
    const dayStartMs = new Date(`${r.dateKey}T00:00:00`).getTime();
    if (dayStartMs >= endMs) continue;
    dayData.__dayStartMs = dayStartMs;
    out.push({ dateKey: r.dateKey, dayData });
  }
  return out;
}

function localDateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

/** Shared entry: resolve period + granularity + metric, pick the tier. */
export async function filteredSeriesImpl(db, { filters = {}, period = "7d", granularity = "1d", metric = "requests", now = Date.now() } = {}) {
  if (!METRICS[metric] && metric !== "cachedTokens") throw new FilterParamError("metric", metric);
  if (!Object.prototype.hasOwnProperty.call(GRANULARITIES, granularity)) throw new FilterParamError("granularity", granularity);
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  const bucketMs = GRANULARITIES[granularity];
  const opts = { startMs, endMs, bucketMs, metric, filters, where: censusWithWindow(filters, startMs, endMs) };
  const points = endMs - startMs <= EXACT_WINDOW_MS
    ? await seriesExact(db, opts)
    : await seriesFromRollup(db, opts);
  return { points, meta: { source: endMs - startMs <= EXACT_WINDOW_MS ? "usageHistory" : "usageDaily", granularity, startMs, endMs } };
}

// ─── getBreakdown ───────────────────────────────────────────────────────────

export async function breakdownImpl(db, { filters = {}, period = "7d", dimension = "provider", metric = "cost", now = Date.now() } = {}) {
  if (!DIMENSIONS[dimension]) throw new FilterParamError("dimension", dimension);
  if (!METRICS[metric] && metric !== "cachedTokens") throw new FilterParamError("metric", metric);
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  const col = DIMENSIONS[dimension];

  if (endMs - startMs > EXACT_WINDOW_MS) {
    // Rollup tier: aggregate the JSON counters per dimension lead.
    const days = await loadDaysInRange(db, startMs, endMs, filters);
    const groupField = dimension === "provider" ? "byProvider" : dimension === "model" ? "byModel" : dimension === "keyId" ? "byApiKey" : "byEndpoint";
    const pick = ROLLUP_METRIC_VALUE[metric] || (() => 0);
    const acc = new Map();
    for (const { dayData } of days) {
      const group = dayData[groupField];
      if (!group) continue;
      for (const [key, cell] of Object.entries(group)) {
        const lead = key.split("|")[0];
        acc.set(lead, (acc.get(lead) || 0) + pick(cell));
      }
    }
    const items = [...acc.entries()].map(([value, v]) => ({ [dimension]: value, value: round6(v) }));
    items.sort((a, b) => b.value - a.value);
    return { items, meta: { source: "usageDaily", dimension, metric, startMs, endMs } };
  }

  const { where, params } = censusWithWindow(filters, startMs, endMs);
  if (metric === "cachedTokens") {
    // No portable JSON SQL — JS scan of the indexed range (exact tier only).
    const rows = await db.all(`SELECT ${col} AS dim, tokens FROM usageHistory ${where}`, params);
    const acc = new Map();
    for (const r of rows) {
      const tok = typeof r.tokens === "string" ? safeJson(r.tokens) : (r.tokens || {});
      const v = num(tok?.cached_tokens) + num(tok?.cache_read_input_tokens);
      acc.set(r.dim || "", (acc.get(r.dim || "") || 0) + v);
    }
    const items = [...acc.entries()].map(([value, v]) => ({ [dimension]: value, value: round6(v) }));
    items.sort((a, b) => b.value - a.value);
    return { items, meta: { source: "usageHistory", dimension, metric, startMs, endMs } };
  }

  const rows = await db.all(
    `SELECT ${col} AS dim, ${METRICS[metric]} AS value FROM usageHistory ${where} GROUP BY ${col} ORDER BY value DESC`,
    params
  );
  return {
    items: rows.map((r) => ({ [dimension]: r.dim ?? "", value: round6(num(r.value)) })),
    meta: { source: "usageHistory", dimension, metric, startMs, endMs },
  };
}

function round6(v) { return Math.round(v * 1e6) / 1e6; }

// ─── getPercentiles — two-tier honesty ─────────────────────────────────────

export async function percentilesImpl(db, { filters = {}, period = "3d", now = Date.now() } = {}) {
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  if (endMs - startMs <= EXACT_WINDOW_MS) return percentilesExact(db, { filters, startMs, endMs });
  return percentilesFromRollup(db, { filters, startMs, endMs });
}

/** Exact tier — skip-scan walks over the indexed column: COUNT, then one
 *  ORDER BY latencyMs pass with three OFFSET stops (sealed plan item 6). */
async function percentilesExact(db, { filters, startMs, endMs }) {
  const { where, params } = censusWithWindow(filters, startMs, endMs);
  const walk = async (col) => {
    const countRow = await db.get(`SELECT COUNT(${col}) AS n FROM usageHistory ${where} AND ${col} IS NOT NULL`, params);
    const n = num(countRow?.n);
    if (n === 0) return { values: { p50: null, p95: null, p99: null }, count: 0 };
    // Nearest-rank walk: the smallest sample with at least q·n samples ≤ it.
    const stops = PERCENTILES.map(([label, q]) => [label, Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))]);
    const values = {};
    const rows = await db.all(
      `SELECT ${col} AS v FROM usageHistory ${where} AND ${col} IS NOT NULL ORDER BY ${col} ASC`,
      params
    );
    for (const [label, off] of stops) values[label] = rows[off]?.v ?? null;
    return { values, count: n };
  };
  const latency = await walk("latencyMs");
  const ttft = await walk("ttftMs");
  return {
    latency: latency.values,
    ttft: ttft.values,
    meta: { approximate: false, source: "usageHistory", count: latency.count, ttftCount: ttft.count, startMs, endMs },
  };
}

/** Histogram tier — usageDaily latencyBuckets (pre-008 days excluded →
 *  coverage < 1 is surfaced honestly). Approximate, bucket-labeled. */
async function percentilesFromRollup(db, { filters, startMs, endMs }) {
  const days = await loadDaysInRange(db, startMs, endMs, filters);
  const totals = new Array(7).fill(0);
  let daysWithBuckets = 0;
  let dayCount = 0;
  for (const { dayData } of days) {
    dayCount++;
    const buckets = dayData.latencyBuckets;
    if (!buckets) continue; // pre-008 day — excluded from the histogram
    daysWithBuckets++;
    const providerCells = filters.provider ? { [filters.provider]: buckets[filters.provider] || {} } : buckets;
    for (const cell of Object.values(providerCells)) {
      if (!cell) continue;
      for (let b = 0; b < 7; b++) totals[b] += num(cell[`b${b}`]);
    }
  }
  const count = totals.reduce((a, b) => a + b, 0);
  const values = { p50: null, p95: null, p99: null };
  if (count > 0) {
    for (const [label, q] of PERCENTILES) {
      const target = q * count;
      let cum = 0;
      for (let b = 0; b < 7; b++) {
        cum += totals[b];
        if (cum >= target) { values[label] = BUCKET_UPPER_EDGES_MS[b]; break; }
      }
    }
  }
  return {
    latency: values,
    ttft: { p50: null, p95: null, p99: null }, // rollup carries no TTFT histogram (honest gap)
    meta: {
      approximate: true,
      source: "usageDaily.latencyBuckets",
      count,
      coverage: dayCount ? round6(daysWithBuckets / dayCount) : 0,
      startMs,
      endMs,
    },
  };
}

// ─── getProviderHealthFrame — funds the topology halos ─────────────────────

export async function providerHealthFrameImpl(db, { windowMs = 60_000, now = Date.now() } = {}) {
  const startMs = now - windowMs;
  const rows = await db.all(
    `SELECT provider, statusClass, COUNT(*) AS n FROM usageHistory WHERE timestamp >= ? AND timestamp < ? GROUP BY provider, statusClass`,
    [iso(startMs), iso(now)]
  );
  const perProvider = {};
  for (const r of rows) {
    const cell = (perProvider[r.provider || ""] ||= { requests: 0, errors: 0 });
    const n = num(r.n);
    cell.requests += n;
    if (r.statusClass && r.statusClass !== "ok") cell.errors += n;
  }
  return { perProvider, windowMs, ts: startMs };
}

// ─── getKpis — one query, CASE WHEN double-range ───────────────────────────

/** dialect: per-row expressions for the two JSON-backed KPIs (compile-time
 *  constants from each twin — the ONLY engine-specific fragments). */
export async function kpisImpl(db, { filters = {}, period = "24h", now = Date.now(), dialect } = {}) {
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  const windowLen = Math.max(1, endMs - startMs);
  const prevStartMs = startMs - windowLen;
  const census = buildUsageCensus(filters);
  const where = `WHERE timestamp >= ? AND timestamp < ?${census.clauses.length ? " AND " + census.clauses.join(" AND ") : ""}`;
  const params = [iso(prevStartMs), iso(endMs), ...census.params];
  const cur = "timestamp >= ? AND timestamp < ?";
  const prev = "timestamp >= ? AND timestamp < ?";
  const curParams = [iso(startMs), iso(endMs)];
  const prevParams = [iso(prevStartMs), iso(startMs)];
  // 12 CASE expressions (six cur then six prev), one window predicate each —
  // params in exact placeholder order, never a repeated-block shortcut.
  const windowSeq = [
    ...curParams, ...curParams, ...curParams, ...curParams, ...curParams, ...curParams,
    ...prevParams, ...prevParams, ...prevParams, ...prevParams, ...prevParams, ...prevParams,
  ];
  const row = await db.get(
    `SELECT
       SUM(CASE WHEN ${cur} THEN 1 ELSE 0 END) AS curRequests,
       SUM(CASE WHEN ${cur} THEN cost ELSE 0 END) AS curCost,
       SUM(CASE WHEN ${cur} THEN promptTokens ELSE 0 END) AS curPrompt,
       SUM(CASE WHEN ${cur} THEN completionTokens ELSE 0 END) AS curCompletion,
       SUM(CASE WHEN ${cur} THEN ${dialect.cachedRowExpr} ELSE 0 END) AS curCached,
       SUM(CASE WHEN ${cur} THEN ${dialect.rtkRowExpr} ELSE 0 END) AS curRtk,
       SUM(CASE WHEN ${prev} THEN 1 ELSE 0 END) AS prevRequests,
       SUM(CASE WHEN ${prev} THEN cost ELSE 0 END) AS prevCost,
       SUM(CASE WHEN ${prev} THEN promptTokens ELSE 0 END) AS prevPrompt,
       SUM(CASE WHEN ${prev} THEN completionTokens ELSE 0 END) AS prevCompletion,
       SUM(CASE WHEN ${prev} THEN ${dialect.cachedRowExpr} ELSE 0 END) AS prevCached,
       SUM(CASE WHEN ${prev} THEN ${dialect.rtkRowExpr} ELSE 0 END) AS prevRtk
     FROM usageHistory ${where}`,
    [...windowSeq, ...params]
  );
  const kpi = (curV, prevV) => {
    const c = round6(num(curV));
    const p = round6(num(prevV));
    return { value: c, previous: p, delta: round6(c - p) };
  };
  return {
    requests: kpi(row?.curRequests, row?.prevRequests),
    cost: kpi(row?.curCost, row?.prevCost),
    promptTokens: kpi(row?.curPrompt, row?.prevPrompt),
    completionTokens: kpi(row?.curCompletion, row?.prevCompletion),
    cachedTokens: kpi(row?.curCached, row?.prevCached),
    rtkSavedCostUsd: kpi(row?.curRtk, row?.prevRtk), // estimated — funded at write time
    meta: { period, startMs, endMs, prevStartMs },
  };
}

// ─── getLedgerRows — keyset-paginated, enriched ────────────────────────────

const LEDGER_PAGE_MAX = 200;

export async function ledgerRowsImpl(db, { filters = {}, period = "7d", sort = "timestamp", order = "desc", after = null, limit = 50, now = Date.now(), repos = "./repos/sqlite" } = {}) {
  if (!SORTABLE_COLUMNS[sort]) throw new FilterParamError("sort", sort);
  const dir = order === "asc" ? "ASC" : "DESC";
  const lim = Math.max(1, Math.min(LEDGER_PAGE_MAX, Math.floor(limit) || 50));
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  const census = buildUsageCensus(filters);
  const clauses = ["timestamp >= ?", "timestamp < ?", ...census.clauses];
  const params = [iso(startMs), iso(endMs), ...census.params];

  // Keyset continuation on (sortCol NULLS LAST, id) — strictly deeper than
  // the cursor. The cursor carries the sort column's OWN value (v), because a
  // timestamp-cursor is wrong the moment any other column sorts.
  const sortCol = SORTABLE_COLUMNS[sort];
  const cmp = dir === "DESC" ? "<" : ">";
  if (after && after.v !== undefined && Number.isFinite(Number(after.id))) {
    if (after.v === null) {
      // Cursor sits in the NULL region — only NULL siblings deeper by id.
      clauses.push(`(${sortCol} IS NULL AND id ${cmp} ?)`);
      params.push(Number(after.id));
    } else {
      clauses.push(`(${sortCol} ${cmp} ? OR ${sortCol} IS NULL OR (${sortCol} = ? AND id ${cmp} ?))`);
      params.push(after.v, after.v, Number(after.id));
    }
  }

  const rows = await db.all(
    `SELECT id, timestamp, provider, model, connectionId, keyId, keyPrefix, endpoint,
            promptTokens, completionTokens, cost, status, statusClass, latencyMs, ttftMs, httpStatus, tokens, meta
     FROM usageHistory
     WHERE ${clauses.join(" AND ")}
     ORDER BY CASE WHEN ${sortCol} IS NULL THEN 1 ELSE 0 END, ${sortCol} ${dir}, id ${dir}
     LIMIT ?`,
    [...params, lim]
  );

  const enrich = await getUsageEnrichment(repos);
  const items = rows.map((r) => buildLedgerRow(r, enrich));
  const last = rows[rows.length - 1];
  const nextCursor = items.length === lim ? { v: last[sort] ?? null, id: last.id } : null;
  return { items, nextCursor, meta: { sort, order: dir === "ASC" ? "asc" : "desc", limit: lim, startMs, endMs } };
}

function buildLedgerRow(r, enrich) {
  const tokens = typeof r.tokens === "string" ? safeJson(r.tokens) : (r.tokens || {});
  const meta = typeof r.meta === "string" ? safeJson(r.meta) : (r.meta || {});
  const keyInfo = r.keyId ? enrich.apiKeyMap[r.keyId] : null;
  return {
    id: r.id,
    timestamp: r.timestamp,
    provider: r.provider || "",
    providerDisplayName: enrich.providerNodeNameMap[r.provider] || r.provider || "",
    model: r.model || "",
    connectionId: r.connectionId || "",
    accountName: r.connectionId ? (enrich.connectionMap[r.connectionId] || `Account ${String(r.connectionId).slice(0, 8)}...`) : null,
    keyId: r.keyId || "",
    keyName: keyInfo?.name ?? null,
    keyPrefix: r.keyPrefix || keyInfo?.keyPrefix || null,
    endpoint: r.endpoint || null,
    promptTokens: num(r.promptTokens),
    completionTokens: num(r.completionTokens),
    cachedTokens: num(tokens?.cached_tokens) + num(tokens?.cache_read_input_tokens),
    cost: round6(num(r.cost)),
    status: r.status || null,
    statusClass: r.statusClass ?? "",
    latencyMs: r.latencyMs ?? null,
    ttftMs: r.ttftMs ?? null,
    httpStatus: r.httpStatus ?? null,
    rtk: meta?.rtk ? { bytesSaved: num(meta.rtk.bytesSaved), tokensSavedEst: meta.rtk.tokensSavedEst ?? null } : null,
    rtkSavedCostUsd: meta?.rtkSavedCostUsd ?? null,
  };
}

// ─── getExportCursor — the screen and the export never disagree ────────────

/** Async iterator over the same census the screen uses — keyset batches,
 *  hard row cap as the DoS rail (phase13). */
export async function* exportCursorImpl(db, { filters = {}, period = "60d", sort = "timestamp", order = "desc", now = Date.now(), repos = "./repos/sqlite", cap = EXPORT_ROW_CAP } = {}) {
  if (!SORTABLE_COLUMNS[sort]) throw new FilterParamError("sort", sort);
  const dir = order === "asc" ? "ASC" : "DESC";
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  const enrich = await getUsageEnrichment(repos);
  let after = null;
  let yielded = 0;
  const BATCH = 5000;
  while (yielded < cap) {
    const page = await ledgerRowsImpl(db, {
      filters, period, sort, order, after, limit: Math.min(BATCH, cap - yielded), now, repos,
    });
    for (const item of page.items) {
      yield item;
      yielded++;
      if (yielded >= cap) break;
    }
    if (!page.nextCursor || page.items.length === 0) return;
    after = page.nextCursor;
  }
}
