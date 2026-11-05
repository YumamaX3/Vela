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
import { evaluateInsights } from "../usageInsights.js";

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

/** One window of the series — picks the tier (exact ≤3d / rollup 7d+) and
 *  returns {points, source}. Extracted so the compare ghost can run the SAME
 *  tier over the previous window without duplicating the tier logic. */
async function seriesForWindow(db, { startMs, endMs, bucketMs, metric, filters }) {
  const opts = { startMs, endMs, bucketMs, metric, filters, where: censusWithWindow(filters, startMs, endMs) };
  if (endMs - startMs <= EXACT_WINDOW_MS) {
    return { points: await seriesExact(db, opts), source: "usageHistory" };
  }
  return { points: await seriesFromRollup(db, opts), source: "usageDaily" };
}

/** Shared entry: resolve period + granularity + metric, pick the tier.
 *
 *  W3-E compare ghost: when `previous` is true, ALSO run the equal-length
 *  window immediately before the current one ([startMs−len, startMs) — the
 *  same window kpisImpl's Δ columns use) through the same tier, then align it
 *  onto the current axis bucket-for-bucket: the current bucket at time `t`
 *  pairs with the previous bucket at `t − len`. When `len` is not a whole
 *  multiple of the bucket size ("today") the lookup misses and those buckets
 *  degrade to an honest `null` gap — never a shifted lie. "all" and empty
 *  windows have no previous window → `previous: []`. */
