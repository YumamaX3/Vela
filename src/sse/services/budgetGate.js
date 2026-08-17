// Usage Observatory W3-B — the budget engine. Extends keyGate's spend
// governance with the Observatory budget hierarchy forged in W3-A (quotaRepo):
// scopes gateway|key|model, windows day|week|month, 50/80/100 soft thresholds
// + hard cap with DISTINCT 429 codes (gateway/key/model_budget_exceeded).
//
// This is a SEPARATE instrument from the legacy per-key caps
// (tokenBudgetDaily/spendCapDailyCents with budgetScope daily|weekly|
// monthly|yearly, code budget_exceeded): budgetDef.js legislated that the two
// vocabularies never collide. keyGate keeps spendStage as-is and wires this
// stage after modelScopeStage (cheapest denial first — model scope is
// in-memory; budget evaluation reads the ledger).
//
// Failure posture — honest and deliberate: FAIL-OPEN on infrastructure errors
// (budget config or ledger unreadable → budgets pass through, flagged
// degraded). The Observatory hierarchy is governance, not identity; a storage
// hiccup must not 500 every request. The legacy spend stage and the rest of
// the gate keep their own behavior untouched.
//
// Soft thresholds (50/80/100) never deny — they EMIT alert records for W3-C's
// channels (banner, Discord webhook, n8n webhook). Hard cap (usage >= cap)
// denies with the scope's distinct code. Like the legacy stage, the check is
// at admission time: the in-flight request is counted after it completes.
//
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W3 GOVERNANCE).

import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import { QUOTA_CODES } from "@/lib/budgetDef.js";
import { parseModel, getModelInfo } from "./model.js";

function deny(status, code, message) {
  return { ok: false, code, message, status, response: errorResponse(status, `${message} (${code})`) };
}

// ── Window math (local-date convention) ───────────────────────────────────
// usageDaily stores LOCAL dateKeys, so budget windows reset on local
// boundaries — same convention as keyGate's windowStartDateKey, with the
// Observatory's own day|week|month vocabulary (weeks start Monday, ISO).

function obsDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Start dateKey of the window containing `now` (local-time boundaries). */
export function quotaWindowStart(window, now = new Date()) {
  switch (window) {
    case "week": {
      const dow = now.getDay() || 7; // Sunday → 7
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dow - 1));
      return obsDateKey(monday);
    }
    case "month":
      return obsDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    case "day":
    default:
      return obsDateKey(now);
  }
}

// ── Alert plumbing — W3-C's hook point ─────────────────────────────────────
// Soft-threshold crossings are emitted as alert records. The ring keeps recent
// breaches readable for the dashboard banner; listeners carry webhooks.
// Listeners are fail-open — a broken channel must never block the gate.

const ALERT_RING_MAX = 100;

function alertRing() {
  if (!global._velaBudgetAlertRing) global._velaBudgetAlertRing = [];
  return global._velaBudgetAlertRing;
}

const alertListeners = new Set();

/** Register a soft-threshold listener. Returns an unregister function. */
export function onBudgetAlert(fn) {
  alertListeners.add(fn);
  return () => alertListeners.delete(fn);
}

/** Recent alert records, oldest first (bounded ring). */
export function getRecentBudgetAlerts(limit = 20) {
  return alertRing().slice(-limit);
}

function emitBudgetAlert(alert) {
  const ring = alertRing();
  ring.push(alert);
  if (ring.length > ALERT_RING_MAX) ring.splice(0, ring.length - ALERT_RING_MAX);
  for (const fn of alertListeners) {
    try { fn(alert); } catch { /* a broken channel never blocks the gate */ }
  }
}

// ── Caches — the gate reads the ledger on every authorization ─────────────
// Two layers, both on the 5s TTL the legacy spend stage established:
//   days cache  — one getUsageDailySince per window start per TTL
//   sums cache  — per budget, recomputed only when its days cache refreshed

const QUOTA_TTL_MS = 5_000;
const QUOTA_CACHE_MAX = 2_000;

