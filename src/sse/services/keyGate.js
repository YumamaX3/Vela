// The key gate — stage pipeline for every /v1 authorization decision.
// Plan: plans/vela-key-governance.md §3.4. Invoked post-body-parse at the
// 11 enforcement sites. Fail-closed, distinct honest codes, ordered stages.
//
// Stage order (cheapest denial first):
//   extract → identity → lifetime → ipGate → rateGate → spendGate (legacy
//   per-key caps) → modelScope → budgetGate (Observatory hierarchy, W3-B —
//   gateway|key|model scopes, distinct *_budget_exceeded 429 codes; it reads
//   the ledger, so it sits last, after the in-memory stages)
//
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { resolveKey, getApiKeyById } from "@/lib/db/repos/apiKeysRepo.js";
import { touchKeyLastUsed, getUsageDailySince } from "@/lib/db/repos/usageRepo.js";
import { parseModel } from "./model.js";
import { budgetStage } from "./budgetGate.js";
import { applyPlanDefaults } from "./planDefaults.js";
import { resolveProviderId, AI_PROVIDERS } from "@/shared/constants/providers.js";
import { recordSecurityEvent } from "@/lib/security/securityEvents.js";

export const GATE_CODES = {
  INVALID_KEY: "invalid_api_key",
  KEY_PAUSED: "key_paused",
  KEY_EXPIRED: "key_expired",
  MODEL_FORBIDDEN: "model_not_allowed",
  IP_NOT_ALLOWED: "ip_not_allowed",
  RATE_LIMITED: "rate_limited",
  BUDGET_EXCEEDED: "budget_exceeded",
  QUERY_PARAM_KEY_REJECTED: "query_param_key_rejected",
};

// `extraHeaders` is additive (all existing callers pass nothing): a denial may
// carry honest response headers — today the rate stage's Retry-After.
function deny(status, code, message, extraHeaders = null) {
  const verdict = { ok: false, code, message, status };
  if (extraHeaders) verdict.headers = extraHeaders;
  verdict.response = errorResponse(status, `${message} (${code})`, extraHeaders ? { extraHeaders } : {});
  return verdict;
}

/** Header-only extraction — ?key= is dead (rejected upstream at the guard). */
export function extractKeyFromHeaders(request) {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  return request.headers.get("x-api-key") || request.headers.get("x-goog-api-key") || null;
}

/** The ResolvedKey contract — W2/W3 extend the object, never the call signature. */
function toResolvedKey(row) {
  return {
    keyId: row.id,
    keyPrefix: row.keyPrefix,
    name: row.name,
    allowedModels: safeParse(row.allowedModels),
    // Per-key ACL (v0.9.17) — tri-state: null = all, [] = none, ["x"] = whitelist.
    allowedKinds: safeParse(row.allowedKinds),
    allowedProviders: safeParse(row.allowedProviders),
    allowedCombos: safeParse(row.allowedCombos),
    isInternal: row.isInternal === 1 || row.isInternal === true,
    expiresAt: row.expiresAt || null,
    rateLimitRpm: row.rateLimitRpm ?? null,
    // Five-dimension rate limits (migration 025) — projected verbatim; the
    // gate enforces a dimension only when it is a positive integer.
    rateLimitTpm: row.rateLimitTpm ?? null,
    rateLimitRph: row.rateLimitRph ?? null,
    rateLimitRpd: row.rateLimitRpd ?? null,
    maxConcurrentRequests: row.maxConcurrentRequests ?? null,
    tokenBudgetDaily: row.tokenBudgetDaily ?? null,
    spendCapDailyCents: row.spendCapDailyCents ?? null,
    budgetScope: row.budgetScope || null,
    ipAllowlist: safeParse(row.ipAllowlist),
    planId: row.planId || null,
  };
}

function safeParse(v) {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return null; }
}

// ── lastUsedAt: fire-and-forget through the repo seam ────────────────────
// The throttle now lives INSIDE touchKeyLastUsed (the Twin Harbors seam) so
// every harbor — sqlite today, mysql/mirror from Wave A6 — owns its own
// write cadence. keyGate merely touches; it no longer reaches for the raw
// adapter. resolveKey also touches (its own call site), so the seam's
// per-keyId throttle is what keeps both from double-writing within 60s.
function touchLastUsed(keyId) {
  touchKeyLastUsed(keyId).catch(() => {});
}

// ── Stages ────────────────────────────────────────────────────────────────

export function lifetimeStage(key) {
  // W2: expiresAt check. Null = no expiry.
  if (key.expiresAt && key.expiresAt <= new Date().toISOString()) {
    return deny(HTTP_STATUS.UNAUTHORIZED, GATE_CODES.KEY_EXPIRED, "API key expired");
  }
  return { ok: true };
}

// ── CIDR matching (W3 ip stage) ──────────────────────────────────────────
// Primitives live in lib/db/keyLimits.js (shared with repo-side validation —
// the repo must not import this file; this file imports the repo).
export { parseCidr, cidrContains } from "@/lib/db/keyLimits.js";
import { cidrContains } from "@/lib/db/keyLimits.js";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer.js";

