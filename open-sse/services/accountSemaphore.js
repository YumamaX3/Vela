/**
 * Account Semaphore — in-memory per-account concurrency limiter.
 *
 * One FIFO gate per `provider:accountKey:proxyHash`. Requests beyond the
 * configured concurrency cap wait in the queue until a slot opens, the gate is
 * unblocked, or the queue timeout expires. Accounts that share a proxy bucket
 * share a gate, so a saturated egress path is throttled once rather than once
 * per account.
 *
 * ── Port notes (W6, sibling-harbor-ports §3.1 row 6) ─────────────────────────
 * Ported from VansRouter's `open-sse/services/accountSemaphore.js`, itself a
 * plain-JS descendant of OmniRoute's `accountSemaphore.ts`.
 *
 * Two deliberate divergences from the source, both named in Vela's plan §5:
 *
 *  1. BOUNDED QUEUE (plan §5b — "it must be bounded, or a stuck provider grows
 *     memory without limit"). The fork does carry a `maxQueueSize` option
 *     (default 20) and rejects with `SemaphoreCapacityError` when full — so the
 *     plan's "the source has no bound" is not literally true — but that bound is
 *     SILENT: nothing is counted and nothing is logged, so an operator cannot
 *     see that an account is shedding load. This port keeps the bound, makes it
 *     explicit, counts every drop on the gate (`stats.dropped`) and emits one
 *     warn line per drop through an injectable logger. The queue is dropped
 *     from, never grown.
 *  2. PER-CATEGORY BLOCK DURATION (`markBlocked` with no explicit duration).
 *     The fork always required an explicit `durationMs`. Here an omitted
 *     duration falls back to the provider's auth-category cooldown from
 *     `config/providerProfiles.js` — which gives that module its live call site
 *     in Vela (see §3.1 row 9, "consumed by (4)/(6)").
 *
 * Security: a gate key holds a connection id and a proxy bucket hash — never a
 * token. Nothing here reads, stores or logs credential material, and the drop
 * log line deliberately omits the account segment of the key.
 *
 * @module open-sse/services/accountSemaphore
 */
import { getProviderResilienceProfile } from "../config/providerProfiles.js";

/**
 * Build the gate key. `proxyHash` defaults to "direct" (no proxy).
 * @param {{provider: any, accountKey: any, proxyHash?: any}} parts
 * @returns {string}
 */
export function buildAccountSemaphoreKey({ provider, accountKey, proxyHash = "direct" }) {
  return `${String(provider)}:${String(accountKey)}:${String(proxyHash)}`;
}