export async function filteredSeriesImpl(db, { filters = {}, period = "7d", granularity = "1d", metric = "requests", previous = false, now = Date.now() } = {}) {
  if (!METRICS[metric] && metric !== "cachedTokens") throw new FilterParamError("metric", metric);
  if (!Object.prototype.hasOwnProperty.call(GRANULARITIES, granularity)) throw new FilterParamError("granularity", granularity);
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  const bucketMs = GRANULARITIES[granularity];

  const cur = await seriesForWindow(db, { startMs, endMs, bucketMs, metric, filters });
  const meta = { source: cur.source, granularity, startMs, endMs };

  if (!previous) return { points: cur.points, meta };

  const windowLen = endMs - startMs;
  if (startMs <= 0 || windowLen <= 0) {
    return { points: cur.points, previous: [], meta: { ...meta, prevStartMs: null, prevEndMs: null } };
  }
  const prevStartMs = startMs - windowLen;
  const prevEndMs = startMs;
  const prev = await seriesForWindow(db, { startMs: prevStartMs, endMs: prevEndMs, bucketMs, metric, filters });
  const prevByBucket = new Map(prev.points.map((p) => [p.t, p.value]));
  const aligned = cur.points.map((p) => ({
    t: p.t,
    value: prevByBucket.has(p.t - windowLen) ? prevByBucket.get(p.t - windowLen) : null,
  }));
  return {
    points: cur.points,
    previous: aligned,
    meta: { ...meta, prevStartMs, prevEndMs },
  };
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
    const acc = new Map();
    if (dimension === "statusClass") {
      // statusClass has no byStatusClass day-group — fund it from the
      // statusByProvider telemetry counters (request counts only). A non-
      // requests metric has no rollup source at this dimension → refuse loud
      // rather than fabricate cost/token-per-status.
      if (metric !== "requests") throw new FilterParamError("metric", metric);
      for (const { dayData } of days) {
        for (const [status, count] of dayStatusCounts(dayData)) {
          acc.set(status, (acc.get(status) || 0) + count);
        }
      }
    } else {
      const groupField = dimension === "provider" ? "byProvider" : dimension === "model" ? "byModel" : dimension === "keyId" ? "byApiKey" : "byEndpoint";
      const pick = ROLLUP_METRIC_VALUE[metric] || (() => 0);
      for (const { dayData } of days) {
        const group = dayData[groupField];
        if (!group) continue;
        for (const [key, cell] of Object.entries(group)) {
          const lead = key.split("|")[0];
          acc.set(lead, (acc.get(lead) || 0) + pick(cell));
        }
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

// ─── getStackedSeries — time × dimension, top-N + Other ────────────────────
// Funds the Overview deck's stacked areas (Row C traffic/cost by provider) and
// the Analytics deck's UsageByKey/ErrorMix. ONE engine copy, both tiers: ≤3d an
// exact indexed scan bucketed in JS; 7d+ the usageDaily rollup day-groups
// (O(days), never O(rows)). Top-N keys keep their own series; the long tail
// folds into a single "Other" series so the chart stays legible.

export const STACKED_TOP_N = 6; // sealed plan Deck-1 Row C: top-6 + Other

/** Rollup day-group field per dimension (the writers' compound-key covenant —
 *  the leading segment of every key is the dimension's OWN value). statusClass
 *  has no counter group; it rides statusByProvider instead (see dayStatusCounts). */
const ROLLUP_STACK_GROUP = Object.freeze({
  provider: "byProvider",
  model: "byModel",
  keyId: "byApiKey",
  endpoint: "byEndpoint",
});

/** The day's per-status request counts from statusByProvider — ok plus each
 *  individual non-ok class. `errors` is the sum of those classes, so it is
 *  skipped to keep the partition honest (never double-counted). */
function dayStatusCounts(dayData) {
  const out = new Map();
  const sp = dayData.statusByProvider;
  if (!sp) return out;
  for (const cell of Object.values(sp)) {
    if (!cell) continue;
    if (cell.ok) out.set("ok", (out.get("ok") || 0) + cell.ok);
    for (const [k, v] of Object.entries(cell)) {
      if (k === "ok" || k === "errors") continue;
      out.set(k, (out.get(k) || 0) + num(v));
    }
  }
  return out;
}

/** ≤3d: one indexed range scan, grouped by (time bucket × dimension lead). */
async function stackedExact(db, { filters, startMs, endMs, bucketMs, metric, col }) {
  const { where, params } = censusWithWindow(filters, startMs, endMs);
  const acc = new Map(); // dim -> Map(bucket -> sum)
  const add = (dim, bucket, v) => {
    let m = acc.get(dim);
    if (!m) { m = new Map(); acc.set(dim, m); }
    m.set(bucket, (m.get(bucket) || 0) + v);
  };
  if (metric === "cachedTokens") {
    // No portable JSON SQL — JS scan of the indexed range (exact tier only).
    const rows = await db.all(`SELECT timestamp, ${col} AS dim, tokens FROM usageHistory ${where}`, params);
    for (const r of rows) {
      const b = Math.floor(new Date(r.timestamp).getTime() / bucketMs) * bucketMs;
      const tok = typeof r.tokens === "string" ? safeJson(r.tokens) : (r.tokens || {});
      add(r.dim ?? "", b, num(tok?.cached_tokens) + num(tok?.cache_read_input_tokens));
    }
    return acc;
  }
  const rows = await db.all(
    `SELECT timestamp, ${col} AS dim, ${METRICS[metric]} AS value FROM usageHistory ${where} GROUP BY timestamp, ${col} ORDER BY timestamp ASC`,
    params
  );
  for (const r of rows) {
    const b = Math.floor(new Date(r.timestamp).getTime() / bucketMs) * bucketMs;
    add(r.dim ?? "", b, num(r.value));
  }
  return acc;
}

/** 7d+: walk the usageDaily day-groups — O(days). The dimension's OWN filter
 *  is honored (consistent with rollupDayMetric); cross-dimension filters ride
 *  the rollup shape's existing fidelity (same precedent as breakdownImpl). */
async function stackedFromRollup(db, { filters, startMs, endMs, bucketMs, metric, dimension }) {
  const days = await loadDaysInRange(db, startMs, endMs, filters);
  const acc = new Map(); // dim -> Map(bucket -> sum)
  const add = (dim, bucket, v) => {
    let m = acc.get(dim);
    if (!m) { m = new Map(); acc.set(dim, m); }
    m.set(bucket, (m.get(bucket) || 0) + v);
  };
  if (dimension === "statusClass") {
    // Only request counts survive the rollup at this dimension.
    if (metric !== "requests") throw new FilterParamError("metric", metric);
    for (const { dayData } of days) {
      const bucket = Math.floor(dayData.__dayStartMs / bucketMs) * bucketMs;
      for (const [status, count] of dayStatusCounts(dayData)) {
        if (filters.statusClass && status !== filters.statusClass) continue;
        add(status, bucket, count);
      }
    }
    return acc;
  }
  const groupField = ROLLUP_STACK_GROUP[dimension];
  if (!groupField) throw new FilterParamError("dimension", dimension);
  const pick = ROLLUP_METRIC_VALUE[metric];
  if (!pick) throw new FilterParamError("metric", metric);
  const ownFilter = dimension === "provider" ? filters.provider
    : dimension === "model" ? filters.model
    : dimension === "keyId" ? filters.keyId
    : filters.endpoint;
  for (const { dayData } of days) {
    const group = dayData[groupField];
    if (!group) continue;
    const bucket = Math.floor(dayData.__dayStartMs / bucketMs) * bucketMs;
    for (const [key, cell] of Object.entries(group)) {
      const lead = key.split("|")[0];
      if (ownFilter && lead !== ownFilter) continue;
      add(lead, bucket, pick(cell));
    }
  }
  return acc;
}

/** Fold the (dim → bucket → sum) accumulator into top-N + Other series. */
function shapeStacked(acc, { dimension, metric, granularity, source, startMs, endMs }) {
  const totals = [...acc.entries()].map(([key, buckets]) => ({
    key,
    total: [...buckets.values()].reduce((a, b) => a + b, 0),
    buckets,
  })).sort((a, b) => b.total - a.total);

  const pointsOf = (buckets) => [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, value]) => ({ t, value: round6(value) }));

  const series = totals.slice(0, STACKED_TOP_N).map(({ key, total, buckets }) => ({
    key, total: round6(total), points: pointsOf(buckets),
  }));

  const rest = totals.slice(STACKED_TOP_N);
  if (rest.length) {
    const otherBuckets = new Map();
    let otherTotal = 0;
    for (const { total, buckets } of rest) {
      otherTotal += total;
      for (const [t, v] of buckets) otherBuckets.set(t, (otherBuckets.get(t) || 0) + v);
    }
    series.push({ key: "Other", total: round6(otherTotal), points: pointsOf(otherBuckets) });
  }

  return {
    series,
    meta: { source, dimension, metric, granularity, topN: STACKED_TOP_N, startMs, endMs },
  };
}

/** Shared entry: resolve period + granularity + metric + dimension, pick tier. */
export async function stackedSeriesImpl(db, { filters = {}, period = "7d", dimension = "provider", granularity = "1d", metric = "requests", now = Date.now() } = {}) {
  if (!DIMENSIONS[dimension]) throw new FilterParamError("dimension", dimension);
  if (!METRICS[metric] && metric !== "cachedTokens") throw new FilterParamError("metric", metric);
  if (!Object.prototype.hasOwnProperty.call(GRANULARITIES, granularity)) throw new FilterParamError("granularity", granularity);
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  const bucketMs = GRANULARITIES[granularity];
  const col = DIMENSIONS[dimension];
  const exact = endMs - startMs <= EXACT_WINDOW_MS;
  const acc = exact
    ? await stackedExact(db, { filters, startMs, endMs, bucketMs, metric, col })
    : await stackedFromRollup(db, { filters, startMs, endMs, bucketMs, metric, dimension });
  return shapeStacked(acc, {
    dimension, metric, granularity,
    source: exact ? "usageHistory" : "usageDaily",
    startMs, endMs,
  });
}

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

// ─── getUsageStats' SQL seams — the dashboard coalescing mend (P5) ────────
// Response campaign P5 (plans/2026-11-01-responsive-tide-performance.md §III:
// "getUsageStats coalescing … SQL-aggregate today's KPIs instead of JS loops
// where the schema allows"). getUsageStats' heavy arms used to fold a full
// window scan ROW BY ROW in JS; these seams push the grouping into the
// engine in the getKpis SUM(CASE …) shape above — the counting in SQL, the
// JS side reduced to naming and cell assembly.
//
// CORRECTNESS LAW: a seam may move WHERE the arithmetic happens, never its
// answer. The P5 pin (tests/unit/usage-stats-sql-p5.test.js) proves it on a
// seeded fixture against a frozen copy of the pre-mend JS. What shaped the SQL:
//
//   • Cached tokens. The JS reads `cached_tokens || cache_read_input_tokens
//     || 0` — a FALLBACK chain, never a sum (HEAD :757): cache_read fills in
//     only when cached_tokens is absent/null. The SQL carries the same
//     fallback as ONE dialect expression — COALESCE(CAST(cached AS INTEGER),
//     CAST(read AS INTEGER), 0) — SUM'd once. (An earlier draft summed the
//     two terms; the pin's 22-vs-17 caught it.)
//   • SQLite int64 wraparound (MEASURED, not assumed): json_extract yields
//     INTEGER (int64), and `int64 + int64` OVERFLOWS SILENTLY on SQLite
//     (2^60 + 2^60 → −2^61, handed back as a float; SQLite 3.53.2). With the
//     fallback law each row contributes at most ONE term, so a plain int64
//     SUM from 0 cannot wrap for any real input, and the JS join needs no
//     second sum. (The pin still seeds the overflowing pair to hold the
//     refusal law where sums appear.)
//   • Ordering. The JS walks `WHERE timestamp >= ?` in row order and keeps
//     the FIRST row's display cells; the identity seam pins first-seen with
//     MIN(id) and walks its groups in that order.
//   • Presence. The identity maps (byModel/byAccount/byApiKey/byEndpoint)
//     still materialize ONLY from the exact history arm ("today"/"24h"),
//     never from the usageDaily rollup — a grouped key exists iff history has
//     a row in the window.

/** One statement's SUM(CASE …) columns over the bounded window. Every sum
 *  rides the ONE `timestamp >= ?` predicate, so each statement binds exactly
 *  one parameter (the prefix); plain SUMs and CASE'd SUMs leave every empty
 *  window a numeric 0, never NULL. */
const statsSumColumns = (d) => `
  SUM(CASE WHEN timestamp >= ? THEN promptTokens ELSE 0 END) AS promptTokens,
  SUM(CASE WHEN timestamp >= ? THEN completionTokens ELSE 0 END) AS completionTokens,
  SUM(CASE WHEN timestamp >= ? THEN COALESCE(CAST(${d.cachedTokens} AS INTEGER), CAST(${d.cacheReadTokens} AS INTEGER), 0) ELSE 0 END) AS cachedSum,
  SUM(CASE WHEN timestamp >= ? THEN cost ELSE 0 END) AS cost`;

/** Totals + byProvider in TWO engine statements over the same window: the
 *  grand-total aggregates (no GROUP BY) and `GROUP BY provider`. The '' group
 *  (migration 004 "unset") keeps the NULL key the JS live arm always used.
 *  `excludeProvider` is a compile-time twin constant (see the sqlite twin). */
export async function statsHistorySumsImpl(db, { since, dialect, excludeProvider = null } = {}) {
  const sel = statsSumColumns(dialect);
  const notP = excludeProvider == null ? "" : ` AND provider <> ?`;
  const ex = excludeProvider == null ? [] : [excludeProvider];
  const row = (await db.get(
    `SELECT COUNT(*) AS requests, ${sel} FROM usageHistory WHERE timestamp >= ?${notP}`,
    [since, since, since, since, since, ...ex]
  )) || {};
  const provRows = (await db.all(
    `SELECT provider, COUNT(*) AS requests, ${sel} FROM usageHistory WHERE timestamp >= ? GROUP BY provider`,
    [since, since, since, since, since]
  )) || [];
  const byProvider = {};
  for (const p of provRows) {
    if (!p.requests) continue;
    if (excludeProvider != null && p.provider === excludeProvider) continue;
    byProvider[p.provider] = {
      requests: num(p.requests),
      promptTokens: num(p.promptTokens),
      completionTokens: num(p.completionTokens),
      cachedTokens: num(p.cachedSum), // the fallback chain, summed once
      cost: num(p.cost),
    };
  }
  return {
    totals: {
      requests: num(row.requests),
      promptTokens: num(row.promptTokens),
      completionTokens: num(row.completionTokens),
      cachedTokens: num(row.cachedSum), // the fallback chain, summed once
      cost: num(row.cost),
    },
    byProvider,
  };
}

/** The exact arm's four identity dimensions — ONE GROUP BY over the walk's
 *  OWN key (model · provider · connectionId · keyId · keyPrefix · endpoint).
 *  Groups walk in first-seen order (MIN(id)); `lastUsed` is MAX(timestamp) —
 *  HEAD's per-row max-fold (:785), the last stamp the walk left behind. */
export async function statsDimensionsImpl(db, { since, dialect } = {}) {
  const key = "model, provider, connectionId, keyId, keyPrefix, endpoint";
  // cachedSum carries HEAD's fallback law (cached_tokens || cache_read || 0),
  // same expression as the sums seam; lastUsed is MAX(timestamp) — HEAD's
  // per-row max-fold over the group (:785).
  const cachedCol = dialect
    ? `COALESCE(CAST(${dialect.cachedTokens} AS INTEGER), CAST(${dialect.cacheReadTokens} AS INTEGER), 0)`
    : "0";
  const rows = (await db.all(
    `SELECT ${key}, MIN(id) AS firstId, COUNT(*) AS requests,
            SUM(promptTokens) AS promptTokens, SUM(completionTokens) AS completionTokens,
            SUM(CASE WHEN timestamp >= ? THEN COALESCE(CAST(${cachedCol} AS INTEGER), 0) ELSE 0 END) AS cachedSum,
            SUM(cost) AS cost, MAX(timestamp) AS lastUsed
     FROM usageHistory WHERE timestamp >= ? GROUP BY ${key}`,
    [since, since]
  )) || [];
  return rows
    .filter((r) => num(r.requests) > 0)
    .sort((a, b) => Number(a.firstId) - Number(b.firstId))
    .map((r) => ({
      model: r.model, provider: r.provider, connectionId: r.connectionId,
      keyId: r.keyId, keyPrefix: r.keyPrefix, endpoint: r.endpoint,
      requests: num(r.requests),
      promptTokens: num(r.promptTokens),
      completionTokens: num(r.completionTokens),
      cachedTokens: num(r.cachedSum),
      cost: num(r.cost),
      lastUsed: r.lastUsed,
    }));
}

/** The 10-minute strip — one GROUP BY the bucket cells (the slot arithmetic
 *  itself stays JS-side: local-minute boundaries are the caller's clock). */
export async function statsMinuteRowsImpl(db, { from, to } = {}) {
  const rows = (await db.all(
    `SELECT timestamp, COUNT(*) AS requests, promptTokens, completionTokens, cost
     FROM usageHistory WHERE timestamp >= ? AND timestamp <= ?
     GROUP BY timestamp, promptTokens, completionTokens, cost`,
    [from, to]
  )) || [];
  return rows.map((r) => ({
    ts: r.timestamp,
    requests: num(r.requests),
    promptTokens: num(r.promptTokens),
    completionTokens: num(r.completionTokens),
    cost: num(r.cost),
  }));
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
  // W4-C — one bounded IN query per ledger page (never per row). Fail-open:
  // a tags twin hiccup leaves every row an honest [] — the ledger never dies
  // for an annotation.
  let tagMap = new Map();
  if (rows.length && enrich.tagsRepo) {
    try { tagMap = await enrich.tagsRepo.getTagsForUsageIds(rows.map((r) => r.id)); } catch { /* fail-open */ }
  }
  const items = rows.map((r) => buildLedgerRow(r, enrich, tagMap));
  const last = rows[rows.length - 1];
  const nextCursor = items.length === lim ? { v: last[sort] ?? null, id: last.id } : null;
  return { items, nextCursor, meta: { sort, order: dir === "ASC" ? "asc" : "desc", limit: lim, startMs, endMs } };
}

function buildLedgerRow(r, enrich, tagMap) {
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
    // W4-C — operator-authored annotations; escape-on-render (React) and
    // CSV-safe (formula-guarded csvCell) ride the display layers.
    tags: (tagMap && tagMap.get(r.id)) || [],
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

// ─── Usage Observatory W4-B — auto-insights (the Lookout) ───────────────────
// Engine-neutral orchestrator: pre-fetches the four feeds the signal registry
// evaluates (kpis double-range, statusClass breakdown, provider cost, p95
// latency) and hands them to the pure evaluator in usageInsights.js. Each
// feed rides the SAME window + census the decks use, so an insight is always
// about what the Compass is looking at right now.
//
// The latency feed is column-guarded honestly: pre-008 rows have NULL
// latencyMs, so percentiles' own count gate decides whether the signal may
// speak (minLatencySample in usageInsights.js). The statusClass breakdown
// excludes unclassified rows at the evaluator ("" never counts).
//
// All four feeds resolve independently — a feed that throws (e.g. a missing
// rollup day) degrades to null, and the registry treats null feeds as quiet.
// The ONE exception that must never be swallowed: a FilterParamError — the
// caller's identifier was invalid, and the API layer maps that to an honest
// 400, not a silent quiet-state.
async function fetchFeed(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof FilterParamError) throw e;
    return null; // a broken feed must never sink the strip
  }
}

