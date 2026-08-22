/**
 * Circuit Breaker — Vela's self-healing gateway (Seam 1 of Resilience Covenant)
 *
 * Plain-JS port honoring SRouter's 135-line breaker pattern. Provides consecutive-failure
 * escalation with cooldown→exhausted states, exponential backoff (2^n capped 5min), and
 * Retry-After header honoring.
 *
 * Design Decisions:
 * - Fail-open law: every public fn wrapped in try/catch; throw returns neutral=true
 * - State machine per key (poolId|providerId|model): healthy | cooldown | exhausted
 * - In-memory Map + batched flush into proxyFitness.unfit/unfitUntil columns
 * - No schema migration: ephemeral state persists via existing fitness table
 *
 * Key transitions (per spec):
 *   Healthy → Cooldown at 3 consecutive failures
 *   Cooldown → Exhausted at 8 consecutive failures
 *   Backoff = min(2^(n-3), 300_000)ms for cooldown duration
 *
 * Insertion points (proxyFleet.js integration):
 *   - pickSmart (:269) — filter !isAvailable BEFORE unfit check
 *   - recordOutcome — feeds recordSuccess/recordFailure on success/failure path
 *   - recordClaimGate (:409) — maps country_blocked/ip_capped → onRetryAfter or cooldown
 */

const COOLDOWN_THRESHOLD = 3;     // consecutive failures → cooldown
const EXHAUSTED_THRESHOLD = 8;    // consecutive failures → exhausted
const MAX_BACKOFF_MS = 300_000;   // 5 minutes cap

// ────────────────────────────────────────────────────────────────────────────
// Internal state — in-memory only (batched flush to DB)
// ────────────────────────────────────────────────────────────────────────────

// BreakerState shape:
// {
//   failureCount: number,              // consecutive failures since last reset
//   lastFailureAt: number|null,        // timestamp of most recent failure
//   cooldownUntil: number|null,        // epoch ms when cooldown ends
//   retryAfterMs: number|null,         // explicit Retry-After from 429/503 header
//   state: 'healthy'|'cooldown'|'exhausted',
//   poolId: string,                    // key components
//   providerId: string,
//   model: string
// }

const breakerStore = new Map();     // key → BreakerState
const dirtyKeys = new Set();        // keys that need flush

/**
 * Build composite key matching fitness scope (poolId|providerId|model)
 */
function makeKey(poolId, providerId, model) {
  return `${poolId}|${providerId}|${model}`;
}

/**
 * Get or initialize breaker state for a key
 */
function getState(poolId, providerId, model) {
  const key = makeKey(poolId, providerId, model);
  
  if (!breakerStore.has(key)) {
    breakerStore.set(key, {
      failureCount: 0,
      lastFailureAt: null,
      cooldownUntil: null,
      retryAfterMs: null,
      state: 'healthy',
      poolId,
      providerId,
      model,
    });
  }
  
  return breakerStore.get(key);
}

/**
 * Calculate backoff duration based on failure count
 * Formula: min(2^(n-3) seconds, 5 minutes) — exponential, seconds-scale.
 * n=3 → 1s, n=4 → 2s, n=5 → 4s, ... capped at 300s (5 min).
 */
function calculateBackoffMs(failureCount) {
  if (failureCount < COOLDOWN_THRESHOLD) return 0;
  const exponent = failureCount - COOLDOWN_THRESHOLD;
  const backoffSeconds = Math.pow(2, exponent);
  const backoffMs = backoffSeconds * 1000;
  return Math.min(backoffMs, MAX_BACKOFF_MS);
}

/**
 * Mark key as dirty (needs flush on next flush cycle)
 */
function markDirty(poolId, providerId, model) {
  dirtyKeys.add(makeKey(poolId, providerId, model));
}

/**
 * Flush all dirty keys to existing proxyFitness table
 * Upserts into unfit/unfitUntil columns (no schema change)
 */
