// The key gate — stage pipeline for every /v1 authorization decision.
// Plan: plans/vela-key-governance.md §3.4. Invoked post-body-parse at the
// 11 enforcement sites. Fail-closed, distinct honest codes, ordered stages.
//
// Stage order (cheapest denial first):
//   extract → identity → [lifetime W2] → [ipGate W3] → [rateGate W3] →
//   [spendGate W3] → modelScope
//
// W2/W3 stages register into STAGES as their waves land — call sites never change.
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { resolveKey, getApiKeyById } from "@/lib/db/repos/apiKeysRepo.js";
import { getAdapter } from "@/lib/db/driver.js";
import { parseModel } from "./model.js";

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

function deny(status, code, message) {
  return { ok: false, code, message, status, response: errorResponse(status, `${message} (${code})`) };
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
    isInternal: row.isInternal === 1 || row.isInternal === true,
    expiresAt: row.expiresAt || null,
    rateLimitRpm: row.rateLimitRpm ?? null,
    tokenBudgetDaily: row.tokenBudgetDaily ?? null,
    spendCapDailyCents: row.spendCapDailyCents ?? null,
    budgetScope: row.budgetScope || null,
    ipAllowlist: safeParse(row.ipAllowlist),
  };
}

function safeParse(v) {
  if (v == null) return null;
  try { return JSON.parse(v); } catch { return null; }
}

// ── lastUsedAt: fire-and-forget, throttled ~60s per keyId ────────────────
const _lastUsedWrites = new Map();
function touchLastUsed(keyId) {
  const now = Date.now();
  const prev = _lastUsedWrites.get(keyId) || 0;
  if (now - prev < 60_000) return;
  _lastUsedWrites.set(keyId, now);
  getAdapter()
    .then((db) => db.run(`UPDATE apiKeys SET lastUsedAt = ? WHERE id = ?`, [new Date().toISOString(), keyId]))
    .catch(() => {});
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

// ── Rate limiting (W3 rate stage) ────────────────────────────────────────
// Sliding 60s window per keyId, in-memory (process-local). Survives module
// reloads via a global singleton; eviction keeps the map bounded.

const RATE_WINDOW_MS = 60_000;
const RATE_MAP_MAX_KEYS = 10_000;

function rateWindowMap() {
  if (!global._velaRateWindows) global._velaRateWindows = new Map();
  return global._velaRateWindows;
}

export function rateStage(key) {
  if (!key.rateLimitRpm || key.rateLimitRpm <= 0) return { ok: true };
  const windows = rateWindowMap();
  const now = Date.now();
  let stamps = windows.get(key.keyId);
  if (!stamps) {
    stamps = [];
    windows.set(key.keyId, stamps);
  }
  // Prune outside the window, then bound the map.
  while (stamps.length && stamps[0] <= now - RATE_WINDOW_MS) stamps.shift();
  if (windows.size > RATE_MAP_MAX_KEYS) {
    for (const [k, s] of windows) {
      while (s.length && s[0] <= now - RATE_WINDOW_MS) s.shift();
      if (!s.length && k !== key.keyId) windows.delete(k);
      if (windows.size <= RATE_MAP_MAX_KEYS) break;
    }
  }
  if (stamps.length >= key.rateLimitRpm) {
    return deny(
      HTTP_STATUS.RATE_LIMITED,
      GATE_CODES.RATE_LIMITED,
      `Rate limit exceeded: ${key.rateLimitRpm} requests per minute`
    );
  }
  stamps.push(now);
  return { ok: true };
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

/** Sum tokens + cost for one keyId across usageDaily rows ≥ startDateKey. */
export async function sumKeyUsage(keyId, startDateKey) {
  const db = await getAdapter();
  const rows = db.all(`SELECT data FROM usageDaily WHERE dateKey >= ? ORDER BY dateKey ASC`, [startDateKey]);
  let tokens = 0, costCents = 0;
  for (const row of rows) {
    let day = null;
    try { day = JSON.parse(row.data); } catch { continue; }
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

const STAGES = [lifetimeStage, ipStage, rateStage, spendStage];

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
 * The gate. Returns { ok: true, key: ResolvedKey } or { ok: false, response }.
 * - settings.requireApiKey === false → passes through (key: null) — behavior frozen
 * - allowInternal: only MITM-facing paths pass true
 */
export async function authorizeApiRequest(
  request,
  { requestModel = null, comboModels = null, settings, clientIp = null, allowInternal = false } = {}
) {
  const requireKey = settings ? !!settings.requireApiKey : true;
  if (!requireKey) return { ok: true, key: null, skipped: true };

  const token = extractKeyFromHeaders(request);
  if (!token) return deny(HTTP_STATUS.UNAUTHORIZED, GATE_CODES.INVALID_KEY, "Missing API key");

  const row = await resolveKey(token);
  if (!row) return deny(HTTP_STATUS.UNAUTHORIZED, GATE_CODES.INVALID_KEY, "Invalid API key");
  if (!(row.isActive === 1 || row.isActive === true)) {
    return deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.KEY_PAUSED, "API key is paused");
  }
  const key = toResolvedKey(row);
  if (key.isInternal && !allowInternal) {
    return deny(HTTP_STATUS.FORBIDDEN, GATE_CODES.INVALID_KEY, "Invalid API key");
  }

  // W3: resolve the client IP — explicit override → the socket-stamped
  // x-9r-real-ip header → (internal keys only, dev mode) the loopback Host
  // fallback. External keys still fail closed without a stamped IP.
  const resolvedIp = resolveClientIp(request, { clientIp, isInternal: key.isInternal });

  for (const stage of STAGES) {
    // Stages may be async (spendStage reads the usage ledger) — await each verdict.
    const verdict = await stage(key, { clientIp: resolvedIp });
    if (!verdict.ok) return verdict;
  }

  const scopeVerdict = modelScopeStage(key, { requestModel, comboModels });
  if (!scopeVerdict.ok) return scopeVerdict;

  touchLastUsed(key.keyId);
  return { ok: true, key };
}

/** Scope-filter a model list for /v1/models responses (no 403 — just less visible). */
export function filterModelsByScope(models, key) {
  if (!key || !key.allowedModels) return models;
  const scope = new Set(key.allowedModels);
  return models.filter((m) => {
    const candidates = [m.id, m.model, m.fullModel, m.routedModel, m.alias, typeof m === "string" ? m : null].filter(Boolean);
    // Gemini-native list shape: name = "models/{provider}/{id}" or "models/{id}"
    if (typeof m?.name === "string" && m.name.startsWith("models/")) candidates.push(m.name.slice(7));
    return candidates.some((c) => scope.has(c));
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
    return filterModelsByScope(models, toResolvedKey(row));
  } catch {
    return models;
  }
}
