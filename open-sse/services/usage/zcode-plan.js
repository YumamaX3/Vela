/**
 * ZCode Start Plan usage — the billing balance read reframed as quota rows.
 */

import { fetchZcodeQuota } from "../zcodePlanQuota.js";

/**
 * Each entitlement's remaining/limit fraction becomes a 0–100 row; period_end
 * (unix seconds) is the reset. A zero limit is an unbounded row, not a spent one.
 */
export async function getZcodePlanUsage(accessToken, providerSpecificData, proxyOptions = null) {
  if (!accessToken) {
    return { message: "ZCode plan token not available." };
  }
  try {
    const quota = await fetchZcodeQuota(
      { accessToken, providerSpecificData: providerSpecificData || {} },
      proxyOptions,
    );
    const quotas = {};
    for (const ent of quota.entitlements || []) {
      const name = ent?.name || "unknown";
      const limit = Number(ent?.limit) || 0;
      const remaining = Number(ent?.remaining) || 0;
      const usedPercent = limit > 0 ? Math.max(0, Math.min(100, ((limit - remaining) / limit) * 100)) : 0;
      const periodEnd = Number(ent?.period_end) || 0;
      quotas[name] = {
        used: Math.round(usedPercent * 100) / 100,
        total: 100,
        remaining: Math.round((100 - usedPercent) * 100) / 100,
        remainingPercentage: Math.round((100 - usedPercent) * 100) / 100,
        resetAt: periodEnd > 0 ? new Date(periodEnd * 1000).toISOString() : null,
        unlimited: limit <= 0,
      };
    }
    return { plan: quota.planName || "ZCode Plan", quotas };
  } catch (error) {
    return { message: `ZCode plan quota error: ${error?.message ?? String(error)}` };
  }
}
