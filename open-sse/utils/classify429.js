/**
 * 429 response classifier — one flat HTTP status, three different retry
 * horizons.
 *
 * Providers return HTTP 429 for three semantically different conditions, and
 * the status alone cannot tell them apart:
 *
 *   rate_limit      — "too many requests in the last minute". Fix: wait ~60s.
 *   quota_exhausted — a long-period cap (monthly / billing / credit based).
 *                     Fix: wait ~1h before touching the account again.
 *   daily_quota     — a daily cap that resets at a day boundary. Fix: lock the
 *                     account until the next 00:00 UTC.
 *
 * Vela's `ERROR_RULES` collapses all three into a single
 * `{ status: 429, backoff: true }` rule, and `markAccountUnavailable` truncates
 * provider-reported resets at `MAX_RATE_LIMIT_COOLDOWN_MS` (30 min) — so a
 * daily-quota-exhausted account is retried roughly every half hour, all day.
 * That is real wasted upstream traffic, not a stylistic gap. This module gives
 * `checkFallbackError` the missing distinction by inspecting the error body
 * (and, where present, the `Retry-After` header).
 *
 * Pure and dependency-light: no request state, no captured clock (callers may
 * inject `now`), so it is unit-testable without a live request.
 *
 * (Ported from VansRouter's `open-sse/utils/classify429.js` — W2, v0.9.75.)
 *
 * @module open-sse/utils/classify429
 */
import {
  RATE_LIMIT_COOLDOWN_MS,
  QUOTA_EXHAUSTED_COOLDOWN_MS,
} from "../config/errorConfig.js";

export { RATE_LIMIT_COOLDOWN_MS, QUOTA_EXHAUSTED_COOLDOWN_MS };

/**
 * Failure kinds returned by {@link classify429}.
 * @typedef {"rate_limit" | "quota_exhausted" | "daily_quota"} FailureKind
 */

/**
 * Heuristic regexes for **daily quota** exhaustion — a cap that resets at the
 * next day boundary (00:00 UTC). Checked BEFORE generic quota exhaustion so
 * daily patterns take priority.
 *
 * Patterns observed across OpenAI free-tier, Google Gemini, Groq, OpenRouter,
 * and Grok CLI free-tier responses.
 */
const DAILY_QUOTA_PATTERNS = [
  /today'?s quota/i,
  /daily quota (exhaust|exceed|reached|used)/i,
  /daily limit (exhaust|exceed|reached|used)/i,
  /per.?day (limit|quota)/i,
  /daily.*exhaust/i,
  /exhaust.*daily/i,
  /daily.*cap/i,
  /cap.*daily/i,
  /reset.*tomorrow/i,
  /try again tomorrow/i,
  /come back tomorrow/i,
  // Grok CLI free-tier daily usage (subscription:free-usage-exhausted) resets
  // at 00:00 UTC — a daily lock, not a 60s rate_limit.
  /free.*usage.*exhaust/i,
  /used all.*free usage/i,
];

/**
 * Heuristic regexes for **quota exhaustion** — a long-period cap (monthly,
 * billing-cycle, credit-based). Does NOT include daily patterns (those are
 * handled separately by {@link DAILY_QUOTA_PATTERNS}).
 *
 * Patterns observed across OpenAI, Anthropic, Groq, Cerebras, Mistral, Google
 * Gemini, and OpenRouter responses.
 */
const QUOTA_EXHAUSTED_PATTERNS = [
  /monthly.*limit/i,
  /monthly.*quota/i,
  /per.?month.*limit/i,
  /quota.*exceed/i,
  /exceed.*quota/i,
  /insufficient.*quota/i,
  /billing.*cap/i,
  /credit.*exhaust/i,
  /out of credits/i,
  /hard.?limit/i,
  /plan.*limit/i,
  /resource.*exhaust/i,
  /check.*quota/i,
  /individual quota reached/i,
  /enable overages/i,
  /402.*billing/i,
  /billing.*required/i,
  /payment.*required/i,
];

/**
 * Coerce a body of unknown shape to a string for keyword scanning.
 * - string: returned as-is
 * - object: JSON-stringified (so a nested error.message gets scanned)
 * - undefined/null: empty string
 */
function bodyToText(body) {
  if (typeof body === "string") return body;
  if (body == null) return "";
  try {
    return JSON.stringify(body);
  } catch {
    return "";
  }
}

/**
 * Returns true if the body looks like a **daily** quota-exhausted error.
 * Checked BEFORE generic quota exhaustion so daily patterns take priority.
 */