/** djb2 — stable, dependency-free string hash (same family the fork uses). */
function djb2(value) {
  let hash = 5381;
  const str = String(value);
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Derive a proxy bucket key from a connection's `providerSpecificData`.
 *
 * The fork reads this from `src/lib/network/connectionProxy.js#getProxyHash`.
 * Vela keeps the derivation local to this module so the semaphore has no
 * dependency on the proxy-resolution layer (which is DB-backed and async); the
 * input fields and the `direct` fallback are the same, so keys are comparable
 * across the two.
 *
 * @param {object} [providerSpecificData]
 * @returns {string} `proxy-<hash>` | `pool-<hash>` | "direct"
 */
export function deriveProxyBucketHash(providerSpecificData = {}) {
  const psd = providerSpecificData || {};
  const enabled = psd.connectionProxyEnabled === true;
  const url = enabled ? String(psd.connectionProxyUrl || "").trim() : "";
  if (url) return `proxy-${djb2(url)}`;
  const poolId = String(psd.proxyPoolId || "").trim()
    || (Array.isArray(psd.proxyPoolIds) ? String(psd.proxyPoolIds[0] || "").trim() : "");
  if (poolId) return `pool-${djb2(poolId)}`;
  return "direct";
}

export const DEFAULT_TIMEOUT_MS = 30_000;
/** Bound on the wait queue. Beyond this, `acquire` drops instead of growing. */
export const DEFAULT_MAX_QUEUE_SIZE = 20;
export const DEFAULT_MAX_CONCURRENCY = 1;
/** Fallback block duration when `markBlocked` is given no explicit duration. */
const DEFAULT_BLOCK_MS = 60_000;

const gates = new Map();

/**
 * Thrown/rejected when a gate cannot serve a request: the wait timed out, or
 * the bounded queue was full (then `reason === "queue_full"`).
 */
export class SemaphoreCapacityError extends Error {
  constructor(key, timeoutMs, extra = {}) {
    super(`Semaphore "${key}" capacity reached — timed out after ${timeoutMs}ms`);
    this.name = "SemaphoreCapacityError";
    this.semaphoreKey = key;
    this.timeoutMs = timeoutMs;
    this.reason = extra.reason || "timeout";
    if (extra.queueSize !== undefined) this.queueSize = extra.queueSize;
    if (extra.maxQueueSize !== undefined) this.maxQueueSize = extra.maxQueueSize;
  }
}

function isBypassed(maxConcurrency) {
  return maxConcurrency == null || maxConcurrency <= 0;
}

/** Provider segment of a gate key (`provider:account:proxy`). */
function providerOf(semaphoreKey) {
  return String(semaphoreKey).split(":")[0] || "";
}

function ensureGate(semaphoreKey, maxConcurrency) {
  let gate = gates.get(semaphoreKey);
  if (gate) {
    gate.maxConcurrency = maxConcurrency;
    return gate;
  }
  gate = {
    running: 0,
    maxConcurrency,
    queue: [],
    blockedUntil: null,
    blockTimer: null,
    cleanupTimer: null,
    dropped: 0,
    queueLimit: DEFAULT_MAX_QUEUE_SIZE,
  };
  gates.set(semaphoreKey, gate);
  return gate;
}

function cleanupGateIfIdle(semaphoreKey, gate) {
  if (!gate) return;
  if (gate.running === 0 && gate.queue.length === 0 && (!gate.blockedUntil || Date.now() >= gate.blockedUntil)) {
    if (gate.cleanupTimer) {
      clearTimeout(gate.cleanupTimer);
      gate.cleanupTimer = null;
    }
    if (gate.blockTimer) {
      clearTimeout(gate.blockTimer);
      gate.blockTimer = null;
    }
    gates.delete(semaphoreKey);
  }
}

function scheduleCleanup(semaphoreKey, gate) {
  if (gate.cleanupTimer) return;
  // Immediate cleanup attempt on next tick, then keep only a short safety window.
  gate.cleanupTimer = setTimeout(() => {
    gate.cleanupTimer = null;
    cleanupGateIfIdle(semaphoreKey, gate);
  }, 0);
  if (typeof gate.cleanupTimer.unref === "function") gate.cleanupTimer.unref();
}

/**
 * Acquire a semaphore slot. Returns a release function (idempotent).
 *
 * Rejects with `SemaphoreCapacityError` on timeout, on abort, or immediately
 * when the bounded queue is already full (`reason: "queue_full"`).
 *
 * @param {string} semaphoreKey
 * @param {{maxConcurrency?: number|null, timeoutMs?: number, signal?: AbortSignal|null,
 *          maxQueueSize?: number, log?: {warn?: Function}|null}} [options]
 * @returns {Promise<() => void>}
 */
export function acquire(semaphoreKey, options = {}) {
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = options.signal ?? null;
  const rawQueueLimit = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const maxQueueSize = Number.isFinite(rawQueueLimit) && rawQueueLimit >= 0
    ? Math.floor(rawQueueLimit)
    : DEFAULT_MAX_QUEUE_SIZE;
  const log = options.log ?? null;

  if (isBypassed(maxConcurrency)) {
    return Promise.resolve(() => {});
  }

  const gate = ensureGate(semaphoreKey, maxConcurrency);
  gate.queueLimit = maxQueueSize;

  // Check if gate is blocked (e.g. from a 429 markBlocked)
  if (gate.blockedUntil && Date.now() < gate.blockedUntil) {
    // Still blocked — fall through to the queue.
  } else {
    gate.blockedUntil = null;
    if (gate.running < gate.maxConcurrency) {
      gate.running++;
      let released = false;
      return Promise.resolve(() => {
        if (released) return;
        released = true;
        gate.running--;
        drainQueue(semaphoreKey, gate);
      });
    }
  }

  // Bounded queue: drop (and log) rather than grow.
  if (gate.queue.length >= maxQueueSize) {
    gate.dropped++;
    const err = new SemaphoreCapacityError(semaphoreKey, 0, {
      reason: "queue_full",
      queueSize: gate.queue.length,
      maxQueueSize,
    });
    // Log the provider and the depth — never the account segment, and never a
    // credential (a gate key carries neither, but the discipline holds anyway).
    const line = `[AccountSemaphore] ${providerOf(semaphoreKey)} queue full (${gate.queue.length}/${maxQueueSize}) — dropping request`;
    try {
      if (typeof log?.warn === "function") log.warn(line);
      else console.warn(line);
    } catch { /* a logger must never break the drop path */ }
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const idx = gate.queue.indexOf(entry);
      if (idx >= 0) gate.queue.splice(idx, 1);
      reject(new SemaphoreCapacityError(semaphoreKey, timeoutMs, { reason: "timeout" }));
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    if (signal) {
      signal.addEventListener?.("abort", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const idx = gate.queue.indexOf(entry);
        if (idx >= 0) gate.queue.splice(idx, 1);
        reject(signal.reason || new Error("Aborted"));
      });
    }

    const entry = {
      resolve: (release) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(release);
      },
      reject: (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      },
      timer,
    };
    gate.queue.push(entry);
    scheduleCleanup(semaphoreKey, gate);
  });
}

