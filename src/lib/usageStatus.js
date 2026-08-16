// Usage Observatory (plans/mirror-usage-observatory/SEALED-PLAN.md, W1) —
// the status classification covenant.
//
// usageHistory gains a `statusClass` column (migration 008) normalized at
// write time so the Observatory's ErrorMix, topology halos, and health
// frames can GROUP BY an indexed, dialect-stable slug instead of parsing
// raw `status` strings + httpStatus at query time.
//
// Classes (sealed plan W1.2, Gate-14 revision — gateway_error DROPPED):
//   ok             — completed successfully
//   client_error   — upstream 4xx (except 429)
//   upstream_error — upstream 5xx, or legacy bare "error" with no status
//   timeout        — 408/499/504 (499 = client abort, per chatCore's AbortError mapping)
//   rate_limited   — upstream 429
//   ''             — unknown (pre-instrumentation rows, or no signal)
//
// gateway_error was dropped at Gate 14: `rejectionReason` is a phantom
// (zero occurrences in the codebase) and gateway rejections (keyGate stage
// failures) never reach saveRequestUsage — usage rows are written only on
// completed usage. Recorded telemetry gap, not a dead map entry.
//
// Consumed by: migration 008 backfill (both harbors), the write path
// (W1-B instrumentation), the aggregation layer (W1-C), and the UI.

export const STATUS_CLASSES = ["ok", "client_error", "upstream_error", "timeout", "rate_limited"];

// Legacy raw `status` strings actually observed in usageHistory today:
// saveRequestUsage writes entry.status || "ok"; the chat paths pass no
// status (→ "ok"), requestDetail/executor paths write "success"/"error"
// into requestDetails, and accountFallback returns status:"error". The map
// covers the union honestly — anything unknown falls through to ''.
export const LEGACY_STATUS_MAP = {
  ok: "ok",
  success: "ok",
  error: "upstream_error",
};

// Rules for the migration-008 backfill (both harbors): raw status values →
// statusClass, applied only to rows with empty/NULL statusClass.
export const BACKFILL_RULES = [
  { match: ["ok", "success"], cls: "ok" },
  { match: ["error"], cls: "upstream_error" },
];

/** Classify a legacy raw `status` string. Unknown → '' (never invent). */
export function classifyLegacyStatus(status) {
  if (typeof status !== "string" || !status) return "";
  return LEGACY_STATUS_MAP[status.toLowerCase()] || "";
}

/** Classify an instrumented upstream httpStatus (W1-B onward).
 *  Returns null when there is no signal (request never reached upstream). */
export function classifyHttpStatus(httpStatus) {
  const n = Number(httpStatus);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n === 429) return "rate_limited";
  if (n === 408 || n === 499 || n === 504) return "timeout";
  if (n >= 200 && n < 300) return "ok";
  if (n >= 400 && n < 500) return "client_error";
  if (n >= 500) return "upstream_error";
  return null;
}

/** The write-time derivation: httpStatus wins when present (instrumented
 *  rows), else the legacy status string, else '' (unknown). Fail-open:
 *  never throws — classification must not break the hot path. */
export function deriveStatusClass({ status = null, httpStatus = null } = {}) {
  try {
    return classifyHttpStatus(httpStatus) || classifyLegacyStatus(status) || "";
  } catch {
    return "";
  }
}
