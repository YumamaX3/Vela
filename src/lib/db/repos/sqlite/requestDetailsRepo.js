import { getAdapter } from "../../driver.js";
import { parseJson, stringifyJson } from "../../helpers/jsonCol.js";
import * as log from "@/sse/utils/logger.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;

// ─── P6 — the chunked drain (plans/2026-11-01-responsive-tide-performance.md) ─
//
// THE WOUND (survey suspect 6): every flush opened ONE synchronous transaction
// that owned the event loop for the whole buffer — inserts + COUNT(*) +
// delete-to-cap, with no yield between items. Every adapter's transaction() is
// synchronous (betterSqlite3Adapter.js:82, nodeSqliteAdapter.js:102,
// bunSqliteAdapter.js:78, sqljsAdapter.js:104), so the loop sat blocked until
// the last row landed. The batch trigger drains the ENTIRE buffer, so a burst
// of concurrent requests meant one jumbo transaction.
//
// THE MEND — chunked awaits with setImmediate yields between chunks (the
// plan's second path; the worker_threads path was measured and declined: the
// drivers are sync, so only a second connection could take the loop, and that
// means a writer outside the single-instance lock, a second WAL writer on the
// same rows, and a second cache — wrong trades on a shared 4C box). Each chunk
// is its own transaction — a commit point, never a torn commit — and each
// awaits a full loop turn before the next. Rows are identical at any chunk
// size; only the loop's freedom between commits changes.
const DEFAULT_WRITE_CHUNK_SIZE = 10;

function clampPositiveInt(raw, fallback) {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// Fail-open, zero-config: the env may lower or raise the chunk, never break it.
function chunkSizeFromEnv() {
  const n = clampPositiveInt(process.env.OBSERVABILITY_WRITE_CHUNK_SIZE, DEFAULT_WRITE_CHUNK_SIZE);
  return Math.min(n, DEFAULT_MAX_RECORDS);
}

// One loop turn. The pin swaps the scheduler through __test__.setYield below.
const defaultYieldToLoop = () => new Promise((resolve) => setImmediate(resolve));

let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();
    const envRequestLogs = process.env.ENABLE_REQUEST_LOGS;
    if (envRequestLogs !== undefined) {
      const enabled = envRequestLogs.toLowerCase() === "true";
      cachedConfig = {
        enabled,
        maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
        batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
        flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
        maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
      };
      cachedConfigTs = Date.now();
      return cachedConfig;
    }
    const envFallback = process.env.OBSERVABILITY_ENABLED !== "false";
    const uiFlag = typeof settings.enableObservability === "boolean";
    const enabled = uiFlag
      ? settings.enableObservability
      : envFallback;

    cachedConfig = {
      enabled,
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: false,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
    };
  }
  cachedConfigTs = Date.now();
  return cachedConfig;
}

let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;
// P6 state, read by the pin: how the loop has been yielded, and how the last
// drain divided its work. Counts, not timings — the loop's own lag is P1's eye.
let yieldToLoop = defaultYieldToLoop;
let drainStats = { drains: 0, chunks: 0, maxChunk: 0 };

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

export const __test__ = {
  sanitizeHeaders,
  // P6 witness seams: swap the scheduler (to observe order), read what the
  // last drain did, and await drain quiescence. No behaviour is reachable
  // through here that the env and the triggers below do not already reach.
  setYield(fn) { yieldToLoop = fn || defaultYieldToLoop; },
  drainStats() { return { ...drainStats }; },
  resetDrainStats() { drainStats = { drains: 0, chunks: 0, maxChunk: 0 }; },
  // Resolve when no drain is in flight AND the buffer is empty — the quiesce
  // point the chunked-drain pins need (waitForRows can return mid-drain).
  async whenIdle() {
    while (inFlightFlush || writeBuffer.length > 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  },
};

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj, maxSize) {
  const str = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj || {};
}

// ─── P6 — the chunked drain ────────────────────────────────────────────────
// The row loop is unchanged from the single-transaction version; what moved
// is WHERE the transaction boundary sits (each chunk commits on its own) and
// that every chunk after the first is preceded by a loop turn. The cap query
// runs once per drain, after the last chunk, on the untouched shape.
async function writeChunk(db, items, config) {
  db.transaction(() => {
    for (const item of items) {
      if (!item.id) item.id = generateDetailId(item.model);
      if (!item.timestamp) item.timestamp = new Date().toISOString();
      if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);

      const record = {
        id: item.id,
        provider: item.provider || null,
        model: item.model || null,
        connectionId: item.connectionId || null,
        timestamp: item.timestamp,
        status: item.status || null,
        combo: item.combo || null, // migration 015 — NULL = direct request
        latency: item.latency || {},
        tokens: item.tokens || {},
        request: truncateField(item.request, config.maxJsonSize),
        providerRequest: truncateField(item.providerRequest, config.maxJsonSize),
        providerResponse: truncateField(item.providerResponse, config.maxJsonSize),
        response: truncateField(item.response, config.maxJsonSize),
        pxpipe: item.pxpipe || undefined,
      };

      db.run(
        `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, combo, data) VALUES(?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, combo = excluded.combo, data = excluded.data`,
        [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, record.combo, stringifyJson(record)]
      );
    }
  });
}