/** Derive the real client IP. custom-server.js strips attacker-controlled
 *  forwarding headers and stamps the socket peer into x-9r-real-ip — proving
 *  the stamp by echoing the per-process secret as x-9r-peer-token. Without
 *  that proof the header is attacker-supplied input, so the gate ignores it
 *  (GHSA-pjm4-8fpg-f9p6; upstream has no key gate, this surface is Vela's). */
export function extractClientIp(request) {
  if (!request) return null;
  if (!hasTrustedPeerHeaders(request)) return null;
  return request.headers.get?.("x-9r-real-ip") || null;
}

/** Loopback hostnames recognized by the Host-header fallback. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHostname(host) {
  if (!host) return false;
  const name = host.split(":")[0].replace(/^\[|\]$/g, "").toLowerCase();
  return LOOPBACK_HOSTS.has(name);
}

/**
 * Resolve the client IP for the gate. Order: explicit override → the trusted
 * x-9r-real-ip header (socket-stamped, peer-token-proven) → a narrowly-scoped
 * Host-header fallback.
 *
 * The fallback exists ONLY so server-to-server self-calls (the model-test ping)
 * work when the process runs as bare `next dev` without custom-server.js —
 * there is no TCP-socket IP to stamp in that mode. It is deliberately narrow:
 * it applies only to internal keys (already minted loopback-only), only via a
 * loopback Host, and only in development (Host is spoofable; production
 * runs custom-server.js, which stamps the proven IP). An external attacker
 * cannot widen an external key's IP allowlist — those still fail closed
 * without a proven IP. Mirrors the dev fallback in dashboardGuard.isLoopbackPeer().
 */
export function resolveClientIp(request, { clientIp = null, isInternal = false } = {}) {
  if (clientIp) return clientIp;
  const stamped = extractClientIp(request);
  if (stamped) return stamped;
  if (isInternal && process.env.NODE_ENV === "development" && isLoopbackHostname(request?.headers?.get?.("host"))) {
    return "127.0.0.1";
  }
  return null;
}

export function ipStage(key, { clientIp } = {}) {
  // W3: CIDR allowlist. Null/empty = unrestricted. An allowlist with no
  // resolvable client IP fails CLOSED — we cannot prove the caller belongs.
  if (!key.ipAllowlist?.length) return { ok: true };
  if (!clientIp) {
    return deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.IP_NOT_ALLOWED, "Client address could not be determined for this allowlisted key");
  }
  for (const entry of key.ipAllowlist) {
    if (cidrContains(entry, clientIp)) return { ok: true };
  }
  return deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.IP_NOT_ALLOWED, "Client address is not in this key's IP allowlist");
}

// ── Rate limiting (W3 rate stage → migration 025 five dimensions) ────────
// Five per-key ceilings, each over its own window, each 429 + Retry-After:
//
//   rpm  — requests per 60s       ┐
//   rph  — requests per 3600s     ├ one shared in-memory stamp log (sync)
//   rpd  — requests per 86400s    ┘
//   tpm  — tokens per 60s         — summed from the usage ledger (async)
//   concurrent — in-flight slots  — an incremented/decremented counter
//
// The stamp log is per keyId, process-local, pruned to the LONGEST window
// (RPD, 86400s) so all three request ceilings count from one array — never
// three. It survives module reloads via a global singleton; eviction keeps
// the map bounded. The token and concurrency dimensions read the ledger and
// the in-flight counter respectively, and live in the async half of the gate
// (rateAsyncStage), where the ledger read is available and awaited.
//
// Failure law: a ceiling that cannot be READ (a DB error on TPM) is a PASS —
// an unreadable ceiling must never lock a key out. A ceiling that is read and
// CROSSED is a 429. Zero/absent = the dimension is off.

import { RATE_DIMENSIONS, RATE_LOG_SPAN_MS } from "@/lib/db/keyLimits.js";
import { getKeyWindowsSince } from "@/lib/db/repos/usageRepo.js";

const RATE_MAP_MAX_KEYS = 10_000;
/** TTL safety net for the in-flight counter — a slot whose response never
 *  settled (a hung stream, a worker that died mid-request) frees itself. */
export const CONCURRENCY_SLOT_TTL_MS = 15 * 60_000;
const DEFAULT_RETRY_AFTER_SEC = 60;

/** The request-count dimensions, in the order they are reported. */
const REQUEST_DIMENSIONS = RATE_DIMENSIONS.filter((d) => d.field !== "rateLimitTpm");
const TPM_DIMENSION = RATE_DIMENSIONS.find((d) => d.field === "rateLimitTpm");

function rateWindowMap() {
  if (!global._velaRateWindows) global._velaRateWindows = new Map();
  return global._velaRateWindows;
}

/** Count stamps in [now - windowMs, now] within the (oldest-first) log. */
function countWithin(stamps, now, windowMs) {
  const floor = now - windowMs;
  let n = 0;
  for (let i = stamps.length - 1; i >= 0 && stamps[i] > floor; i--) n++;
  return n;
}