export async function insightsImpl(db, { filters = {}, period = "24h", now = Date.now(), dialect } = {}) {
  const base = { filters, period, now };
  const [kpis, statusBreakdown, providerCost, latency] = await Promise.all([
    fetchFeed(() => kpisImpl(db, { ...base, dialect })),
    fetchFeed(() => breakdownImpl(db, { ...base, dimension: "statusClass", metric: "requests" })),
    fetchFeed(() => breakdownImpl(db, { ...base, dimension: "provider", metric: "cost" })),
    fetchFeed(() => percentilesImpl(db, base)),
  ]);
  const insights = evaluateInsights({ kpis, statusBreakdown, providerCost, latency });
  return { insights, meta: { period, count: insights.length } };
}

// ─── Usage Observatory W4-D — provider health timeline strips ───────────────
// Uptime-style daily strips on the Analytics deck: one strip per provider,
// one cell per day — ok green, errors carry the dominant class's color, and
// a day with no traffic stays honestly hollow. Both tiers ride the SAME
// window + census the decks use: ≤3d walks usageHistory with LOCAL-day
// buckets (the rollup writer keys days by local date — the exact tier must
// bucket identically or the two tiers would disagree at the boundary), 7d+
// reads the usageDaily.statusByProvider rollup (O(days), never O(rows)).
//
// The statusClass census applies to the exact tier alone — pre-aggregated
// rollup days can't filter by status (the same fidelity precedent as
// stackedFromRollup's cross-dimension filters). Pre-008 days have no
// statusByProvider telemetry; those cells stay hollow — collecting, never
// fabricated.