export function looksLikeDailyQuota(body) {
  const text = bodyToText(body);
  if (!text) return false;
  return DAILY_QUOTA_PATTERNS.some((pat) => pat.test(text));
}

/**
 * Returns true if the body looks like a generic quota-exhausted error
 * (monthly / billing / credit based). Does NOT match daily patterns.
 */
export function looksLikeQuotaExhausted(body) {
  const text = bodyToText(body);
  if (!text) return false;
  return QUOTA_EXHAUSTED_PATTERNS.some((pat) => pat.test(text));
}

/**
 * Gemini's per-minute RPM (rate LIMIT) messages refresh in ~60s and must NOT
 * become a 60-minute quota lock. Both look like quota errors but are generic:
 *   - "Resource has been exhausted (e.g. check quota)." (RESOURCE_EXHAUSTED)
 *   - "You exceeded your current quota, please check your plan and billing details."
 * NOTE: the RPM text mentions "plan and billing details" — bare "billing" is NOT
 * a real-cap qualifier here (it is just Gemini's standard suggestion). A REAL cap
 * carries specific qualifiers: a reset timeframe, monthly/daily limits, "quota
 * exceeded", "USER_PROJECT quota", or an actual billing/payment block. Those still
 * fall through to quota_exhausted (the ~1h lock).
 *
 * @param {string|object} errorText - raw error body or message
 * @returns {boolean} true when this is Gemini's generic (RPM) exhaustion phrasing
 */
export function isGeminiGenericRateLimit(errorText) {
  const text = typeof errorText === "string"
    ? errorText
    : (() => { try { return JSON.stringify(errorText); } catch { return String(errorText); } })();
  if (!text) return false;
  const isGenericResourceExhausted = /resource has been exhausted/i.test(text);
  const isGenericQuotaExceeded = /exceeded your (current )?quota/i.test(text);
  if (!isGenericResourceExhausted && !isGenericQuotaExceeded) return false;
  // Specific-cap qualifiers that mean a REAL quota/billing cap (keep the long
  // lock): a per-minute reset, monthly/daily limits, USER_PROJECT quota, or an
  // actual billing/payment block. NOTE: do NOT include bare "quota exceeded" —
  // Gemini's RPM body literally says "Quota exceeded for metric:
  // .../embed_content_free_tier_requests", which is the generic RPM limit.
  const hasSpecificQualifier = /per[- ]?minute|rpm|daily quota|per[- ]?day|monthly|user[- ]?project|billing required|payment required|reset (tomorrow|at)|will reset/i.test(text);
  return !hasSpecificQualifier;
}

/**
 * Compute the millisecond offset until the next UTC midnight (tomorrow 00:00 UTC).
 * Used as the cooldown for the `daily_quota` classification.
 *
 * @param {Date} [now=new Date()]
 * @returns {number} ms until next 00:00 UTC (always > 0)
 */
export function getMsUntilTomorrowMidnightUTC(now = new Date()) {
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return Math.max(1, next.getTime() - now.getTime());
}

/** True for the Gemini providers whose RPM refusals reuse quota wording. */
function isGeminiProvider(provider) {
  return provider === "gemini" || provider === "gemini-cli";
}

/**
 * Cooldown for a `rate_limit` classification: an explicit `Retry-After` is
 * honoured, capped at the quota horizon so a bogus header cannot lock an
 * account for days; absent/unparseable → the ~60s default.
 */
function rateLimitCooldownMs(response) {
  const secs = retryAfterFromResponse(response);
  if (secs == null || secs <= 0) return RATE_LIMIT_COOLDOWN_MS;
  return Math.min(secs * 1000, QUOTA_EXHAUSTED_COOLDOWN_MS);
}

/**
 * Classify a 429 response into a `FailureKind` with its cooldown in ms.
 *
 * Decision order:
 * 1. Gemini's generic RPM phrasing → `rate_limit` (must not become a 1h lock).
 * 2. body matches a daily-quota keyword → `daily_quota` (lock to UTC midnight).
 * 3. body matches a quota-exhausted keyword → `quota_exhausted` (~1h).
 * 4. otherwise → `rate_limit` (~60s). A 429 without quota wording is
 *    per-definition a transient rate-limit signal.
 *
 * @param {{ status?: number, body?: unknown, headers?: Record<string, string>,
 *           provider?: string, now?: Date }} response
 * @returns {{ kind: FailureKind, cooldownMs: number }}
 */