/** Honest Retry-After for a full request window: the seconds until the k-th
 *  oldest in-window stamp ages OUT, where k = stamps - limit + 1. That is
 *  the first instant the window holds limit-1 stamps — the first slot free.
 *  Rounded up (sub-second waits still count as 1s), floored at 1. */
function retryAfterFor(stamps, now, windowMs, limit) {
  const floor = now - windowMs;
  const inWindow = stamps.filter((t) => t > floor);
  const freeing = inWindow[inWindow.length - limit] ?? inWindow[0];
  return Math.max(1, Math.ceil((freeing + windowMs - now) / 1000));
}

function rateDeny(unit, limit, retryAfterSec) {
  return deny(
    HTTP_STATUS.RATE_LIMITED,
    GATE_CODES.RATE_LIMITED,
    // Honest English at any ceiling: "1 request per hour", "2 requests per minute".
    // The unit reads "requests per hour" (plural form); drop the s for a ceiling of 1.
    `Rate limit exceeded: ${limit} ${limit === 1 ? unit.replace(/^requests/, "request").replace(/^tokens/, "token") : unit}`,
    { "Retry-After": String(Math.max(1, Math.round(retryAfterSec || DEFAULT_RETRY_AFTER_SEC))) }
  );
}

function hasLimit(v) {
  return Number.isInteger(v) && v > 0;
}

/**
 * The SYNC rate stage — rpm / rph / rpd over the shared stamp log.
 * Returns { ok: true } (and pushes this request's stamp) or a 429 denial.
 * Untouched dimensions (null / 0) are skipped entirely and never stamped, so
 * a key with no request ceilings costs one length check.
 */
export function rateStage(key) {
  const limited = REQUEST_DIMENSIONS.filter((d) => hasLimit(key[d.field]));
  if (!limited.length) return { ok: true };
  const windows = rateWindowMap();
  const now = Date.now();
  let stamps = windows.get(key.keyId);
  if (!stamps) {
    stamps = [];
    windows.set(key.keyId, stamps);
  }
  // Prune to the LONGEST window — every shorter window is a prefix read.
  while (stamps.length && stamps[0] <= now - RATE_LOG_SPAN_MS) stamps.shift();
  if (windows.size > RATE_MAP_MAX_KEYS) {
    for (const [k, s] of windows) {
      while (s.length && s[0] <= now - RATE_LOG_SPAN_MS) s.shift();
      if (!s.length && k !== key.keyId) windows.delete(k);
      if (windows.size <= RATE_MAP_MAX_KEYS) break;
    }
  }
  // Evaluate every request window BEFORE stamping: a denial must not consume
  // a slot the client never spent.
  for (const dim of limited) {
    const limit = key[dim.field];
    if (countWithin(stamps, now, dim.windowMs) >= limit) {
      return rateDeny(dim.unit, limit, retryAfterFor(stamps, now, dim.windowMs, limit));
    }
  }
  stamps.push(now);
  return { ok: true };
}

// ── In-flight slots (maxConcurrentRequests) ──────────────────────────────
// A per-keyId counter held by a global singleton. incrementSlot() reserves a
// slot at gate pass and returns a release function; the caller's response
// settle calls it (idempotent — a double release is a no-op). Each slot
// carries its own expiry: if a response never settles, the slot must not be
// lost forever, so a slot older than CONCURRENCY_SLOT_TTL_MS is reclaimed on
// the next check. That is a SAFETY NET, not a policy — the normal path frees
// the slot the moment the response settles.

function concurrencyMap() {
  if (!global._velaKeySlots) global._velaKeySlots = new Map();
  return global._velaKeySlots;
}

/** Live in-flight count for a key, TTL-expired slots excluded. */
export function inflightCount(keyId, now = Date.now()) {
  const slots = concurrencyMap().get(keyId);
  if (!slots) return 0;
  let live = 0;
  for (const t of slots) if (t > now - CONCURRENCY_SLOT_TTL_MS) live++;
  return live;
}

/**
 * Reserve one in-flight slot. Returns { ok, release } — release() is safe to
 * call any number of times. On denial `retryAfterSec` is the time until the
 * OLDEST live slot may expire (the TTL net) — honest, though pessimistic:
 * the slot likely frees sooner when its response settles.
 */