/** Local-day key (YYYY-MM-DD) — the rollup writer's own convention. */
function w4dLocalDayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Roll the day's statusByProvider cell into the provider's daily counter. */
function w4dRollCell(counter, cell) {
  const ok = num(cell?.ok);
  const errors = num(cell?.errors);
  counter.requests += ok + errors;
  counter.errors += errors;
  for (const [k, v] of Object.entries(cell || {})) {
    if (k === "ok" || k === "errors") continue;
    counter.classes[k] = (counter.classes[k] || 0) + num(v);
  }
}

export const HEALTH_TIMELINE_MAX_DAYS = 92; // never an unbounded strip
export const HEALTH_TIMELINE_MAX_PROVIDERS = 20; // legibility rail

/** Engine-neutral timeline builder. `repos` is the twin-relative enrichment
 *  harbor ("./repos/sqlite" | "./repos/mysql") — same law as the ledger. */
export async function healthTimelineImpl(db, { filters = {}, period = "7d", now = Date.now(), repos = "./repos/sqlite" } = {}) {
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  const dayMs = 86_400_000;

  // The day axis — local calendar days touched by the window, oldest first.
  const days = [];
  const firstKey = w4dLocalDayKey(startMs);
  let cursor = new Date(`${firstKey}T00:00:00`).getTime();
  const endKey = w4dLocalDayKey(endMs);
  while (cursor <= endMs && days.length < HEALTH_TIMELINE_MAX_DAYS) {
    days.push({ key: w4dLocalDayKey(cursor), startMs: cursor });
    cursor += dayMs;
  }
  // Belt: the axis never overshoots (local-day arithmetic is exact, but the
  // guard makes the cap a fact rather than a hope).
  if (days.length && days[days.length - 1].key > endKey) days.pop();

  // provider -> dayKey -> { requests, errors, classes: {} }
  const perProvider = new Map();
  const counterFor = (provider, dayKey) => {
    let m = perProvider.get(provider);
    if (!m) { m = new Map(); perProvider.set(provider, m); }
    let c = m.get(dayKey);
    if (!c) { c = { requests: 0, errors: 0, classes: {} }; m.set(dayKey, c); }
    return c;
  };

  const exact = endMs - startMs <= EXACT_WINDOW_MS;
  let source;
  if (exact) {
    source = "usageHistory";
    const census = buildUsageCensus(filters);
    const clauses = ["timestamp >= ?", "timestamp < ?", ...census.clauses];
    const params = [iso(startMs), iso(endMs), ...census.params];
    const rows = await db.all(
      `SELECT timestamp, provider, statusClass FROM usageHistory WHERE ${clauses.join(" AND ")}`,
      params
    );
    for (const r of rows) {
      const provider = r.provider || "";
      const c = counterFor(provider, w4dLocalDayKey(new Date(r.timestamp).getTime()));
      c.requests += 1;
      const cls = r.statusClass || "";
      if (cls && cls !== "ok") {
        c.errors += 1;
        c.classes[cls] = (c.classes[cls] || 0) + 1;
      }
    }
  } else {
    source = "usageDaily.statusByProvider";
    // Pre-aggregated days — the statusClass census cannot apply (fidelity
    // precedent: stackedFromRollup honors the dimension's OWN filter only).
    const daysRows = await loadDaysInRange(db, startMs, endMs, {
      provider: filters.provider || undefined,
    });
    for (const { dayData } of daysRows) {
      const dayKey = w4dLocalDayKey(dayData.__dayStartMs);
      const sp = dayData.statusByProvider;
      if (!sp) continue; // pre-telemetry day — hollow cells, honest
      for (const [provider, cell] of Object.entries(sp)) {
        if (!cell) continue;
        // The provider facet rides the rollup tier too (the statusClass census
        // cannot — pre-aggregated days). Same fidelity as stackedFromRollup.
        if (filters.provider && provider !== filters.provider) continue;
        w4dRollCell(counterFor(provider, dayKey), cell);
      }
    }
  }

  // Enrich the provider names the same way the decks do (fail-open).
  const enrich = await getUsageEnrichment(repos).catch(() => null);
  const displayName = (provider) =>
    (enrich && enrich.providerNodeNameMap && enrich.providerNodeNameMap[provider]) || provider || "(unknown)";

  // One strip per provider that touched the window — traffic desc, capped.
  const strips = [...perProvider.entries()]
    .map(([provider, dayMap]) => {
      let total = 0;
      let totalErrors = 0;
      const cells = days.map((d) => {
        const c = dayMap.get(d.key) || null;
        if (!c || c.requests === 0) return { date: d.key, requests: 0, errors: 0, dominant: null };
        total += c.requests;
        totalErrors += c.errors;
        let dominant = null;
        let best = 0;
        for (const [cls, n] of Object.entries(c.classes)) {
          if (n > best) { best = n; dominant = cls; }
        }
        return { date: d.key, requests: c.requests, errors: c.errors, dominant };
      });
      return {
        provider,
        providerDisplayName: displayName(provider),
        totalRequests: total,
        totalErrors,
        cells,
      };
    })
    .filter((s) => s.totalRequests > 0)
    .sort((a, b) => b.totalRequests - a.totalRequests || a.provider.localeCompare(b.provider))
    .slice(0, HEALTH_TIMELINE_MAX_PROVIDERS);

  return {
    strips,
    days: days.map((d) => d.key),
    truncated: perProvider.size > HEALTH_TIMELINE_MAX_PROVIDERS,
    meta: { period, source, startMs, endMs },
  };
}

