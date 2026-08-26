import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";
import { getKeyUsageStats } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/keys/health — per-key health snapshot for the Observatory.
 *
 * For every active key: usage in the 24h window vs its budgets, plus a
 * stale flag (no traffic in 30d for a key that has existed 7d+, or an
 * expired key). The dashboard renders the usage-vs-budget bar and the
 * healthy / low-use / stale labels from this. Fail-open: any read error
 * yields a healthy-shaped empty snapshot, never an exception.
 */
export async function GET() {
  try {
    const [keys, usage24h] = await Promise.all([
      getApiKeys(),
      getKeyUsageStats("24h"),
    ]);

    const now = Date.now();
    const HOUR = 3600_000;
    const DAY = 24 * HOUR;

    const healthByKey = {};
    const sweep = [];

    for (const k of keys) {
      const u = usage24h[k.id] || {
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
        lastUsed: null,
      };

      const hasBudget = k.tokenBudgetDaily != null || k.spendCapDailyCents != null;
      let budgetRatio = null;
      if (k.tokenBudgetDaily != null && k.tokenBudgetDaily > 0) {
        budgetRatio = Math.min(1, (u.totalTokens || 0) / k.tokenBudgetDaily);
      } else if (k.spendCapDailyCents != null && k.spendCapDailyCents > 0) {
        budgetRatio = Math.min(1, (u.cost || 0) / (k.spendCapDailyCents / 100));
      }

      const createdAt = k.createdAt ? new Date(k.createdAt).getTime() : now;
      const lastUsed = k.lastUsedAt ? new Date(k.lastUsedAt).getTime() : null;
      const expired = k.expiresAt ? new Date(k.expiresAt).getTime() < now : false;

      // Stale: expired, or no traffic in 30 days for a key that has had 7
      // days to be used. Fresh keys never sweep — auto-provision would flag
      // its own default key.
      let stale = false;
      let staleReason = null;
      if (expired) {
        stale = true;
        staleReason = "expired";
      } else if (k.isActive !== false && now - createdAt >= 7 * DAY) {
        const lastSeen = lastUsed || createdAt;
        if (now - lastSeen >= 30 * DAY) {
          stale = true;
          staleReason = "no_traffic";
        }
      }

      healthByKey[k.id] = {
        id: k.id,
        hasBudget,
        budgetRatio,
        expired,
        stale,
        staleReason,
        lastUsedAt: k.lastUsedAt || null,
      };

      if (stale) {
        sweep.push({
          id: k.id,
          name: k.name || k.keyPrefix,
          reason: staleReason,
          expired,
          lastUsedAt: k.lastUsedAt || null,
        });
      }
    }

    return NextResponse.json({ keys: healthByKey, sweep });
  } catch (error) {
    console.error("[API] Failed to build key health:", error);
    return NextResponse.json({ keys: {}, sweep: [] });
  }
}