function capRecords(db, config) {
  const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`);
  if (cnt && cnt.c > config.maxRecords) {
    db.run(
      `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
      [cnt.c - config.maxRecords]
    );
  }
}

async function flushToDatabase() {
  if (isFlushing) return;
  if (writeBuffer.length === 0) return;
  isFlushing = true;
  try {
    // Drain entire buffer (loop in case more pushed during await), in chunks.
    while (writeBuffer.length > 0) {
      const items = writeBuffer.splice(0, writeBuffer.length);
      const db = await getAdapter();
      const config = await getObservabilityConfig();
      const chunkSize = chunkSizeFromEnv();
      const chunks = Math.ceil(items.length / chunkSize);

      for (let i = 0; i < items.length; i += chunkSize) {
        // Yield BEFORE every chunk after the first: the commit that just ran
        // was the only loop-owned span, and the turn belongs to everything
        // else — HTTP reads, SSE ticks — before the next one begins.
        if (i > 0) await yieldToLoop();
        writeChunk(db, items.slice(i, i + chunkSize), config);
      }

      capRecords(db, config);
      drainStats = {
        drains: drainStats.drains + 1,
        chunks: drainStats.chunks + chunks,
        maxChunk: Math.max(drainStats.maxChunk, Math.min(chunkSize, items.length)),
      };
    }
  } catch (e) {
    // Observe-and-continue: a malformed image must not turn into a per-batch
    // stack storm. The guardian reports once and counts; the buffer stays
    // drained so a later repair does not replay thousands of stale rows.
    const { isCorruptionError, noteRuntimeCorruption } = await import("../../integrity.js");
    if (isCorruptionError(e)) {
      if (noteRuntimeCorruption(e, "requestDetails batch write")) {
        log.error(
          "DB",
          "requestDetails batch write hit a MALFORMED database image — request details are NOT being recorded.\n" +
          "     Gateway keeps serving. Repair: POST /api/settings/database/repair, then restart."
        );
      }
    } else {
      log.error("DB", "Batch write failed:", (e?.message ?? e));
    }
  } finally {
    isFlushing = false;
  }
}

// The in-flight drain. Before P6 the flush had exactly one await before its
// synchronous transaction — resolving the adapter — so a shutdown landing on
// that turn found an empty buffer and a transaction about to start. In this
// harbor the adapter is already resolved on every call, so the race was only
// unlikely, not absent. Now that a drain spans many loop turns, "is there
// anything pending?" is isFlushing OR a non-empty buffer, and the shutdown
// waits the in-flight promise rather than calling into a flush that would
// return early on it.
let inFlightFlush = null;

function startFlush() {
  if (inFlightFlush) return inFlightFlush;
  const p = flushToDatabase().finally(() => {
    if (inFlightFlush === p) inFlightFlush = null;
  });
  inFlightFlush = p;
  return p;
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) {return;}

  writeBuffer.push(detail);

  // Trigger immediate flush if batch threshold reached.
  // flushToDatabase() drains entire buffer in a loop, so all pushes during await are persisted.
  if (writeBuffer.length >= config.batchSize) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    startFlush().catch((e) => log.error("DB", "flush err:", e));
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      startFlush().catch(() => {});
    }, config.flushIntervalMs);
  }
}

export async function getRequestDetails(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  if (filter.status) { conds.push("status = ?"); params.push(filter.status); }
  if (filter.startDate) { conds.push("timestamp >= ?"); params.push(new Date(filter.startDate).toISOString()); }
  if (filter.endDate) { conds.push("timestamp <= ?"); params.push(new Date(filter.endDate).toISOString()); }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestDetails ${where}`, params);
  const totalItems = cntRow ? cntRow.c : 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const details = rows.map((r) => parseJson(r.data, {}));

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getDistinctProviders() {
  const db = await getAdapter();
  const rows = db.all(`SELECT DISTINCT provider FROM requestDetails WHERE provider IS NOT NULL ORDER BY provider ASC`);
  return rows.map((r) => r.provider);
}

export async function getRequestDetailById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM requestDetails WHERE id = ?`, [id]);
  return row ? parseJson(row.data, null) : null;
}

const _shutdownHandler = async () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  // P6: a drain reads the buffer synchronously as its first act, so waiting
  // for it is enough — anything pushed after its last read is still in the
  // buffer when isFlushing clears, and the second call drains it.
  if (inFlightFlush) await inFlightFlush.catch(() => {});
  if (writeBuffer.length > 0) await startFlush().catch(() => {});
};

function ensureShutdownHandler() {
  process.off("beforeExit", _shutdownHandler);
  process.off("SIGINT", _shutdownHandler);
  process.off("SIGTERM", _shutdownHandler);
  process.off("exit", _shutdownHandler);

  process.on("beforeExit", _shutdownHandler);
  process.on("SIGINT", _shutdownHandler);
  process.on("SIGTERM", _shutdownHandler);
  process.on("exit", _shutdownHandler);
}

ensureShutdownHandler();