// ─── Proxy Console Separation W2b — the three telemetry seams ───────────────
// Sealed plan §3.2 · §3.4. Three read projections the /dashboard/proxy console
// needs and the current schema cannot yet answer honestly:
//
//   poolAnalyticsImpl    — the per-pool usage census (requests/errors/tokens/
//                          latency/cost) that funds the Usage lens.
//   healthHistoryImpl    — the per-pool outcome series that funds the Fitness
//                          lens's history, once W2a's append-only table exists.
//   egressHistoryImpl    — the stable IP list per pool that funds the Egress
//                          lens: the PERSISTED proxyPoolEgressHistory ledger
//                          (W2a migration 030) with the in-memory ring as its
//                          fallback when the table is absent.
//
// THE POSTURE LAW (identical to stats and the metrics siblings): every row
// emits integers, timestamps, poolIds, verdicts and IP/country strings — never
// a proxy row, never `proxyUrl`. Safe BY CONSTRUCTION, so the routes can ride
// the posture-read allow-list without a masker; the structural tests pin it.
//
// THE WOUNDS THESE IMPLS MUST NOT PAPER OVER (plan §2):
//   • usageHistory has no `poolId` until W2a's migration 030. preflightUsageSeam
//     probes the column ONCE and CACHES; while absent (or all-NULL) the
//     analytics rows carry `collecting: true` with ZERO counters — the honest
//     empty state the R6 risk demands ("collecting since <migration date>",
//     never a fabricated backfill).
//   • proxyPoolHealthHistory also lands in W2a. healthHistoryImpl reports
//     `collecting: true` until the table exists; once it exists it walks the
//     exact tier (≤3d, bucketed to the local minute) and stays HONEST that it
//     has no rollup tier — older windows simply hold fewer rows, nothing faked.
//   • egress history had no persisted home before W2a — the poolGeo ring is
//     in-memory only (max 8, TTL 1h). egressHistoryImpl now reads W2a's
//     proxyPoolEgressHistory; while that table is absent it reports
//     `collecting:true` with NO entries — the ring's transient samples are NOT
//     smuggled in as pseudo-history (projectEgressHistory remains available for
//     callers that want the live ring, labelled `source:"memory"`).
//
// ENGINE-NEUTRAL: every query is syntax shared by both twins (no sqlite-only
// PRAGMA, no mysql-only information_schema here). Column/table existence is
// decided by the caller's `hasColumn` / `hasTable` probes and injected, so the
// dialect probes stay in the twins where every other engine fragment lives.
// Adapter ops are await-safe — sqlite returns plain values, mysql a Promise;
// awaiting a non-Promise is a no-op, so ONE code path serves both.