export function incrementSlot(key) {
  const limit = key.maxConcurrentRequests;
  if (!hasLimit(limit)) return { ok: true, release: () => {} };
  const map = concurrencyMap();
  const now = Date.now();
  let slots = map.get(key.keyId);
  if (!slots) {
    slots = [];
    map.set(key.keyId, slots);
  }
  // Reclaim expired slots (the safety net) and bound the map.
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i] <= now - CONCURRENCY_SLOT_TTL_MS) slots.splice(i, 1);
  }
  if (map.size > RATE_MAP_MAX_KEYS) {
    for (const [k, s] of map) {
      if (k === key.keyId) continue;
      const live = s.filter((t) => t > now - CONCURRENCY_SLOT_TTL_MS);
      if (!live.length) map.delete(k);
      else s.length = live.length;
      if (map.size <= RATE_MAP_MAX_KEYS) break;
    }
  }
  if (slots.length >= limit) {
    const oldest = Math.min(...slots);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + CONCURRENCY_SLOT_TTL_MS - now) / 1000));
    return { ok: false, retryAfterSec, release: () => {} };
  }
  const stamp = now;
  slots.push(stamp);
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      const live = map.get(key.keyId);
      if (!live) return;
      const idx = live.lastIndexOf(stamp);
      if (idx >= 0) live.splice(idx, 1);
      if (!live.length) map.delete(key.keyId);
    },
  };
}

/** The concurrency denial, shaped like every other rate denial. */
export function concurrencyStage(key) {
  const slot = incrementSlot(key);
  if (slot.ok) return { ok: true, release: slot.release };
  return {
    ...rateDeny("concurrent requests", key.maxConcurrentRequests, slot.retryAfterSec),
  };
}

// ── Tokens per minute (rateLimitTpm) ─────────────────────────────────────
// Summed from the usage ledger — the same rows saveRequestUsage writes and
// the dashboard reads — over [now - 60s, now]. Soft check: a read failure is
// a PASS (fail-open on an unreadable ceiling), never a 429. Retry-After is
// when the OLDEST row in the window ages out of 60s (it is the first token
// budget to return); floor 1s so we never promise "retry now".
export async function tokenRateStage(key, { now = Date.now() } = {}) {
  const limit = key.rateLimitTpm;
  if (!hasLimit(limit)) return { ok: true };
  let window = null;
  try {
    window = await getKeyWindowsSince(key.keyId, now - TPM_DIMENSION.windowMs);
  } catch {
    return { ok: true }; // unreadable ceiling → pass
  }
  if (!window || window.tokens < limit) return { ok: true };
  let retryAfterSec = DEFAULT_RETRY_AFTER_SEC;
  const oldest = window.oldestAt ? Date.parse(window.oldestAt) : NaN;
  if (Number.isFinite(oldest)) {
    retryAfterSec = Math.max(1, Math.ceil((oldest + TPM_DIMENSION.windowMs - now) / 1000));
  }
  return rateDeny(TPM_DIMENSION.unit, limit, retryAfterSec);
}

/**
 * The ASYNC half of the rate pipeline — TPM (a ledger read) and in-flight
 * slots (a counter that must be released on settle). Called by the gate after
 * the sync stages, in this order: tokens first (no side effect), then the
 * slot (which reserves state and therefore goes last — a TPM denial must
 * never leak a reserved slot). Denials carry the SAME *_rate_limited code and
 * a Retry-After. On every other path the verdict carries `release` (a no-op
 * when no ceiling is set) so the caller can hold it until the response
 * settles.
 */
export async function rateAsyncStage(key) {
  const tokenVerdict = await tokenRateStage(key);
  if (!tokenVerdict.ok) return tokenVerdict;
  const slot = concurrencyStage(key);
  if (!slot.ok) return slot;
  return { ok: true, release: slot.release };
}

// ── Token + spend budgets (W3 spend stage) ───────────────────────────────
// One window (budgetScope) governs BOTH budgets: daily | weekly | monthly |
// yearly. Column names carry "Daily" for migration compatibility; the scope
// decides the actual reset cadence. Usage aggregates from usageDaily rows —
// the same ledger the dashboard reads — with a short TTL cache so hot paths
// do not re-sum the ledger on every request. The check is a soft cap: the
// request in flight is counted after it completes.

export { BUDGET_SCOPES } from "@/lib/db/keyLimits.js";
import { BUDGET_SCOPES } from "@/lib/db/keyLimits.js";
const BUDGET_CACHE_TTL_MS = 5_000;
const BUDGET_CACHE_MAX = 2_000;

function budgetCache() {
  if (!global._velaBudgetCache) global._velaBudgetCache = new Map();
  return global._velaBudgetCache;
}

/** Local YYYY-MM-DD — matches usageDaily.dateKey's local-day convention. */
export function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Start dateKey of the window containing `now` (local-time boundaries,
 *  same convention as the ledger that stores local dateKeys). */
export function windowStartDateKey(scope, now = new Date()) {
  switch (scope) {
    case "weekly": {
      // ISO weeks start Monday
      const day = now.getDay() || 7; // Sunday → 7
      const monday = new Date(now);
      monday.setDate(now.getDate() - (day - 1));
      return localDateKey(monday);
    }
    case "monthly":
      return localDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    case "yearly":
      return localDateKey(new Date(now.getFullYear(), 0, 1));
    case "daily":
    default:
      return localDateKey(now);
  }
}

