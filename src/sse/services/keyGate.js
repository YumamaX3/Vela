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

export function ipStage(key, { clientIp } = {}) {
  // W3: CIDR allowlist. Null/empty = unrestricted.
  if (!key.ipAllowlist?.length || !clientIp) return { ok: true };
  // Implementation lands with W3 (CIDR match against socket-derived IP).
  return { ok: true };
}

export function rateStage(key) {
  // W3: sliding window per keyId (global._* singleton, bounded eviction).
  return { ok: true };
}

export function spendStage(key) {
  // W3: budgetTracker against usageDaily aggregate.
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

  for (const stage of STAGES) {
    const verdict = stage(key, { clientIp });
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
