/**
 * Cooldown-aware retry — wait out a short all-accounts cooldown instead of
 * answering 503 immediately.
 *
 * When every candidate account for a provider is cooling down, the honest
 * answer is not always "unavailable": if the earliest expiry is seconds away,
 * blocking briefly and retrying once serves the request instead of bouncing it
 * — and a 60s rate-limit window (see `classify429.js`) is exactly that case.
 * Beyond a short bound the wait is worse than the 503 (it holds the client
 * connection for no real chance of success), so the wait is capped and the
 * retry budget is a single attempt.
 *
 * The decision + wait is exposed as ONE pure async helper, so it is
 * unit-testable without a live request: the clock is injectable and the abort
 * path is a plain `AbortSignal`.
 *
 * (Ported from VansRouter's `open-sse/utils/cooldownRetry.js` — W2, v0.9.75.)
 *
 * @module open-sse/utils/cooldownRetry
 */

/** Longest wait we will hold a request for before giving up and returning 503. */
export const MAX_RETRY_WAIT_MS = 30_000;
/** How many times a request may be re-driven after a cooldown wait. */
export const MAX_COOLDOWN_RETRIES = 1;

/**
 * Decide whether to wait-and-retry when all accounts are rate-limited.
 *
 * Returns `{ shouldRetry: false, reason }` immediately when:
 *   - the retry budget is spent (`retriesSoFar >= maxRetries`)
 *   - the client has already disconnected (`signal.aborted`)
 *   - `retryAfter` is missing/unparseable (no wait can be computed)
 *   - the required wait exceeds `maxWaitMs` (not worth blocking the client)
 *
 * Returns `{ shouldRetry: false, reason: "client_disconnected" }` if the client
 * disconnects DURING the sleep — the caller should return the unavailable
 * response in that case.
 *
 * Returns `{ shouldRetry: true, waitedMs }` after a successful wait (or
 * immediately with `waitedMs: 0` when the cooldown has already elapsed).
 *
 * @param {object} opts
 * @param {string|number|Date|null} opts.retryAfter — earliest account cooldown
 *   expiry (ISO string, epoch ms, or Date)
 * @param {number} opts.retriesSoFar — cooldown retries already used
 * @param {AbortSignal} [opts.signal] — client disconnect signal; aborts the wait
 * @param {number} [opts.maxWaitMs] — override max wait (default 30s)
 * @param {number} [opts.maxRetries] — override retry budget (default 1)
 * @param {() => number} [opts.now] — injectable clock for tests (default Date.now)
 * @returns {Promise<{ shouldRetry: boolean, reason?: string, waitedMs?: number }>}
 */
export async function maybeWaitForCooldown({
  retryAfter,
  retriesSoFar,
  signal,
  maxWaitMs = MAX_RETRY_WAIT_MS,
  maxRetries = MAX_COOLDOWN_RETRIES,
  now = Date.now,
}) {
  // Budget exhausted — don't wait.
  if (retriesSoFar >= maxRetries) {
    return { shouldRetry: false, reason: "budget_exhausted" };
  }
  // Client already disconnected — don't bother waiting.
  if (signal?.aborted) {
    return { shouldRetry: false, reason: "client_disconnected" };
  }
  // Compute the required wait.
  const targetMs = toEpochMs(retryAfter);
  if (targetMs == null) {
    return { shouldRetry: false, reason: "invalid_retry_after" };
  }
  const waitMs = targetMs - now();
  if (waitMs <= 0) {
    // Already past the cooldown — retry immediately, no sleep needed.
    return { shouldRetry: true, waitedMs: 0 };
  }
  if (waitMs > maxWaitMs) {
    return { shouldRetry: false, reason: "wait_too_long" };
  }
  // Sleep with abort support; rejects early if the client disconnects.
  try {
    await sleepMs(waitMs, signal);
    return { shouldRetry: true, waitedMs: waitMs };
  } catch (e) {
    if (signal?.aborted) {
      return { shouldRetry: false, reason: "client_disconnected" };
    }
    // Unexpected abort reason — treat as not retryable.
    return { shouldRetry: false, reason: "wait_failed" };
  }
}

/**
 * Sleep for `ms` milliseconds, rejecting early if `signal` aborts.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleepMs(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason || new Error("aborted"));
    }
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Normalize retryAfter (ISO string | epoch ms | Date) to epoch ms.
 * Returns null if the value is missing/unparseable.
 * @param {string|number|Date|null} value
 * @returns {number|null}
 */
function toEpochMs(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}
