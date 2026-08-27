import { ERROR_RULES, BACKOFF_CONFIG, TRANSIENT_COOLDOWN_MS } from "../config/errorConfig.js";
import { classify429 } from "../utils/classify429.js";

/**
 * Calculate exponential backoff cooldown for rate limits (429)
 * Level 1: 1s, Level 2: 2s, Level 3: 4s... → max 4 min
 * @param {number} backoffLevel - Current backoff level
 * @returns {number} Cooldown in milliseconds
 */
export function getQuotaCooldown(backoffLevel = 0) {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, level);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

/**
 * Check if error should trigger account fallback (switch to next account)
 * Config-driven: matches ERROR_RULES top-to-bottom (text rules first, then status)
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message text
 * @param {number} backoffLevel - Current backoff level for exponential backoff
 * @returns {{ shouldFallback: boolean, cooldownMs: number, newBackoffLevel?: number }}
 */
export function checkFallbackError(status, errorText, backoffLevel = 0) {
  const lowerError = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";

  for (const rule of ERROR_RULES) {
    // Text-based rule: match substring in error message
    if (rule.text && lowerError && lowerError.includes(rule.text)) {
      if (rule.cooldownMs === 0) return { shouldFallback: false, cooldownMs: 0 };
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }

    // Status-based rule: match HTTP status code
    if (rule.status && rule.status === status) {
      if (rule.cooldownMs === 0) return { shouldFallback: false, cooldownMs: 0 };
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }
  }

  // Client-caused 4xx (not in ERROR_RULES, e.g. 422/406) must NOT rotate
  // accounts or poison model locks — a different account won't fix a bad
  // request (E-M4). Only genuinely unclassified/transient errors fall back.
  if (status >= 400 && status < 500) {
    return { shouldFallback: false, cooldownMs: 0 };
  }

  // Default: transient cooldown for any unmatched error
  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

/**
 * AI Lab W4b — verdict-aware fallback decision (the fallback seam).
 *
 * The single-model/combo blind spot: a GATEWAY policy block (the 403-shaped
 * internal event, contentPolicyBlocked:true) must reach buildFallbackChain so
 * the unfiltered lane can serve the refused workload — but the legacy
 * checkFallbackError maps a 403 to shouldFallback:false (client-caused 4xx),
 * so the chain never runs. This extension carries the verdict class across the
 * chatCore → combo/account boundary:
 *   - GATEWAY_POLICY_BLOCK → { shouldFallback:true, verdict, reason:'policy' }
 *     (NO account cooldown — a gateway decision is not a health signal)
 *   - otherwise → delegates to the legacy logic verbatim.
 *
 * Callers: combo.js:442 and the single-model seam in handleSingleModelChat
 * (W4b) consult this FIRST; the returned verdict decides whether to append the
 * unfiltered-lane targets from buildFallbackChain.
 */
export function checkFallbackErrorVerdict(status, errorText, opts = {}) {
  if (opts.contentPolicyBlocked === true) {
    return { shouldFallback: true, cooldownMs: 0, verdict: "GATEWAY_POLICY_BLOCK", reason: "policy" };
  }
  // Preserve the legacy path byte-for-byte for every other failure.
  return checkFallbackError(status, errorText, opts.backoffLevel || 0);
}

/**
 * Check if account is currently unavailable (cooldown not expired)
 */
export function isAccountUnavailable(unavailableUntil) {
  if (!unavailableUntil) return false;
  return new Date(unavailableUntil).getTime() > Date.now();
}

/**
 * Calculate unavailable until timestamp
 */
export function getUnavailableUntil(cooldownMs) {
  return new Date(Date.now() + cooldownMs).toISOString();
}

/**
 * Get the earliest rateLimitedUntil from a list of accounts
 * @param {Array} accounts - Array of account objects with rateLimitedUntil
 * @returns {string|null} Earliest rateLimitedUntil ISO string, or null
 */
export function getEarliestRateLimitedUntil(accounts) {
  let earliest = null;
  const now = Date.now();
  for (const acc of accounts) {
    if (!acc.rateLimitedUntil) continue;
    const until = new Date(acc.rateLimitedUntil).getTime();
    if (until <= now) continue;
    if (!earliest || until < earliest) earliest = until;
  }
  if (!earliest) return null;
  return new Date(earliest).toISOString();
}

/**
 * Format rateLimitedUntil to human-readable "reset after Xm Ys"
 * @param {string} rateLimitedUntil - ISO timestamp
 * @returns {string} e.g. "reset after 2m 30s"
 */
export function formatRetryAfter(rateLimitedUntil) {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - Date.now();
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}

/** Prefix for model lock flat fields on connection record */
export const MODEL_LOCK_PREFIX = "modelLock_";

/** Special key used when no model is known (account-level lock) */
export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

/** Build the flat field key for a model lock */
export function getModelLockKey(model) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

/**
 * Check if a model lock on a connection is still active.
 * Reads flat field `modelLock_${model}` (or `modelLock___all` when model=null).
 */
export function isModelLockActive(connection, model) {
  const key = getModelLockKey(model);
  const expiry = connection[key] || connection[MODEL_LOCK_ALL];
  if (!expiry) return false;
  return new Date(expiry).getTime() > Date.now();
}

/**
 * Get earliest active model lock expiry across all modelLock_* fields.
 * Used for UI cooldown display.
 */
export function getEarliestModelLockUntil(connection) {
  if (!connection) return null;
  let earliest = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (t <= now) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  return earliest ? new Date(earliest).toISOString() : null;
}

/**
 * Build update object to set a model lock on a connection.
 */
export function buildModelLockUpdate(model, cooldownMs) {
  const key = getModelLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

/**
 * Build update object to clear all model locks on a connection.
 */
export function buildClearModelLocksUpdate(connection) {
  const cleared = {};
  for (const key of Object.keys(connection)) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
  }
  return cleared;
}

/**
 * Filter available accounts (not in cooldown)
 */
export function filterAvailableAccounts(accounts, excludeId = null) {
  const now = Date.now();
  return accounts.filter(acc => {
    if (excludeId && acc.id === excludeId) return false;
    if (acc.rateLimitedUntil) {
      const until = new Date(acc.rateLimitedUntil).getTime();
      if (until > now) return false;
    }
    return true;
  });
}

/**
 * Reset account state when request succeeds
 * Clears cooldown and resets backoff level to 0
 * @param {object} account - Account object
 * @returns {object} Updated account with reset state
 */
export function resetAccountState(account) {
  if (!account) return account;
  return {
    ...account,
    rateLimitedUntil: null,
    backoffLevel: 0,
    lastError: null,
    status: "active"
  };
}

/**
 * Apply error state to account
 * @param {object} account - Account object
 * @param {number} status - HTTP status code
 * @param {string} errorText - Error message
 * @returns {object} Updated account with error state
 */

/**
 * Kimchi quota-exhaustion patterns — monthly credit caps (distinct from the
 * generic daily quota, which is handled by detectDailyQuotaExhaustion).
 */
const KIMCHI_QUOTA_EXHAUSTED_PATTERNS = [
  /credits?.{0,20}exhausted/i,
  /quota.{0,20}exhausted/i,
  /no remaining credits/i,
  /insufficient[ _-]?credits/i,
  /payment.{0,10}required/i,
  /has exhausted its credits/i,
];

/**
 * Detect whether an error body / message indicates Kimchi quota exhaustion.
 * Pure check — provider name passed in so this can be reused for other providers.
 * @param {string} provider - provider id (e.g. "kimchi")
 * @param {string|object} errorText - raw error body or message
 * @returns {boolean}
 */
export function isKimchiQuotaExhausted(provider, errorText) {
  if (!errorText || provider !== "kimchi") return false;
  const text = typeof errorText === "string"
    ? errorText
    : (() => { try { return JSON.stringify(errorText); } catch { return String(errorText); } })();
  return KIMCHI_QUOTA_EXHAUSTED_PATTERNS.some(p => p.test(text));
}

/**
 * Compute the next-day reset timestamp (00:00 UTC tomorrow).
 * @param {Date} [now=new Date()]
 * @returns {Date}
 */
export function getNextDayReset(now = new Date()) {
  const d = new Date(now.getTime());
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}

/**
 * Build update payload that deactivates a Kimchi account due to quota exhaustion.
 * Sets testStatus="quota_exhausted" (distinguishable from manual deactivation)
 * and rateLimitedUntil to next-day reset, so the existing cooldown filters
 * skip it until then. Auto-reactivation runs on startup / periodically.
 * @param {Date} [now]
 * @returns {{ isActive: boolean, rateLimitedUntil: string, testStatus: string, lastErrorType: string, errorCode: number, quotaExhaustedAt: string }}
 */
export function buildKimchiQuotaExhaustedUpdate(now = new Date()) {
  const reset = getNextDayReset(now);
  return {
    isActive: false,
    rateLimitedUntil: reset.toISOString(),
    testStatus: "quota_exhausted",
    lastErrorType: "quota_exhausted",
    errorCode: 402,
    quotaExhaustedAt: now.toISOString(),
    quotaResetsAt: reset.toISOString(),
  };
}

/**
 * Build update payload to reactivate a quota-exhausted Kimchi account whose
 * rateLimitedUntil has passed (start of new month).
 * @returns {{ isActive: boolean, rateLimitedUntil: null, testStatus: string }}
 */
export function buildKimchiQuotaReactivatedUpdate() {
  return {
    isActive: true,
    rateLimitedUntil: null,
    testStatus: "active",
    quotaExhaustedAt: null,
    quotaResetsAt: null,
  };
}

/**
 * Detect whether a NON-Kimchi 429 error indicates a DAILY quota exhaustion
 * ("today's quota", "daily quota exhausted", "reset tomorrow", etc.).
 *
 * This generalizes beyond Kimchi's monthly quota (which keeps its own
 * isKimchiQuotaExhausted / next-month deactivation logic untouched). When a
 * daily quota is detected, the SPECIFIC model on that connection is locked
 * until tomorrow 00:00 UTC via buildDailyQuotaLockUpdate().
 *
 * Returns the classified cooldown info, or null when the error is not a
 * daily-quota 429 (e.g. it's a plain rate_limit or a Kimchi quota).
 *
 * @param {string} provider - provider id
 * @param {string|object} errorText - raw error body or message
 * @returns {{ kind: "daily_quota", cooldownMs: number } | null}
 */
export function detectDailyQuotaExhaustion(provider, errorText) {
  if (!errorText || provider === "kimchi") return null;
  const text = typeof errorText === "string"
    ? errorText
    : (() => { try { return JSON.stringify(errorText); } catch { return String(errorText); } })();
  // classify429 returns { kind, cooldownMs }. We only act on daily_quota here;
  // quota_exhausted (monthly/billing) is handled separately and rate_limit
  // is handled by the normal account cooldown/backoff path.
  const classification = classify429({ status: 429, body: text, provider });
  if (classification.kind !== "daily_quota") return null;
  return classification;
}

/**
 * Build update payload that locks a SPECIFIC model on a connection until
 * tomorrow 00:00 UTC. The account itself stays active for OTHER models —
 * only the affected model is temporarily unusable.
 *
 * Uses the existing modelLock_${model} flat-field mechanism (same as transient
 * model locks), so no schema changes are needed and isModelLockActive() picks
 * it up automatically.
 *
 * @param {string} model - the model id (without provider prefix)
 * @param {Date} [now=new Date()]
 * @returns {Record<string, string>} partial update object with the model lock key set
 */
export function buildDailyQuotaLockUpdate(model, now = new Date()) {
  if (!model) return {};
  const resetMs = getMsUntilTomorrowMidnightUTC(now);
  const key = getModelLockKey(model);
  return { [key]: new Date(now.getTime() + resetMs).toISOString() };
}

/** Compute ms until next UTC midnight (tomorrow 00:00 UTC). */
function getMsUntilTomorrowMidnightUTC(now = new Date()) {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return Math.max(tomorrow.getTime() - now.getTime(), 1000);
}

export function applyErrorState(account, status, errorText) {
  if (!account) return account;

  const backoffLevel = account.backoffLevel || 0;
  const { cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);

  return {
    ...account,
    rateLimitedUntil: cooldownMs > 0 ? getUnavailableUntil(cooldownMs) : null,
    backoffLevel: newBackoffLevel ?? backoffLevel,
    lastError: { status, message: errorText, timestamp: new Date().toISOString() },
    status: "error"
  };
}