function drainQueue(semaphoreKey, gate) {
  while (gate.queue.length > 0 && gate.running < gate.maxConcurrency) {
    if (gate.blockedUntil) {
      const remaining = gate.blockedUntil - Date.now();
      if (remaining > 0) {
        if (!gate.blockTimer) {
          gate.blockTimer = setTimeout(() => {
            gate.blockTimer = null;
            drainQueue(semaphoreKey, gate);
          }, remaining);
        }
        break;
      }
      gate.blockedUntil = null;
    }
    const entry = gate.queue.shift();
    if (!entry) break;
    gate.running++;
    let released = false;
    entry.resolve(() => {
      if (released) return;
      released = true;
      gate.running--;
      drainQueue(semaphoreKey, gate);
    });
  }
  // If nothing is running and nothing is waiting, schedule an immediate cleanup.
  if (gate.running === 0 && gate.queue.length === 0 && (!gate.blockedUntil || Date.now() >= gate.blockedUntil)) {
    scheduleCleanup(semaphoreKey, gate);
  }
}

/**
 * Temporarily block all requests to a gate (e.g. after a 429).
 *
 * @param {string} semaphoreKey
 * @param {number} [durationMs] — omit to use the provider's auth-category
 *   cooldown from `providerProfiles.js` (oauth 5m / apikey 30s / local 60s).
 */
export function markBlocked(semaphoreKey, durationMs) {
  const gate = gates.get(semaphoreKey);
  if (!gate) return;
  const profile = getProviderResilienceProfile(providerOf(semaphoreKey));
  const fallback = Number.isFinite(profile?.providerCooldownMs) && profile.providerCooldownMs > 0
    ? profile.providerCooldownMs
    : DEFAULT_BLOCK_MS;
  const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : fallback;
  const until = Date.now() + ms;
  if (!gate.blockedUntil || gate.blockedUntil < until) {
    gate.blockedUntil = until;
  }
  // Auto-wakeup: drain queued waiters when the block expires instead of
  // leaving them stuck until the next acquire() call.
  if (gate.blockTimer) clearTimeout(gate.blockTimer);
  const delay = Math.max(1, gate.blockedUntil - Date.now());
  gate.blockTimer = setTimeout(() => {
    gate.blockTimer = null;
    drainQueue(semaphoreKey, gate);
  }, delay);
  if (typeof gate.blockTimer.unref === "function") gate.blockTimer.unref();
}

/**
 * Get stats for all gates (for the dashboard).
 * @returns {Array<{key: string, provider: string, running: number, queued: number,
 *   maxConcurrency: number, queueLimit: number, dropped: number, blockedUntil: string|null}>}
 */
export function getAccountSemaphoreStats() {
  const result = [];
  for (const [key, gate] of gates) {
    result.push({
      key,
      provider: providerOf(key),
      running: gate.running,
      queued: gate.queue.length,
      maxConcurrency: gate.maxConcurrency,
      queueLimit: gate.queueLimit ?? DEFAULT_MAX_QUEUE_SIZE,
      dropped: gate.dropped || 0,
      blockedUntil: gate.blockedUntil ? new Date(gate.blockedUntil).toISOString() : null,
    });
  }
  return result;
}

export function isSemaphoreCapacityError(error) {
  return error instanceof SemaphoreCapacityError;
}

/**
 * Drop every gate and its timers. Test/reset seam only — production code never
 * calls this, so a live gate can never be cleared out from under a request.
 */
export function resetAccountSemaphore() {
  for (const gate of gates.values()) {
    if (gate.cleanupTimer) clearTimeout(gate.cleanupTimer);
    if (gate.blockTimer) clearTimeout(gate.blockTimer);
    for (const entry of gate.queue) {
      try { entry.reject(new SemaphoreCapacityError("reset", 0, { reason: "reset" })); } catch { /* ignore */ }
    }
    gate.queue.length = 0;
  }
  gates.clear();
}

/**
 * Resolve the semaphore key from request context.
 * Returns null if no concurrency limit can be configured.
 * @param {object} params
 * @param {string} params.provider
 * @param {string} params.connectionId
 * @param {string} [params.proxyHash="direct"] - proxy bucket key so accounts sharing a proxy share a concurrency limit
 */
export function resolveAccountSemaphoreKey({ provider, model, connectionId, credentials, proxyHash = "direct" }) {
  if (!provider || !connectionId) return null;
  return buildAccountSemaphoreKey({ provider, accountKey: connectionId, proxyHash });
}

/**
 * Resolve max concurrency from connection settings.
 * Returns a sensible default (3) when not configured, so the semaphore
 * actually limits concurrent requests per account (preventing 429 cascades).
 * Set `maxConcurrency: 0` or `null` in providerSpecificData to bypass.
 */
export function resolveAccountSemaphoreMaxConcurrency(credentials) {
  if (!credentials) return 3;
  const max = credentials.providerSpecificData?.maxConcurrency;
  if (max === 0 || max === null) return null; // explicit bypass
  if (typeof max === "number" && max > 0) return max;
  return 3; // default: 3 concurrent requests per account
}

export { DEFAULT_BLOCK_MS };