function scopeLabel(scope) {
  return { daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly" }[scope] || "Daily";
}

/** Sum tokens + cost for one keyId across usageDaily rows ≥ startDateKey.
 *  Reads through the repo seam (getUsageDailySince) so the spend stage never
 *  touches the raw adapter — the ledger stays behind the harbor boundary. */
export async function sumKeyUsage(keyId, startDateKey) {
  const days = await getUsageDailySince(startDateKey);
  let tokens = 0, costCents = 0;
  for (const day of days) {
    if (!day?.byApiKey) continue;
    for (const entry of Object.values(day.byApiKey)) {
      if (entry?.meta?.keyId !== keyId) continue;
      tokens += (entry.promptTokens || 0) + (entry.completionTokens || 0);
      costCents += Math.round((entry.cost || 0) * 100);
    }
  }
  return { tokens, costCents };
}

export async function spendStage(key) {
  const tokenBudget = key.tokenBudgetDaily;
  const spendCap = key.spendCapDailyCents;
  if (!tokenBudget && !spendCap) return { ok: true };
  const scope = BUDGET_SCOPES.includes(key.budgetScope) ? key.budgetScope : "daily";

  const startDateKey = windowStartDateKey(scope);
  const cacheKey = `${key.keyId}:${scope}:${startDateKey}`;
  const cache = budgetCache();
  const nowMs = Date.now();
  let usage = cache.get(cacheKey);
  if (!usage || nowMs - usage.ts > BUDGET_CACHE_TTL_MS) {
    usage = { ...(await sumKeyUsage(key.keyId, startDateKey)), ts: nowMs };
    if (cache.size >= BUDGET_CACHE_MAX) {
      for (const [k, v] of cache) {
        if (nowMs - v.ts > BUDGET_CACHE_TTL_MS) cache.delete(k);
        if (cache.size < BUDGET_CACHE_MAX) break;
      }
      // Still full (no stale entries) — free one slot so the map stays bounded.
      if (cache.size >= BUDGET_CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest && oldest !== cacheKey) cache.delete(oldest);
      }
    }
    cache.set(cacheKey, usage);
  }

  const label = scopeLabel(scope);
  if (tokenBudget && usage.tokens >= tokenBudget) {
    return deny(
      HTTP_STATUS.RATE_LIMITED,
      GATE_CODES.BUDGET_EXCEEDED,
      `${label} token budget exceeded: ${usage.tokens} of ${tokenBudget} tokens used`
    );
  }
  if (spendCap && usage.costCents >= spendCap) {
    return deny(
      HTTP_STATUS.RATE_LIMITED,
      GATE_CODES.BUDGET_EXCEEDED,
      `${label} spend cap exceeded: $${(usage.costCents / 100).toFixed(2)} of $${(spendCap / 100).toFixed(2)} used`
    );
  }
  return { ok: true };
}

// ── Per-key ACL (v0.9.17) — kinds / providers / combos / models ────────────
// Tri-state semantics per dimension (VansRouter §1, seam-native):
//   null              → all allowed (unrestricted)
//   []                → none allowed (deny everything)
//   ["x", "y"]        → only listed items allowed (whitelist)
// Fail-open: a dimension that is null/undefined never blocks. The resolver
// chain for providers accepts direct ID, alias, resolved provider/model, and
// provider-prefix forms so ACL entries survive provider renames.

export const SERVICE_KINDS = ["llm", "embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music", "web"];

/**
 * Resolve the service kind for a request.
 * The handler KNOWS its kind (chat → "llm", tts → "tts", fetch → "webFetch",
 * …) and passes it explicitly — matching VansRouter's per-handler
 * isKindAllowed(apiKeyInfo, "<kind>") pattern. Combo requests are "llm" by
 * convention (their members are checked individually at dispatch). Unknown
 * → "llm" (the default kind, matching Vela's model-kind resolution).
 */
function resolveRequestKind({ kind = null } = {}) {
  if (kind && SERVICE_KINDS.includes(kind)) return kind;
  return "llm";
}

/** Tri-state check: returns true when `value` is permitted for `allowlist`. */
export function triStateAllowed(allowlist, value) {
  if (allowlist == null) return true; // unrestricted
  if (!Array.isArray(allowlist)) return true; // malformed → fail-open
  if (allowlist.length === 0) return false; // [] = deny all
  return allowlist.includes(value);
}

/**
 * Kind stage — blocks requests whose service kind is outside the key's
 * allowedKinds. The kind is resolved from the model prefix; combos default to
 * "llm" (their members are checked individually at dispatch).
 */
export function kindStage(key, { kind = null } = {}) {
  if (key.allowedKinds == null) return { ok: true };
  const resolvedKind = resolveRequestKind({ kind });
  if (triStateAllowed(key.allowedKinds, resolvedKind)) return { ok: true };
  return deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.MODEL_FORBIDDEN, `Service kind "${resolvedKind}" not allowed for this API key`);
}

/**
 * Provider stage — blocks requests whose provider (from the model's
 * provider/model prefix) is outside allowedProviders. Alias-resolved: the
 * request may name an alias; the ACL checks both the raw prefix and the
 * resolved provider id.
 *
 * Combo requests are exempt by construction: a combo is resolved before the
 * gate runs (comboModels present), and combo names may themselves contain
 * slashes (v0.9.39 — "vela/cc/opus") that must never be read as a provider
 * prefix. Their members are checked by modelScopeStage at dispatch time;
 * comboStage checks the combo name itself.
 */