export async function flushNow() {
  if (dirtyKeys.size === 0) return;
  
  const rowsToFlush = [];
  const nowIso = new Date().toISOString();
  
  for (const key of dirtyKeys) {
    const state = breakerStore.get(key);
    if (!state) continue;
    
    // Only flush if state is not healthy (nothing to persist)
    if (state.state === 'healthy' && !state.cooldownUntil && !state.retryAfterMs) {
      dirtyKeys.delete(key);
      continue;
    }
    
    rowsToFlush.push({
      poolId: state.poolId,
      provider: state.providerId,
      unfit: state.state !== 'healthy' ? 1 : 0,
      unfitReason: state.state === 'exhausted' ? 'breaker_exhausted' : 
                   state.state === 'cooldown' ? 'breaker_cooldown' : null,
      unfitUntil: state.cooldownUntil ? new Date(state.cooldownUntil).toISOString() : null,
      updatedAt: nowIso,
    });
    
    dirtyKeys.delete(key);
  }
  
  if (rowsToFlush.length === 0) return;
  
  try {
    const db = await import('../db/driver.js').then(m => m.getAdapter());
    const { upsertFitnessBatch } = await import('../db/repos/proxyFitnessRepo.js');
    await upsertFitnessBatch(db, rowsToFlush);
  } catch (err) {
    console.warn('[circuitBreaker] flush failed:', err.message);
    // On flush failure, keep keys dirty for retry
    for (const key of rowsToFlush) {
      dirtyKeys.add(makeKey(key.poolId, key.provider, ''));
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — all functions wrap in try/catch (fail-open)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Check if key is available for use
 * @param {string} poolId
 * @param {string} providerId
 * @param {string} model
 * @returns {boolean} true if available (healthy OR cooldown expired)
 */
export function isAvailable(poolId, providerId, model) {
  try {
    const state = getState(poolId, providerId, model);
    const now = Date.now();
    
    // Exhausted state? Check if cooldown period has passed
    if (state.state === 'exhausted') {
      if (!state.cooldownUntil || now >= state.cooldownUntil) {
        // Exponential backoff recovery: move to cooldown instead of healthy
        state.state = 'cooldown';
        state.failureCount = 0;
        // Schedule a short cooldown to test recovery
        state.cooldownUntil = now + 60_000; // 1 minute test window
        markDirty(poolId, providerId, model);
        return true; // allow retry after timeout
      }
      return false;
    }
    
    // Cooldown state? Check if period has passed
    if (state.state === 'cooldown') {
      if (state.cooldownUntil && now >= state.cooldownUntil) {
        // Exit cooldown back to healthy
        state.state = 'healthy';
        state.failureCount = 0;
        state.cooldownUntil = null;
        state.retryAfterMs = null;
        markDirty(poolId, providerId, model);
        return true; // cooldown expired → available
      }
      // Cooldown active: HARD-SKIP — the pool is unavailable until cooldownUntil passes.
      // This is the breaker's core protection (Seam 1 intent: "hard skip of cooldown pools").
      return false;
    }
    
    // Healthy state
    return true;
  } catch (err) {
    console.warn('[circuitBreaker] isAvailable failed:', err.message);
    // Fail-open: assume available
    return true;
  }
}

/**
 * Record a failure event
 * Escalates through states: healthy → cooldown → exhausted
 * @param {string} poolId
 * @param {string} providerId
 * @param {string} model
 * @param {{retryAfterMs?: number}} options
 */
export function recordFailure(poolId, providerId, model, options = {}) {
  try {
    const { retryAfterMs } = options;
    const state = getState(poolId, providerId, model);
    const now = Date.now();
    
    state.failureCount++;
    state.lastFailureAt = now;
    
    // Honor explicit Retry-After header if present
    if (retryAfterMs !== undefined && retryAfterMs !== null) {
      state.retryAfterMs = retryAfterMs;
      state.cooldownUntil = now + retryAfterMs;
    }
    
    // Check escalation thresholds
    if (state.failureCount >= EXHAUSTED_THRESHOLD && state.state !== 'exhausted') {
      state.state = 'exhausted';
      const backoff = calculateBackoffMs(state.failureCount);
      state.cooldownUntil = now + backoff;
      console.info('[circuitBreaker]', poolId, providerId, model, `→ exhausted at ${state.failureCount} failures`);
    } else if (state.state === 'exhausted') {
      // Already exhausted: keep escalating the backoff on every additional failure,
      // so a pool failing 50× isn't stuck at the 8-failure backoff (32s). This is
      // what makes the 5-minute cap reachable.
      const backoff = calculateBackoffMs(state.failureCount);
      state.cooldownUntil = now + backoff;
    } else if (state.failureCount >= COOLDOWN_THRESHOLD && state.state === 'healthy') {
      state.state = 'cooldown';
      const backoff = calculateBackoffMs(state.failureCount);
      state.cooldownUntil = now + backoff;
      console.info('[circuitBreaker]', poolId, providerId, model, `→ cooldown at ${state.failureCount} failures`);
    }
    
    markDirty(poolId, providerId, model);
    
    // Auto-schedule flush
    scheduleFlush();
  } catch (err) {
    console.warn('[circuitBreaker] recordFailure failed:', err.message);
    // Fail-open: don't throw
  }
}

/**
 * Record a success event — resets failure counter to healthy
 * @param {string} poolId
 * @param {string} providerId
 * @param {string} model
 */
export function recordSuccess(poolId, providerId, model) {
  try {
    const state = getState(poolId, providerId, model);
    
    // Only reset if currently failing
    if (state.state !== 'healthy' || state.failureCount > 0) {
      state.state = 'healthy';
      state.failureCount = 0;
      state.cooldownUntil = null;
      state.retryAfterMs = null;
      markDirty(poolId, providerId, model);
      
      // Fitness unfit flag is managed separately in proxyFleet.js
      // Circuit breaker handles consecutive failure escalation independently
    }
  } catch (err) {
    console.warn('[circuitBreaker] recordSuccess failed:', err.message);
    // Fail-open: don't throw
  }
}

/**
 * Explicitly set Retry-After deadline (for 429/503 headers without state machine escalation)
 * @param {string} poolId
 * @param {string} providerId
 * @param {string} model
 * @param {number} ms — milliseconds to add to now
 */
export function onRetryAfter(poolId, providerId, model, ms) {
  try {
    const state = getState(poolId, providerId, model);
    const now = Date.now();
    
    state.retryAfterMs = ms;
    state.cooldownUntil = now + ms;
    
    // If already exhausted, respect the Retry-After; if healthy/cooldownd,
    // ensure we're in cooldown mode
    if (state.state === 'healthy') {
      state.state = 'cooldown';
    }
    
    markDirty(poolId, providerId, model);
    scheduleFlush();
  } catch (err) {
    console.warn('[circuitBreaker] onRetryAfter failed:', err.message);
    // Fail-open
  }
}

/**
 * Get current breaker snapshot (for debugging/monitoring)
 * @returns {Array<object>} list of all breaker states
 */
export function getSnapshot() {
  try {
    const snapshot = [];
    for (const state of breakerStore.values()) {
      snapshot.push({
        poolId: state.poolId,
        providerId: state.providerId,
        model: state.model,
        failureCount: state.failureCount,
        lastFailureAt: state.lastFailureAt,
        cooldownUntil: state.cooldownUntil,
        retryAfterMs: state.retryAfterMs,
        state: state.state,
      });
    }
    return snapshot;
  } catch (err) {
    console.warn('[circuitBreaker] getSnapshot failed:', err.message);
    return [];
  }
}

/**
 * Reset specific key to healthy state (manual override)
 * @param {string} poolId
 * @param {string} providerId
 * @param {string} model
 */
export function resetKey(poolId, providerId, model) {
  try {
    const state = getState(poolId, providerId, model);
    state.state = 'healthy';
    state.failureCount = 0;
    state.cooldownUntil = null;
    state.retryAfterMs = null;
    markDirty(poolId, providerId, model);
    scheduleFlush();
  } catch (err) {
    console.warn('[circuitBreaker] resetKey failed:', err.message);
    // Fail-open
  }
}

/**
 * Schedule background flush (debounced by existing pattern)
 */
let flushTimer = null;
let flushArmed = false;

function scheduleFlush() {
  if (flushArmed) return;
  
  flushArmed = true;
  
  // Flush immediately if many dirty keys (burst optimization)
  if (dirtyKeys.size >= 32) {
    flushNow();
    return;
  }
  
  // Batch flush timer (30s pattern from proxyFleet)
  flushTimer = setTimeout(() => {
    flushNow();
  }, 30_000);
  
  if (flushTimer.unref) flushTimer.unref();
}

/**
 * Clear all state (useful for testing/shutdown)
 */
export function clearAll() {
  breakerStore.clear();
  dirtyKeys.clear();
  if (flushTimer) clearTimeout(flushTimer);
}