/** Single-row probes must not be repeated on every read; a missing column or
 *  table provably exists-or-not for the process lifetime (migrations land at
 *  boot, before the console can serve a request). An explicit test hook lets
 *  providers flip the seam without a restart. */
const ANALYTICS_SEAM_TTL_MS = 60_000;
function usageSeamState() {
  if (!global._velaUsageSeams) {
    global._velaUsageSeams = {
      poolIdColumn: { value: null, ts: 0 },
      healthTable: { value: null, ts: 0 },
      egressTable: { value: null, ts: 0 },
    };
  }
  return global._velaUsageSeams;
}

/** The waterline — the OLDEST attributed row in the window. Pre-030 usage
 *  rows were written without a poolId and cannot be attributed after the fact,
 *  so the Usage lens says "collecting since <ts>" rather than draw a history
 *  it never had (plan R6: honest empty state, never fabricated backfill).
 *  Distinct from the seam probe's `wired` flag, which answers "does the column
 *  exist", not "when did it start carrying truth". */
export async function poolAttributionSince(db) {
  try {
    const row = await db.get(
      `SELECT MIN(timestamp) AS since FROM usageHistory WHERE poolId IS NOT NULL AND poolId <> ''`
    );
    return row?.since || null;
  } catch {
    return null; // no column yet — W2a has not landed, nothing was ever attributed
  }
}

/** True when usageHistory has ACTUALLY BEEN ATTRIBUTED — a `poolId` column that
 *  is present but has never carried a value is not a wire, it is a promise. The
 *  honest reading is "collecting" (plan R6): a fresh gateway that has never
 *  routed through a pool shows an empty Usage lens with a `since:null`, never a
 *  census of zero-only buckets pretending history exists.
 *
 *  WHY NOT "does the column exist": a SELECT of the column succeeds even with
 *  zero attributed rows (COLD ≠ ABSENT), so probing existence made a never-used
 *  harbor read `wired:true` with an empty census — identical on the wire to a
 *  broken one. Counting attributed rows distinguishes the two truths, which is
 *  exactly what the Usage lens must tell apart. Cached (the state object is
 *  dropped by __resetUsageSeams and by a fresh process) so a cold console does
 *  not re-probe on every navigation. A pre-migrate harbor has no column, the
 *  COUNT throws, and the answer is an honest `false`. */
export async function preflightUsageSeam(db) {
  const state = usageSeamState();
  const now = Date.now();
  if (state.poolIdColumn.value !== null && now - state.poolIdColumn.ts < ANALYTICS_SEAM_TTL_MS) {
    return state.poolIdColumn.value;
  }
  let wired = false;
  try {
    // COUNT(poolId) succeeds (returns 0) iff the column EXISTS, regardless of
    // whether any row has been attributed yet — a bare SELECT ... LIMIT 1 on an
    // empty table returns undefined and would misread "present but cold" as
    // "absent". No attribution threshold here: `wired` answers "is the seam
    // there", never "has data flowed". The two are different truths; the census
    // and its `since` waterline report volume, this flag reports the column.
    const probe = await db.get(`SELECT COUNT(poolId) AS n FROM usageHistory`);
    wired = probe !== undefined && probe !== null;
  } catch {
    wired = false; // no column yet → W2a has not landed
  }
  state.poolIdColumn = { value: wired, ts: now };
  return wired;
}

/** W2a's migration 030 lands the append-only ledgers. A `LIMIT 1` select
 *  succeeds iff the table exists — the same probe for both. `cacheKey` names
 *  the entry on the seam state so health and egress never share a stale slot.
 *  A non-existence error answer is cached for the TTL; any OTHER error (a
 *  transient busy/lock) is treated as "could not confirm" and reads empty this
 *  request rather than falsely claiming the table is absent forever. */