function quotaDaysCache() {
  if (!global._velaQuotaDaysCache) global._velaQuotaDaysCache = new Map();
  return global._velaQuotaDaysCache;
}
function quotaSumsCache() {
  if (!global._velaQuotaSumsCache) global._velaQuotaSumsCache = new Map();
  return global._velaQuotaSumsCache;
}

function cachePrune(map, nowMs) {
  if (map.size < QUOTA_CACHE_MAX) return;
  for (const [k, v] of map) {
    if (nowMs - v.ts > QUOTA_TTL_MS) map.delete(k);
    if (map.size < QUOTA_CACHE_MAX) break;
  }
  if (map.size >= QUOTA_CACHE_MAX) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
}

/** Days >= startDateKey, cached. Throws only when the ledger itself throws.
 *  NOTE: the day blobs carry NO dateKey field (it is a ledger column, not
 *  part of the JSON) — the window filter is the SQL inside getUsageDailySince
 *  itself, so the cached array is used as-is. */
async function getDaysCached(startDateKey) {
  const cache = quotaDaysCache();
  const nowMs = Date.now();
  const hit = cache.get(startDateKey);
  if (hit && nowMs - hit.ts <= QUOTA_TTL_MS) return hit;
  const { getUsageDailySince } = await import("@/lib/db/repos/usageRepo.js");
  const days = await getUsageDailySince(startDateKey);
  const entry = { days, ts: nowMs };
  cachePrune(cache, nowMs);
  cache.set(startDateKey, entry);
  return entry;
}

function entryTokens(entry) {
  return (entry.promptTokens || 0) + (entry.completionTokens || 0);
}
function entryCents(entry) {
  return Math.round((entry.cost || 0) * 100);
}

/** Sum one budget's usage over the days (already window-filtered). */
function sumBudgetOverDays(def, days, modelForms) {
  let tokens = 0, costCents = 0;
  if (def.scope === "gateway") {
    for (const day of days) {
      tokens += (day.promptTokens || 0) + (day.completionTokens || 0);
      costCents += Math.round((day.cost || 0) * 100);
    }
    return { tokens, costCents };
  }
  if (def.scope === "key") {
    for (const day of days) {
      if (!day?.byApiKey) continue;
      for (const entry of Object.values(day.byApiKey)) {
        if (entry?.meta?.keyId !== def.subject) continue;
        tokens += entryTokens(entry);
        costCents += entryCents(entry);
      }
    }
    return { tokens, costCents };
  }
  // model — match the alias-resolved provider/model form AND the bare model
  // name (mirrors modelScopeStage's matching semantics); ledger entries carry
  // meta.rawModel + meta.provider as recorded at completion.
  for (const day of days) {
    if (!day?.byModel) continue;
    for (const entry of Object.values(day.byModel)) {
      const raw = entry?.meta?.rawModel;
      if (!raw) continue;
      const full = entry.meta.provider ? `${entry.meta.provider}/${raw}` : raw;
      if (!modelForms.has(full) && !modelForms.has(raw)) continue;
      tokens += entryTokens(entry);
      costCents += entryCents(entry);
    }
  }
  return { tokens, costCents };
}

/** Resolve the request model into the set of strings a model budget may name. */
async function resolveModelForms(requestModel) {
  const forms = new Set();
  if (!requestModel || typeof requestModel !== "string") return forms;
  forms.add(requestModel);
  const parsed = parseModel(requestModel);
  const parsedForm = parsed?.provider && parsed?.model ? `${parsed.provider}/${parsed.model}` : null;
  if (parsedForm) forms.add(parsedForm);
  // Alias / provider-node resolution only when the cheap parse found no
  // provider — keeps the common provider/model path DB-free.
  if (!parsedForm) {
    try {
      const info = await getModelInfo(requestModel);
      if (info?.provider && info?.model) forms.add(`${info.provider}/${info.model}`);
    } catch { /* unresolved alias → match only the literal string */ }
  }
  return forms;
}