export function providerStage(key, { requestModel = null, comboModels = null } = {}) {
  if (key.allowedProviders == null) return { ok: true };
  if (!requestModel) return { ok: true };
  if (Array.isArray(comboModels) && comboModels.length) return { ok: true }; // resolved combo — its scope
  if (requestModel.startsWith("combo/")) return { ok: true }; // legacy combo addressing — comboStage's scope
  const slash = requestModel.indexOf("/");
  const provider = slash > 0 ? requestModel.slice(0, slash) : "";
  if (!provider) return { ok: true };
  if (triStateAllowed(key.allowedProviders, provider)) return { ok: true };
  // Alias-resolved form: the resolved provider id (e.g. request says "oc/…",
  // ACL lists "openai-codex") — resolve via the shared provider registry.
  // Static import at top of file avoids a require() in ESM.
  const resolved = resolveProviderId(provider);
  if (resolved && resolved !== provider && triStateAllowed(key.allowedProviders, resolved)) return { ok: true };
  return deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.MODEL_FORBIDDEN, `Provider "${provider}" not allowed for this API key`);
}

/**
 * Combo stage — blocks combo requests whose combo is outside allowedCombos.
 * Two addressing forms: a resolved combo (comboModels present — the FULL
 * slash-bearing name is checked, v0.9.39) and the legacy "combo/<name>"
 * request form (the prefix is stripped before matching).
 */
export function comboStage(key, { requestModel = null, comboModels = null } = {}) {
  if (key.allowedCombos == null) return { ok: true };
  const isResolvedCombo = Array.isArray(comboModels) && comboModels.length && requestModel;
  const comboName = isResolvedCombo
    ? requestModel
    : requestModel && requestModel.startsWith("combo/")
      ? requestModel.slice("combo/".length)
      : null;
  if (!comboName) return { ok: true };
  if (triStateAllowed(key.allowedCombos, comboName)) return { ok: true };
  return deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.MODEL_FORBIDDEN, `Combo "${comboName}" not allowed for this API key`);
}

const STAGES = [lifetimeStage, ipStage, rateStage, spendStage, kindStage, providerStage, comboStage];

// Observatory budget hierarchy (W3-B). Kept OUT of STAGES because it needs
// requestModel (model-scope budgets) which the per-key stages do not, and it
// also applies on the keyless passthrough where no key object exists. It is
// the most expensive stage (ledger read), so it runs last — after the cheap
// in-memory stages have already passed.

function modelMatchesScope(scopeSet, modelStr) {
  if (!modelStr) return false;
  if (scopeSet.has(modelStr)) return true;
  // Normalized provider/model form (alias-resolved shape)
  const parsed = parseModel(modelStr);
  if (parsed?.provider && parsed?.model && scopeSet.has(`${parsed.provider}/${parsed.model}`)) return true;
  return false;
}

/**
 * Model scope: null scope = unrestricted. A combo request passes its expanded
 * members — allowed iff EVERY member is in scope (grant-time membership is
 * evaluated at request time; documented).
 */
export function modelScopeStage(key, { requestModel, comboModels } = {}) {
  if (!key.allowedModels) return { ok: true };
  const scope = new Set(key.allowedModels);
  if (Array.isArray(comboModels) && comboModels.length) {
    const missing = comboModels.filter((m) => !modelMatchesScope(scope, m));
    if (missing.length) {
      return deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.MODEL_FORBIDDEN, "Model not allowed for this API key");
    }
    return { ok: true };
  }
  if (requestModel && !modelMatchesScope(scope, requestModel)) {
    return deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.MODEL_FORBIDDEN, "Model not allowed for this API key");
  }
  return { ok: true };
}

/**
 * Append the security-log line for a denial. Fail-open and fire-and-forget:
 * recordSecurityEvent never throws and resolves to a boolean, so the 429 this
 * accompanies is never delayed by, nor failed because of, the ledger.
 *
 * What is recorded: the gate's own verdict code, the dimension/window when the
 * message names one, the status, the keyPrefix when it is already known (never
 * a re-read — an IP denial must not cost a second DB round-trip). What is NOT:
 * the message's figures are derived from the operator's own limits, so they
 * are safe; the presented key is never, and never has been, in scope here.
 */