async function tableExists(db, table, cacheKey) {
  const state = usageSeamState();
  if (!state[cacheKey]) state[cacheKey] = { value: null, ts: 0 };
  const now = Date.now();
  if (state[cacheKey].value !== null && now - state[cacheKey].ts < ANALYTICS_SEAM_TTL_MS) {
    return state[cacheKey].value;
  }
  let exists = false;
  try {
    await db.get(`SELECT 1 AS x FROM ${table} LIMIT 1`);
    exists = true;
  } catch (e) {
    // "no such table" is a definitive NO (cache it); anything else is a
    // transient fault — do NOT cache, report absence for THIS read only.
    const msg = String(e?.message || "");
    if (!/no such table|doesn't exist|unknown table/i.test(msg)) return false;
    exists = false;
  }
  state[cacheKey] = { value: exists, ts: now };
  return exists;
}

/** The health-only convenience wrapper (keeps its historical call sites). */
async function healthTableExists(db) {
  return tableExists(db, "proxyPoolHealthHistory", "healthTable");
}

/** Test hook — reset the cached seam probe between cases. */
export function __resetUsageSeams() {
  delete global._velaUsageSeams;
}

const HEALTH_MINUTE_MS = 60_000;

/** The per-pool usage census — funds the Usage lens. One indexed scan over
 *  [startMs, endMs) GROUP BY poolId; p95 is a nearest-rank walk per pool
 *  because SQL percentile interpolation is not portable across the twins. */
export async function poolAnalyticsImpl(db, { period = "24h", now = Date.now() } = {}) {
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  const wired = await preflightUsageSeam(db);
  // `since` is answered in BOTH branches: wired:false (pre-migrate) reads null,
  // and wired:true over a cold harbour reads null too — the route turns a null
  // `since` with no buckets into the R6 "collecting since <when>" empty state,
  // so honesty about volume never rides on the `wired` flag (which now means
  // only "the column exists").
  const since = await poolAttributionSince(db);
  if (!wired) {
    return { period, wired: false, since, source: "usageHistory", pools: [], meta: { period, startMs, endMs } };
  }
  // One pass: per-pool counts, token sums, cost sum, latency stats.
  const agg = await db.all(
    `SELECT poolId,
            COUNT(*) AS requests,
            SUM(CASE WHEN status IN ('error','failed','failure') OR statusClass <> 'ok'
                     THEN 1 ELSE 0 END) AS errors,
            SUM(promptTokens) AS promptTokens,
            SUM(completionTokens) AS completionTokens,
            SUM(cost) AS costUsd,
            COUNT(latencyMs) AS latencyCount
     FROM usageHistory
     WHERE timestamp >= ? AND timestamp < ? AND poolId IS NOT NULL
     GROUP BY poolId`,
    [iso(startMs), iso(endMs)]
  );
  const pools = [];
  for (const r of agg || []) {
    // Nearest-rank p95 from the indexed column, scoped to THIS pool and window.
    const lat = await db.all(
      `SELECT latencyMs AS v FROM usageHistory
       WHERE timestamp >= ? AND timestamp < ? AND poolId = ? AND latencyMs IS NOT NULL
       ORDER BY latencyMs ASC`,
      [iso(startMs), iso(endMs), r.poolId]
    );
    const n = Array.isArray(lat) ? lat.length : 0;
    const p95 = n > 0 ? Number(lat[Math.min(n - 1, Math.max(0, Math.ceil(0.95 * n) - 1))].v) : null;
    const avgLatencyMs = n > 0 ? Math.round(lat.reduce((s, x) => s + Number(x.v || 0), 0) / n) : null;
    pools.push({
      poolId: r.poolId,
      requests: num(r.requests),
      errors: num(r.errors),
      promptTokens: num(r.promptTokens),
      completionTokens: num(r.completionTokens),
      costUsd: round6(num(r.costUsd)),
      avgLatencyMs,
      p95LatencyMs: p95,
      latencyCount: n,
    });
  }
  pools.sort((a, b) => b.requests - a.requests);
  return { period, wired: true, since, source: "usageHistory", pools, meta: { period, startMs, endMs } };
}

/** Provider→pool map — how the Usage lens labels a pool. Reads the sibling
 *  connections repo (same shape stats leans on for `bound`), fail-open: a
 *  missing repo yields an empty map rather than a failed census. Distinct
 *  `provider` values across the connections bound to the pool. */
export async function poolProviderMapImpl(db, { repos = "./repos/sqlite" } = {}) {
  const map = new Map();
  try {
    const harbor = repos === "./repos/mysql"
      ? await import("./repos/mysql/connectionsRepo.js")
      : await import("./repos/sqlite/connectionsRepo.js");
    const load = harbor.getAllConnections || harbor.getProviderConnections;
    if (typeof load !== "function") return map;
    const rows = (await load()) || [];
    for (const c of rows) {
      const poolId = c?.providerSpecificData?.proxyPoolId;
      if (!poolId) continue;
      if (!map.has(poolId)) map.set(poolId, new Set());
      if (c.provider) map.get(poolId).add(c.provider);
    }
  } catch {
    // fail-open — an unlabeled bucket is better than a dark page
  }
  return map;
}

/** The per-pool outcome series — funds the Fitness lens's history. Reads the
 *  append-only `proxyPoolHealthHistory` table W2a creates (migration 030).
 *  Until it exists: `collecting: true`, an empty series, and NO fabricated
 *  points. Once it exists: an exact indexed scan [startMs, endMs), bucketed to
 *  the local minute — the same honesty tier as the percentiles walk. */
export async function healthHistoryImpl(db, { poolId = null, period = "24h", now = Date.now() } = {}) {
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  const exists = await healthTableExists(db);
  if (!exists) {
    return { poolId: poolId || null, period, series: [], collecting: true, source: "proxyPoolHealthHistory", meta: { period, startMs, endMs } };
  }
  const params = [iso(startMs), iso(endMs)];
  let where = `WHERE createdAt >= ? AND createdAt < ?`;
  if (poolId) { where += ` AND poolId = ?`; params.push(poolId); }
  const rows = await db.all(
    `SELECT poolId, verdict, latencyMs, createdAt FROM proxyPoolHealthHistory ${where} ORDER BY createdAt ASC`,
    params
  );
  // Bucket to the local minute — one row per (pool, minute) carrying the LAST
  // verdict in that minute and the mean latency of its ok rows. A minute with
  // no ok latency stays null, never 0.
  const buckets = new Map();
  for (const r of rows || []) {
    const ts = new Date(r.createdAt).getTime();
    if (!Number.isFinite(ts)) continue;
    const minute = Math.floor(ts / HEALTH_MINUTE_MS) * HEALTH_MINUTE_MS;
    const key = `${r.poolId}|${minute}`;
    const cell = buckets.get(key) || { poolId: r.poolId, ts: minute, verdict: null, latSum: 0, latN: 0 };
    cell.verdict = r.verdict || cell.verdict;
    if (Number.isFinite(Number(r.latencyMs)) && r.latencyMs !== null) {
      cell.latSum += Number(r.latencyMs); cell.latN += 1;
    }
    buckets.set(key, cell);
  }
  const series = [...buckets.values()]
    .sort((a, b) => a.ts - b.ts || String(a.poolId).localeCompare(String(b.poolId)))
    .map((c) => ({ poolId: c.poolId, ts: new Date(c.ts).toISOString(), verdict: c.verdict, latencyMs: c.latN ? Math.round(c.latSum / c.latN) : null }));
  return { poolId: poolId || null, period, series, collecting: false, source: "proxyPoolHealthHistory", meta: { period, startMs, endMs } };
}

/** The per-pool egress history — projects the in-memory geo ring faithfully
 *  (poolGeo.js, max 8 IPs, TTL 1h). Never persisted; labels itself
 *  `source: "memory"` so a UI can say what a restart erases. Entries carry the
 *  CURRENT ip with `ok: true` and PAST ips with `ok: null` (we observed them,
 *  we never graded them). */
export function projectEgressHistory(geo, poolId) {
  if (!geo || !geo.ip) return { poolId, entries: [], stable: null, source: "memory" };
  const entries = [];
  const seen = new Set();
  const push = (ip, country, ts, ok) => {
    const key = `${ip}|${ts ?? ""}`;
    if (!ip || seen.has(key)) return;
    seen.add(key);
    entries.push({ ts: ts ? new Date(ts).toISOString() : null, ip, country: country || "", ok });
  };
  for (const h of geo.ipHistory || []) push(h?.ip, h?.country, h?.ts, null);
  push(geo.ip, geo.country, geo.ts, true);
  entries.sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
  const distinctIps = new Set([geo.ip, ...(geo.ipHistory || []).map((h) => h?.ip)].filter(Boolean));
  return {
    poolId,
    entries,
    stable: distinctIps.size < 2,
    flapCount: Math.max(0, distinctIps.size - 1),
    current: { ip: geo.ip, country: geo.country || "", ts: geo.ts ? new Date(geo.ts).toISOString() : null },
    source: "memory",
  };
}

/** The per-pool egress history a restart cannot erase — W2a's append-only
 *  `proxyPoolEgressHistory` (migration 031). W2b's `projectEgressHistory`
 *  above is the in-memory ring it supersedes for charting; this walks the
 *  persisted ledger the same way healthHistoryImpl walks its sibling.
 *
 *  Until the table exists: zero entries, `collecting: true`, and NO fabricated
 *  points — the ring's entries are NOT smuggled in as a pseudo-history, because
 *  mixing them would make one payload two different truths wearing one shape.
 *  Once it exists it walks the exact indexed tier [startMs, endMs), newest
 *  first, capped by the legacy MAX and never unbounded.
 *
 *  The write seam is the egress PROBE (poolEgressProbe → recordEgressSample),
 *  the only place a fresh country is ever learned; proxyFleet's setPoolGeo call
 *  carries an IP with no country and is deliberately not a writer (a blank
 *  country on every sample would be a lie stamped in a persistent table). */
export const EGRESS_HISTORY_DEFAULT_MAX = 8; // = poolGeo's POOL_GEO_IP_HISTORY_MAX (the legacy bound)

export async function egressHistoryImpl(db, { poolId, period = "24h", now = Date.now(), max = EGRESS_HISTORY_DEFAULT_MAX } = {}) {
  const { startMs, endMs } = resolvePeriodWindow(period, now);
  if (!poolId) return { poolId: null, period, entries: [], collecting: false, source: "proxyPoolEgressHistory", meta: { period, startMs, endMs } };
  const exists = await tableExists(db, "proxyPoolEgressHistory", "egressTable");
  if (!exists) {
    return { poolId, period, entries: [], collecting: true, source: "proxyPoolEgressHistory", meta: { period, startMs, endMs } };
  }
  const cap = Math.min(Math.max(1, Math.trunc(Number(max)) || EGRESS_HISTORY_DEFAULT_MAX), 256);
  const rows = await db.all(
    `SELECT createdAt, ip, country FROM proxyPoolEgressHistory
     WHERE poolId = ? AND createdAt >= ? AND createdAt < ?
     ORDER BY createdAt DESC, id DESC LIMIT ?`,
    [poolId, iso(startMs), iso(endMs), cap]
  );
  // Newest-first from SQL (the LIMIT keeps the freshest cap); returned
  // oldest-first so a chart reads left→right through time.
  const entries = (rows || [])
    .map((r) => ({ ts: r.createdAt || null, ip: r.ip || "", country: r.country || "", ok: null }))
    .sort((a, b) => String(a.ts || "").localeCompare(String(b.ts || "")));
  return { poolId, period, entries, collecting: false, source: "proxyPoolEgressHistory", meta: { period, startMs, endMs } };
}
