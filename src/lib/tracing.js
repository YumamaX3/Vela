// TRACING — a small in-process ring of completed upstream requests.
//
// Ported from 9router-go `internal/tracing`: dependency-free by design, with
// p50/p95/p99 latency per provider/model. The full OpenTelemetry SDK is the
// right tool when an OTLP collector exists; this is the honest local eye until
// then.
const LIMIT = 2000;
const startedAt = Date.now();

const spans = [];

export function recordSpan(span = {}) {
  const at = span.at || Date.now();
  const entry = {
    provider: String(span.provider ?? ""),
    model: String(span.model ?? ""),
    status: String(span.status ?? "200"),
    durationMs: Number(span.durationMs) || 0,
    at,
  };
  if (Number.isFinite(Number(span.ttftMs))) entry.ttftMs = Number(span.ttftMs);
  spans.push(entry);
  if (spans.length > LIMIT) spans.splice(0, spans.length - LIMIT);
}

export function recentSpans(n = 0) {
  if (n <= 0 || n >= spans.length) return spans.slice();
  return spans.slice(spans.length - n);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let idx = Math.ceil((p / 100) * sorted.length) - 1;
  if (idx < 0) idx = 0;
  if (idx >= sorted.length) idx = sorted.length - 1;
  return Number(sorted[idx]);
}

export function latencyByKey() {
  const buckets = new Map();
  const errors = new Map();
  const last = new Map();
  for (const span of spans) {
    const key = `${span.provider}/${span.model}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(span.durationMs);
    if (span.status !== "200") errors.set(key, (errors.get(key) || 0) + 1);
    last.set(key, Math.max(last.get(key) || 0, span.at));
  }
  return [...buckets.entries()]
    .map(([key, durations]) => ({
      key,
      count: durations.length,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      p99Ms: percentile(durations, 99),
      errors: errors.get(key) || 0,
      lastAt: last.get(key) || 0,
      uptimeSecs: Math.floor((Date.now() - startedAt) / 1000),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function tracesPayload(n = 0) {
  return { spans: recentSpans(n), latency: latencyByKey() };
}

/** Test seam — the ring is process state, and tests must not inherit it. */
export function resetTracing() {
  spans.length = 0;
}