function recordDeniedVerdict(verdict, key, ip) {
  try {
    const detail = { code: verdict?.code || null, status: verdict?.status ?? null };
    const m = /^(\w+)\s+(\w+)\s+(?:budget|cap) exceeded/.exec(verdict?.message || "");
    if (m) { detail.window = m[1].toLowerCase(); detail.dimension = m[2].toLowerCase(); }
    if (/^Rate limit exceeded/.test(verdict?.message || "")) {
      detail.dimension = /tokens/.test(verdict.message) ? "tpm" : "requests";
      if (verdict.headers?.["Retry-After"]) detail.retryAfterSec = Number(verdict.headers["Retry-After"]) || null;
    }
    const keyId = key?.keyId || null;
    if (key?.keyPrefix) detail.keyPrefix = key.keyPrefix;
    const kind = verdict?.status === HTTP_STATUS.RATE_LIMITED ? "rate.limited" : "gate.denied";
    // A budget_exceeded verdict also carries 429 — name it for what it is.
    const named = verdict?.code === GATE_CODES.BUDGET_EXCEEDED ? "budget.exceeded" : kind;
    recordSecurityEvent({ keyId, kind: named, detail, ip: ip || null });
  } catch {
    // recordSecurityEvent cannot throw; this guard keeps the gate total even
    // if a future detail shape slips past it.
  }
}

/**
 * The gate. Returns { ok: true, key: ResolvedKey } or { ok: false, response }.
 * - settings.requireApiKey === false → identity/ACL stages skip (key: null) —
 *   behavior frozen since key governance — BUT Observatory gateway/model
 *   budgets still bind the keyless passthrough (W3-B): a cap that cannot reach
 *   keyless traffic is a cap anyone can walk around by omitting the key.
 * - allowInternal: only MITM-facing paths pass true
 */
export async function authorizeApiRequest(
  request,
  { requestModel = null, comboModels = null, settings, clientIp = null, allowInternal = false, kind = null } = {}
) {
  const requireKey = settings ? !!settings.requireApiKey : true;
  // The address the security line stamps. Resolved once the key is known
  // (below); a denial before that point records with the caller's override.
  let resolvedIp = clientIp || null;
  // SECURITY LOG — every denial below returns through denied(), which appends
  // one fail-open line (no await: the 429/403 must never wait on the ledger).
  // QUOTA EVENT — one honest emission point for "the gate denied on a
  // CEILING" (rate / spend / budget), beside the security-log line and with
  // the same fail-open by construction. NOT every denial: an invalid or paused
  // key is an auth fault, not a quota, and must never ring the quota bell.
  // `kind` rides along so a provider-scope denial is honest. Fire-and-forget:
  // the 429 never waits on a webhook.
  const QUOTA_CODES = new Set([
    GATE_CODES.RATE_LIMITED,
    GATE_CODES.BUDGET_EXCEEDED,
    "provider_budget_exceeded",
    "model_budget_exceeded",
    "gateway_budget_exceeded",
  ]);
  const emitQuota = (verdict, key) => {
    try {
      if (!verdict || verdict.ok || !QUOTA_CODES.has(verdict.code)) return;
      void import("@/lib/webhooks.js")
        .then((m) => m.emitWebhook("quota", {
          code: verdict.code,
          status: verdict.status ?? null,
          message: verdict.message ?? null,
          keyId: key?.keyId ?? null,
          requestModel: requestModel ?? null,
          kind: kind ?? null,
        }))
        .catch(() => {});
    } catch { /* a notifier never fails a gate */ }
  };
  const denied = (verdict, key = null) => {
    recordDeniedVerdict(verdict, key, resolvedIp);
    emitQuota(verdict, key);
    return verdict;
  };
  if (!requireKey) {
    const budgetVerdict = await budgetStage(null, { requestModel });
    if (!budgetVerdict.ok) return denied(budgetVerdict, null);
    return { ok: true, key: null, skipped: true };
  }

  const token = extractKeyFromHeaders(request);
  // Not recorded: an absent key is anonymous traffic noise, not a key's act.
  if (!token) return deny(HTTP_STATUS.UNAUTHORIZED, GATE_CODES.INVALID_KEY, "Missing API key");

  const row = await resolveKey(token);
  // Not recorded: an unknown key has no row to attribute the act to (and the
  // presented string is never kept — it may be a near-miss of a real key).
  if (!row) return deny(HTTP_STATUS.UNAUTHORIZED, GATE_CODES.INVALID_KEY, "Invalid API key");
  if (!(row.isActive === 1 || row.isActive === true)) {
    return denied(deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.KEY_PAUSED, "API key is paused"), { keyId: row.id, keyPrefix: row.keyPrefix });
  }
  const key = await applyPlanDefaults(toResolvedKey(row));
  if (key.isInternal && !allowInternal) {
    return denied(deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.INVALID_KEY, "Invalid API key"), key);
  }

  // W3: resolve the client IP — explicit override → the socket-stamped
  // x-9r-real-ip header → (internal keys only, dev mode) the loopback Host
  // fallback. External keys still fail closed without a stamped IP.
  resolvedIp = resolveClientIp(request, { clientIp, isInternal: key.isInternal });

  for (const stage of STAGES) {
    // Stages may be async (spendStage reads the usage ledger) — await each verdict.
    // The ACL stages (kind/provider/combo) read their scope from the request;
    // comboModels tells providerStage/comboStage that a combo resolved (so
    // slash-bearing combo names never read as provider prefixes, v0.9.39).
    const verdict = await stage(key, { clientIp: resolvedIp, requestModel, kind, comboModels });
    if (!verdict.ok) return denied(verdict, key);
  }

  const scopeVerdict = modelScopeStage(key, { requestModel, comboModels });
  if (!scopeVerdict.ok) return denied(scopeVerdict, key);

  // Observatory budget hierarchy (W3-B) — last stage: it reads the ledger, and
  // its distinct *_budget_exceeded 429 codes sit on top of the legacy
  // budget_exceeded code (which fires earlier in STAGES if both are crossed).
  const budgetVerdict = await budgetStage(key, { requestModel });
  if (!budgetVerdict.ok) return denied(budgetVerdict, key);

  // Migration 025 — the async half of the rate pipeline: TPM (a ledger read)
  // and the in-flight slot counter. It runs LAST because its success path
  // RESERVES state (one in-flight slot) that must survive until the response
  // settles — a denial from any earlier stage must never leak a slot. The
  // verdict carries `release`; a key with no ceilings gets a no-op.
  const rateVerdict = await rateAsyncStage(key);
  if (!rateVerdict.ok) return denied(rateVerdict, key);

  touchLastUsed(key.keyId);
  return { ok: true, key, release: rateVerdict.release };
}