async function loadActiveBudgets() {
  const { listBudgets } = await import("@/lib/db/repos/budgetRepo.js");
  const all = await listBudgets();
  return (all || []).filter((b) => b && b.isActive !== false);
}

/**
 * The budget stage. Evaluates every ACTIVE Observatory budget applicable to
 * this request:
 *   gateway → always; key → when the subject is this keyId; model → when the
 *   resolved request model matches the subject.
 * Hard-cap breach → deny 429 with the scope's distinct code (first breach in
 * list order wins — the repo lists gateway, key, model). Soft-threshold
 * crossings are emitted as alert records for W3-C and never deny.
 *
 * key === null is the keyless passthrough (requireApiKey=false): gateway and
 * model budgets still govern — a cap that cannot bind keyless traffic is a
 * cap anyone can walk around by omitting the key.
 */
export async function budgetStage(key, { requestModel = null } = {}) {
  let budgets;
  try {
    budgets = await loadActiveBudgets();
  } catch {
    // Config unreachable — governance degrades, the gate does not crash.
    return { ok: true, degraded: "budget-config-unavailable" };
  }
  if (!budgets.length) return { ok: true };

  const keyId = key?.keyId || null;
  const applicable = budgets.filter(
    (b) => b.scope === "gateway" || (b.scope === "key" && keyId && b.subject === keyId)
  );
  const modelBudgets = budgets.filter((b) => b.scope === "model");

  let modelForms = null;
  if (modelBudgets.length) {
    modelForms = await resolveModelForms(requestModel);
    if (!modelForms.size) modelForms = null; // no model on the request → nothing can match
  }

  const nowMs = Date.now();
  const sumsCache = quotaSumsCache();
  const alerts = [];

  for (const def of [...applicable, ...(modelForms ? modelBudgets : [])]) {
    const start = quotaWindowStart(def.window);
    const sumKey = `${def.id}|${def.window}|${start}`;
    let sum = sumsCache.get(sumKey);
    if (!sum || nowMs - sum.ts > QUOTA_TTL_MS) {
      let dayEntry;
      try {
        dayEntry = await getDaysCached(start);
      } catch {
        continue; // ledger unreachable for this window — this budget degrades open
      }
      // getUsageDailySince(start) already returns only days >= start (SQL-level),
      // and day blobs carry no dateKey of their own — use the array as-is.
      sum = { ...sumBudgetOverDays(def, dayEntry.days, modelForms), ts: nowMs };
      cachePrune(sumsCache, nowMs);
      sumsCache.set(sumKey, sum);
    }

    // Breach evaluation — one record per crossed cap-type.
    for (const [capType, cap, used] of [
      ["token", def.tokenCap, sum.tokens],
      ["spend", def.spendCapCents, sum.costCents],
    ]) {
      if (!cap) continue;
      const pct = (used / cap) * 100;
      const crossed = (def.thresholds || []).filter((t) => pct >= t);
      if (!crossed.length) continue;
      const threshold = Math.max(...crossed);
      const alert = {
        budgetId: def.id, scope: def.scope, subject: def.subject, window: def.window,
        capType, cap, used, pct: Math.round(pct * 10) / 10, threshold, ts: nowMs,
      };
      alerts.push(alert);
      emitBudgetAlert(alert);
      if (used >= cap) {
        const winLabel = def.window;
        if (capType === "token") {
          return deny(
            HTTP_STATUS.RATE_LIMITED,
            QUOTA_CODES[def.scope],
            `${scopeLabel(def.scope)} ${winLabel} token budget exceeded: ${used} of ${cap} tokens used`
          );
        }
        return deny(
          HTTP_STATUS.RATE_LIMITED,
          QUOTA_CODES[def.scope],
          `${scopeLabel(def.scope)} ${winLabel} spend cap exceeded: $${(used / 100).toFixed(2)} of $${(cap / 100).toFixed(2)} used`
        );
      }
    }
  }

  return { ok: true, alerts };
}

function scopeLabel(scope) {
  return { gateway: "Gateway", key: "Key", model: "Model" }[scope] || scope;
}