export function classify429(response) {
  if (!response || typeof response !== "object") {
    return { kind: "rate_limit", cooldownMs: RATE_LIMIT_COOLDOWN_MS };
  }
  const now = response.now instanceof Date ? response.now : new Date();
  const body = response.body;
  // Gemini's per-minute refusals reuse the words "exhausted"/"quota". Scope the
  // guard to the Gemini providers when the caller knows the provider; when it
  // does not (`checkFallbackError` carries no provider argument), still catch the
  // unmistakably-Google RESOURCE_EXHAUSTED phrasing — but leave "exceeded your
  // current quota" alone, because OpenAI's quota-exhausted 429 uses that exact
  // sentence and IS a real cap.
  if (
    isGeminiGenericRateLimit(body) &&
    (isGeminiProvider(response.provider) || /resource has been exhausted/i.test(bodyToText(body)))
  ) {
    return { kind: "rate_limit", cooldownMs: rateLimitCooldownMs(response) };
  }
  // Daily quota checked first — it is the most specific (a daily cap implies a
  // midnight reset, which is a precise boundary rather than a flat window).
  if (looksLikeDailyQuota(body)) {
    return { kind: "daily_quota", cooldownMs: getMsUntilTomorrowMidnightUTC(now) };
  }
  if (looksLikeQuotaExhausted(body)) {
    return { kind: "quota_exhausted", cooldownMs: QUOTA_EXHAUSTED_COOLDOWN_MS };
  }
  return { kind: "rate_limit", cooldownMs: rateLimitCooldownMs(response) };
}

/**
 * Adapter that takes an error thrown by an HTTP client (fetch wrapper, upstream
 * SDK, etc.) and produces a classified result.
 *
 * Recognises common error shapes:
 * - `err.status` + `err.body` (low-level fetch wrapper)
 * - `err.response.status` + `err.response.data` (axios-style)
 * - `err.message` (last-resort body for keyword scan)
 *
 * @param {unknown} err
 * @returns {{ kind: FailureKind, cooldownMs: number } | null} null when the
 *   error doesn't carry enough information to classify.
 */
export function classify429FromError(err) {
  if (err === null || typeof err !== "object") return null;
  const e = err;
  let status;
  let body;
  if (typeof e.status === "number") {
    status = e.status;
  } else if (typeof e.statusCode === "number") {
    status = e.statusCode;
  }
  if (e.response && typeof e.response === "object") {
    const resp = e.response;
    if (typeof resp.status === "number" && status === undefined) {
      status = resp.status;
    }
    if (resp.data !== undefined) {
      body = resp.data;
    } else if (resp.body !== undefined) {
      body = resp.body;
    }
  }
  if (body === undefined) {
    if (e.body !== undefined) {
      body = e.body;
    } else if (typeof e.message === "string") {
      body = e.message;
    }
  }
  // Only classify a 429 (or a status-less error, which we still attempt to
  // classify from its body as a fallback).
  if (typeof status === "number" && status !== 429) return null;
  return classify429({ status: status ?? 429, body });
}

/**
 * Parse a `Retry-After` header value into seconds.
 *
 * Accepts:
 * - integer seconds: `"60"`
 * - HTTP date: `"Wed, 08 May 2026 03:00:00 GMT"`
 * - Groq-style relative: `"60s"`, `"5m"`, `"2h"`
 *
 * Returns `null` if unparseable.
 */
export function parseRetryAfter(headerValue) {
  if (!headerValue) return null;
  const trimmed = String(headerValue).trim();
  if (!trimmed) return null;
  // Groq-style relative: must check BEFORE the plain-int parse.
  const relMatch = trimmed.match(/^(\d+)([smh])$/i);
  if (relMatch) {
    const n = Number(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    if (Number.isFinite(n)) {
      if (unit === "s") return n;
      if (unit === "m") return n * 60;
      if (unit === "h") return n * 3600;
    }
  }
  // Pure integer seconds.
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  // HTTP date.
  const ts = Date.parse(trimmed);
  if (Number.isFinite(ts)) {
    return Math.max(0, Math.floor((ts - Date.now()) / 1000));
  }
  return null;
}

/**
 * Best-effort case-insensitive header lookup from a plain object or Headers.
 */
function getHeader(headers, name) {
  if (!headers) return undefined;
  const target = name.toLowerCase();
  // Native Headers instance
  if (typeof headers.get === "function") {
    const v = headers.get(name);
    if (v) return v;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) return v;
  }
  return undefined;
}

/**
 * Convenience wrapper: pull the `Retry-After` from a response's headers and
 * parse it to seconds. Returns null if absent or unparseable.
 */
export function retryAfterFromResponse(response) {
  if (!response) return null;
  return parseRetryAfter(getHeader(response.headers, "retry-after"));
}
