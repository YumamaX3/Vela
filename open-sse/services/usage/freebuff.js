/**
 * Freebuff usage handler — GET-only session quota.
 *
 * HARD INVARIANT: this handler only ever GETs /api/v1/freebuff/session. A POST
 * to that path CLAIMS a session and burns one of ~6 daily quota units, so a
 * quota tracker must never POST. Enforced by a unit test that spies fetch
 * method.
 *
 * Upstream shape (from prior-art captures):
 *   { rateLimitsByModel: { "<model>": { limit, recentCount, resetAt,
 *     period: 'pacific_day'|'pacific_week', entitlementBreakdown? } }, ... }
 * recentCount is fractional (a long agent run can consume 1.3 units).
 *
 * When a connection proxy is configured the GET must ride it with strictProxy
 * (quota is keyed to the session's egress IP — a direct fallback would read
 * the wrong IP's quota). This deliberately does NOT inherit the standard
 * usage route's hard-forced strictProxy:false.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";
import { FREEBUFF_USER_AGENT, FREEBUFF_SESSION_FETCH_TIMEOUT_MS } from "../../config/freebuff.js";

const USAGE = U("freebuff");
const SESSION_URL = USAGE.url || "https://www.codebuff.com/api/v1/freebuff/session";

function buildHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": FREEBUFF_USER_AGENT,
  };
}

function buildQuota({ used, total, resetAt }) {
  const safeTotal = Math.max(0, toFiniteNumber(total, 0));
  const safeUsed = Math.max(0, toFiniteNumber(used, 0));
  if (safeTotal === 0) {
    return { used: safeUsed, total: 0, remainingPercentage: 0, resetAt: resetAt || null, unlimited: false };
  }
  const remaining = Math.max(0, safeTotal - safeUsed);
  return {
    used: safeUsed,
    total: safeTotal,
    remainingPercentage: (remaining / safeTotal) * 100,
    resetAt: resetAt || null,
    unlimited: false,
  };
}

function shortModelLabel(modelId) {
  const tail = String(modelId || "").split("/").pop() || modelId;
  return tail;
}

/**
 * Parse rateLimitsByModel into a quotas map (label -> quota row).
 * Exported for unit testing.
 */
export function parseFreebuffQuotas(payload) {
  const quotas = {};
  const rateLimits = payload?.rateLimitsByModel;
  if (!rateLimits || typeof rateLimits !== "object") return quotas;
  for (const [model, entry] of Object.entries(rateLimits)) {
    if (!entry || typeof entry !== "object") continue;
    quotas[shortModelLabel(model)] = buildQuota({
      used: entry.recentCount ?? entry.used ?? entry.recent_count,
      total: entry.limit ?? entry.total,
      resetAt: parseResetTime(entry.resetAt ?? entry.reset_at ?? entry.resets_at),
    });
  }
  return quotas;
}

export async function getFreebuffUsage(accessToken, providerSpecificData = null, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Freebuff access token not available." };
  }

  const psd = providerSpecificData || {};
  // Quota is keyed to the session's egress IP — ride the connection proxy
  // with strictProxy when present (never fall back to direct).
  const effectiveProxy = psd.connectionProxyUrl ? { ...psd, strictProxy: true } : (proxyOptions || psd);

  try {
    const response = await proxyAwareFetch(
      SESSION_URL,
      {
        method: "GET", // NEVER POST — a POST burns a session unit (tested)
        headers: buildHeaders(accessToken),
        signal: AbortSignal.timeout(FREEBUFF_SESSION_FETCH_TIMEOUT_MS),
      },
      effectiveProxy,
    );

    if (response.status === 401) {
      return { message: "Freebuff auth token expired — re-login required in the dashboard." };
    }
    if (response.status === 403) {
      const text = await response.text().catch(() => "");
      const hint = /country_blocked|banned/i.test(text) ? " (account country-blocked or banned)" : "";
      return { message: `Freebuff quota access refused (403)${hint}.` };
    }
    if (response.status === 404) {
      return { message: "No Freebuff session found for this account — start a chat to claim one." };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const trimmed = text ? `: ${text.slice(0, 200)}` : "";
      return { message: `Freebuff quota API error (${response.status})${trimmed}` };
    }

    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== "object") {
      return { message: "Freebuff quota response was not JSON." };
    }

    const quotas = parseFreebuffQuotas(payload);
    const accessTier = typeof payload.accessTier === "string" ? payload.accessTier : null;
    const plan = accessTier === "limited" ? "Freebuff (Limited)" : "Freebuff (Free)";

    if (Object.keys(quotas).length === 0) {
      return { plan, message: "Freebuff connected, but no session quota was returned.", quotas: {} };
    }

    return { plan, quotas };
  } catch (err) {
    return { message: `Freebuff quota fetch failed: ${err?.message || err}` };
  }
}
