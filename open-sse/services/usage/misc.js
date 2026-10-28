/**
 * Misc usage handlers (iFlow, Ollama, GLM, Vercel AI Gateway, Qoder)
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

export { getGlmUsage } from "./glm.js";


// Vercel AI Gateway credits endpoint
// Returns { balance: "95.50", total_used: "4.50" } (USD as decimal strings).
const VERCEL_AI_GATEWAY_CREDITS_URL = U("vercel-ai-gateway").url;

/**
 * iFlow Usage
 */
export async function getIflowUsage(accessToken) {
  try {
    // iFlow may have usage endpoint
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}

/**
 * Ollama Cloud Usage
 * GET https://ollama.com/api/usage — session (5h) + weekly (7d) `usage` is a 0..1
 *   ratio (1.0 = limit reached, e.g. weekly 100% used). No reset timestamp exposed.
 * POST https://ollama.com/api/me — plan label (fail-open).
 * Auth: Authorization: Bearer <apiKey>
 */
// The free plan's monthly window rolls on the account's signup day. Ollama reports no
// reset instant, so derive it: the next occurrence of that day-of-month at the signup
// time-of-day, clamped to the last valid day when the month is shorter. Non-free plans
// get null — their window is not anchored to a signup date.
function freeMonthlyResetAt(me) {
  const plan = typeof me?.Plan === "string" ? me.Plan.toLowerCase() : "";
  if (plan !== "free") return null;
  const createdRaw = me?.CreatedAt;
  if (typeof createdRaw !== "string" || !createdRaw) return null;
  const created = new Date(createdRaw);
  if (Number.isNaN(created.getTime())) return null;
  const now = new Date();
  const day = created.getUTCDate();
  const at = (y, m) => {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const d = Math.min(day, lastDay);
    return new Date(Date.UTC(y, m, d, created.getUTCHours(), created.getUTCMinutes(), created.getUTCSeconds()));
  };
  // This month's occurrence; if it has already passed, roll to next month.
  const thisMonth = at(now.getUTCFullYear(), now.getUTCMonth());
  // Strictly-greater-or-equal: the signup instant itself belongs to the current window,
  // not the next one. Date.UTC(...) with no ms argument already yields .000Z.
  const next = thisMonth.getTime() >= now.getTime()
    ? thisMonth
    : at(now.getUTCFullYear(), now.getUTCMonth() + 1);
  return next.toISOString();
}

export async function getOllamaUsage(apiKey, providerSpecificData, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Ollama Cloud API key not available." };
  }

  try {
    const response = await proxyAwareFetch("https://ollama.com/api/usage", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Ollama Cloud API key invalid or expired." };
    }

    if (!response.ok) {
      return { message: `Ollama Cloud usage API error (${response.status}).` };
    }

    let data;
    try {
      data = await response.json();
    } catch {
      return { message: "Ollama Cloud usage response was not JSON." };
    }

    // Best-effort plan label from /api/me
    const me = await proxyAwareFetch("https://ollama.com/api/me", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Length": "0",
      },
    }, proxyOptions).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    const planRaw = typeof me?.Plan === "string" ? me.Plan : "";
    const plan = planRaw
      ? planRaw.charAt(0).toUpperCase() + planRaw.slice(1).toLowerCase()
      : "Ollama Cloud";

    const limits = data?.limits && typeof data.limits === "object" ? data.limits : {};

    // Ollama `usage` is a 0..1 ratio (1.0 = limit reached). Convert to a 0..100
    // bar. Do NOT set absolute `remaining` — QuotaTable reads remainingPercentage.
    function ratioQuota(usageRatio, resetAt = null) {
      const ratio = Math.max(0, Math.min(1, Number(usageRatio) || 0));
      const usedPct = Math.round(ratio * 100);
      return { used: usedPct, total: 100, remainingPercentage: 100 - usedPct, resetAt, unlimited: false };
    }

    // The free plan reports a monthly window, not the session/weekly pair. Ollama
    // exposes no reset timestamp for it, so the signup day from /api/me is the only
    // anchor available: the window rolls on that day each month, clamped to the
    // last valid day of a shorter month.
    const monthlyRaw = limits.monthly?.usage;
    const monthlyNum = Number(monthlyRaw);
    const hasMonthly = monthlyRaw !== undefined && monthlyRaw !== null && !Number.isNaN(monthlyNum);
    const sessionRaw = limits.session?.usage;
    const weeklyRaw = limits.weekly?.usage;
    const sessionNum = Number(sessionRaw);
    const weeklyNum = Number(weeklyRaw);
    const hasSession = sessionRaw !== undefined && sessionRaw !== null && !Number.isNaN(sessionNum);
    const hasWeekly = weeklyRaw !== undefined && weeklyRaw !== null && !Number.isNaN(weeklyNum);

    const quotas = {};
    if (hasMonthly) quotas["Monthly"] = { ...ratioQuota(monthlyNum), resetAt: freeMonthlyResetAt(me) };
    if (hasSession) quotas["Session (5h)"] = ratioQuota(sessionNum);
    if (hasWeekly) quotas["Weekly (7d)"] = ratioQuota(weeklyNum);

    // Ollama Cloud migrated its live limits from /api/usage to /api/balance: the usage
    // endpoint now reports only activity history, so a key with no limits block there
    // still has a quota — read it from the balance door instead.
    if (Object.keys(quotas).length === 0) {
      let balanceResponse = null;
      try {
        balanceResponse = await proxyAwareFetch("https://ollama.com/api/balance", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
        }, proxyOptions);
      } catch {
        balanceResponse = null;
      }

      if (balanceResponse && balanceResponse.ok) {
        let balanceData = null;
        try {
          balanceData = await balanceResponse.json();
        } catch {
          balanceData = null;
        }
        const inc = balanceData?.included;

        if (inc?.session) {
          const rem = Number(inc.session.remaining_percent);
          const remPct = Number.isFinite(rem) ? Math.max(0, Math.min(100, rem)) : 100;
          quotas["Session (5h)"] = {
            used: Math.round((100 - remPct) * 100) / 100,
            total: 100,
            remainingPercentage: remPct,
            resetAt: inc.session.resets_at || null,
            unlimited: false,
          };
        }
        if (inc?.weekly) {
          const rem = Number(inc.weekly.remaining_percent);
          const remPct = Number.isFinite(rem) ? Math.max(0, Math.min(100, rem)) : 100;
          quotas["Weekly (7d)"] = {
            used: Math.round((100 - remPct) * 100) / 100,
            total: 100,
            remainingPercentage: remPct,
            resetAt: inc.weekly.resets_at || null,
            unlimited: false,
          };
        }
        if (inc?.allowance_usd !== undefined && inc?.balance_usd !== undefined) {
          const allowance = Number(inc.allowance_usd) || 0;
          const balance = Number(inc.balance_usd) || 0;
          const used = Math.max(0, Math.round((allowance - balance) * 100) / 100);
          const remPct = allowance > 0 ? Math.round((balance / allowance) * 10000) / 100 : 0;
          quotas["Allowance ($)"] = {
            used,
            total: allowance,
            remainingPercentage: remPct,
            resetAt: inc.period?.until || null,
            unlimited: false,
            unit: "USD",
          };
        }
        if (Number(balanceData?.purchased?.balance_usd) > 0) {
          quotas["Purchased Credits"] = {
            used: 0,
            total: Number(balanceData.purchased.balance_usd),
            remainingPercentage: 100,
            isCreditBalance: true,
            currency: "$",
          };
        }
      }
    }

    if (Object.keys(quotas).length === 0) {
      return {
        plan,
        message: "Ollama Cloud connected. No usage limits reported.",
        quotas: {},
      };
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Ollama Cloud error: ${error.message}` };
  }
}



/**
 * Vercel AI Gateway usage — credit balance for the API key
 *
 * Calls GET /v1/credits which returns:
 *   { "balance": "95.50", "total_used": "4.50" }   (USD as decimal strings)
 *
 * We surface this as a single "Balance ($)" quota row so the existing
 * QuotaTable / progress-bar UI can render it. used = total_used,
 * total = balance + total_used (the original credit allotment), so the
 * remaining percentage equals balance / total.
 *
 * Docs: https://vercel.com/docs/ai-gateway/usage
 */
export async function getVercelAiGatewayUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Vercel AI Gateway API key not available." };
  }

  try {
    const response = await proxyAwareFetch(VERCEL_AI_GATEWAY_CREDITS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Vercel AI Gateway API key invalid or expired." };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const trimmed = errorText ? `: ${errorText.slice(0, 200)}` : "";
      return { message: `Vercel AI Gateway credits API error (${response.status})${trimmed}` };
    }

    const data = await response.json();

    // Vercel returns numeric strings; coerce safely.
    const balance = Number(data?.balance) || 0;
    const totalUsed = Number(data?.total_used) || 0;

    // Vercel gives $5/month free credit. The API doesn't return the
    // monthly allocation so we use the known constant as the denominator.
    const MONTHLY_CREDIT = 5;
    const remainingPercentage = (balance / MONTHLY_CREDIT) * 100;

    if (balance <= 0 && totalUsed <= 0) {
      return {
        plan: "Pay-as-you-go",
        message: "Vercel AI Gateway connected. No credit allocation found (BYOK or unfunded account).",
        quotas: {},
      };
    }

    // "Used (USD)": how much has been spent this month (no fixed cap → unlimited).
    // "Remaining (USD)": balance remaining out of the $5 monthly allocation.
    return {
      plan: "Pay-as-you-go",
      quotas: {
        "Used (USD)": {
          used: totalUsed,
          total: 0,
          remaining: 0,
          remainingPercentage: 100,
          unlimited: true,
        },
        "Remaining (USD)": {
          used: balance,
          total: MONTHLY_CREDIT,
          remaining: balance,
          remainingPercentage,
          unlimited: false,
        },
      },
    };
  } catch (error) {
    return { message: `Vercel AI Gateway error: ${error.message}` };
  }
}

export async function getQoderUsage(accessToken, proxyOptions = null) {
  if (!accessToken) {
    return { message: "Qoder usage unavailable: no access token" };
  }
  try {
    const response = await proxyAwareFetch(
      U("qoder").url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );
    if (!response.ok) {
      return { message: `Qoder connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "Qoder connected. Usage response was not JSON." };
    }
    // Quota records live under `quotas`; scalar metadata
    // (totalUsagePercentage, isQuotaExceeded, expiresAt) are surfaced as
    // siblings so the dashboard parser doesn't try to render them as rows.
    const userQuota = body.userQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    // Qoder publishes a single absolute reset timestamp (`expiresAt` in ms);
    // surface it on every quota record as ISO so the table can render
    // "resets at" alongside used/total.
    const expiresAtMs = Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0
      ? Number(body.expiresAt)
      : null;
    const resetAt = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
    const quotas = {
      user: {
        total: Number(userQuota.total) || 0,
        used: Number(userQuota.used) || 0,
        remaining: Number(userQuota.remaining) || 0,
        unit: userQuota.unit || "credits",
        resetAt,
      },
      organization: {
        total: Number(orgQuota.total) || 0,
        used: Number(orgQuota.used) || 0,
        remaining: Number(orgQuota.remaining) || 0,
        unit: orgQuota.unit || "credits",
        resetAt,
      },
    };
    return {
      quotas,
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs,
    };
  } catch (error) {
    return { message: `Qoder connected. Unable to fetch usage: ${error.message}` };
  }
}