/**
 * Wrap a handler body so the in-flight slot reserved at gate pass is released
 * the moment the handler's response SETTLES — success, throw, or a rejected
 * promise. The gate is the authority on whether a slot was taken: this helper
 * reads the verdict, wraps the handler, and hands back the handler's result
 * untouched. A handler that forgets to wrap still cannot leak forever: the
 * slot TTL (15 min) reclaims it.
 *
 *   const gate = await authorizeApiRequest(request, {...});
 *   if (!gate.ok) return gate.response;
 *   return withKeySlot(gate, () => handleTheRequest(...));
 *
 * A non-Promise return (a plain Response, a thrown error) releases on the
 * spot; a Promise releases in BOTH settle arms.
 */
export function withKeySlot(gate, fn) {
  const release = typeof gate?.release === "function" ? gate.release : () => {};
  let result;
  try {
    result = fn();
  } catch (err) {
    release();
    throw err;
  }
  if (result && typeof result.then === "function") {
    return result.then(
      (value) => { release(); return value; },
      (err) => { release(); throw err; }
    );
  }
  release();
  return result;
}

/** Scope-filter a model list for /v1/models responses (no 403 — just less visible). */
export function filterModelsByScope(models, key) {
  if (!key) return models;

  // Full per-key ACL (v0.9.17): filter by kinds, providers, combos, then models.
  // A dimension that is null (unrestricted) does not filter. A dimension that
  // is [] (deny-all) yields zero models from that dimension.
  const kinds = key.allowedKinds;
  const providers = key.allowedProviders;
  const combos = key.allowedCombos;
  const scope = key.allowedModels ? new Set(key.allowedModels) : null;

  return models.filter((m) => {
    const candidates = [m.id, m.model, m.fullModel, m.routedModel, m.alias, typeof m === "string" ? m : null].filter(Boolean);
    // Gemini-native list shape: name = "models/{provider}/{id}" or "models/{id}"
    if (typeof m?.name === "string" && m.name.startsWith("models/")) candidates.push(m.name.slice(7));

    const modelStr = candidates[0] || "";
    const isCombo = modelStr.startsWith("combo/");
    const slash = modelStr.indexOf("/");
    const provider = slash > 0 && !isCombo ? modelStr.slice(0, slash) : "";

    // Kind filter — model entries carry a kind/capability tag; combos are "llm".
    if (kinds != null) {
      const kind = m.kind || m.serviceKind || (isCombo ? "llm" : "llm");
      if (!triStateAllowed(kinds, kind)) return false;
    }
    // Provider filter — combos are exempt (they belong to the combo dimension).
    if (providers != null && provider && !isCombo && !triStateAllowed(providers, provider)) return false;
    // Combo filter.
    if (combos != null && isCombo) {
      const comboName = modelStr.slice("combo/".length);
      if (!triStateAllowed(combos, comboName)) return false;
    }
    // Model-scope filter (legacy allowedModels).
    if (scope) {
      if (!candidates.some((c) => scope.has(c))) return false;
    }
    return true;
  });
}

/**
 * Display-side scope narrowing for model-list routes: resolve the request's key
 * and filter the catalog. Fail-open here is deliberate — this is visibility,
 * not authorization; dispatch-time gates remain the fail-closed authority.
 */
export async function scopeModelsForRequest(request, models) {
  try {
    const { getSettings } = await import("@/lib/db/repos/settingsRepo.js");
    const settings = await getSettings();
    if (!settings?.requireApiKey) return models;
    const token = extractKeyFromHeaders(request);
    if (!token) return models; // missing-key policy belongs to the guard
    const row = await resolveKey(token);
    if (!row || !(row.isActive === 1 || row.isActive === true)) return models;
    return filterModelsByScope(models, await applyPlanDefaults(toResolvedKey(row)));
  } catch {
    return models;
  }
}
