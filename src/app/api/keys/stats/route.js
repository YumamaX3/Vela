import { NextResponse } from "next/server";
import { getApiKeys, getSettings } from "@/lib/localDb";
import { getKeyUsageStats } from "@/lib/usageDb";
import {
  VALID_PERIODS,
  attentionFor,
  isLimited,
  isScoped,
  postureOf,
} from "../_lib/keysApi.js";

export const dynamic = "force-dynamic";

// GET /api/keys/stats?period=30d
// The key fleet's census: posture counts, category tree, scope/limit coverage,
// the posture the endpoint itself is in, and the two lists an operator actually
// scans — the busiest keys in the window, and everything that needs attention.
// Computed server-side so the page, the API and any future client agree on one
// arithmetic instead of three.
//
// Usage attribution is keyId-based (hash-at-rest), so the totals survive
// rotation; keys absent from `byKey` simply had no traffic in the window.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all";
    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const [keys, settings, byKey] = await Promise.all([
      getApiKeys(),
      getSettings().catch(() => ({})),
      getKeyUsageStats(period).catch(() => ({})),
    ]);

    const now = Date.now();
    const byPosture = { active: 0, paused: 0, expiring: 0, expired: 0 };
    const categories = new Map();
    const rows = [];
    let scoped = 0;
    let limited = 0;

    for (const key of keys) {
      const posture = postureOf(key, now);
      byPosture[posture] = (byPosture[posture] || 0) + 1;

      const usage = byKey?.[key.id] || null;
      const label = key.category || null;
      const bucket = categories.get(label) || { category: label, keys: 0, requests: 0 };
      bucket.keys += 1;
      bucket.requests += usage?.requests || 0;
      categories.set(label, bucket);

      if (isScoped(key)) scoped += 1;
      if (isLimited(key)) limited += 1;

      rows.push({
        id: key.id,
        name: key.name,
        category: label,
        posture,
        scoped: isScoped(key),
        limited: isLimited(key),
        createdAt: key.createdAt || null,
        lastUsedAt: key.lastUsedAt || null,
        expiresAt: key.expiresAt || null,
        requests: usage?.requests || 0,
        tokens: (usage?.promptTokens || 0) + (usage?.completionTokens || 0),
        cost: usage?.cost || 0,
        reasons: attentionFor(key, posture, { usage, now }),
      });
    }

    const active = rows.filter((r) => r.requests > 0);
    const idle = rows.filter((r) => r.requests === 0);

    const top = [...active]
      .sort((a, b) => b.requests - a.requests || b.tokens - a.tokens)
      .slice(0, 5)
      .map(({ id, name, category, posture, requests, tokens, cost, lastUsedAt }) => ({
        id,
        name,
        category,
        posture,
        requests,
        tokens,
        cost,
        lastUsedAt,
      }));

    const attention = rows
      .filter((r) => r.reasons.length > 0)
      .sort((a, b) => b.reasons.length - a.reasons.length || a.name.localeCompare(b.name))
      .map(({ id, name, posture, reasons }) => ({ id, name, posture, reasons }));

    return NextResponse.json({
      period,
      // The endpoint's own posture — the two switches that decide whether a
      // request carrying no key is even refused.
      posture: {
        requireApiKey: settings?.requireApiKey === true,
        requireLogin: settings?.requireLogin !== false,
      },
      totals: {
        keys: keys.length,
        active: byPosture.active,
        paused: byPosture.paused,
        expiring: byPosture.expiring,
        expired: byPosture.expired,
        scoped,
        limited,
        unrestricted: keys.length - scoped,
        unlimited: keys.length - limited,
        categories: categories.size,
        unused: idle.filter((r) => !r.lastUsedAt).length,
        activeInWindow: active.length,
        idleInWindow: idle.length,
        requests: rows.reduce((sum, r) => sum + r.requests, 0),
        tokens: rows.reduce((sum, r) => sum + r.tokens, 0),
        cost: rows.reduce((sum, r) => sum + r.cost, 0),
      },
      byPosture,
      byCategory: [...categories.values()].sort((a, b) => a.category === null ? 1 : b.category === null ? -1 : a.category.localeCompare(b.category)),
      top,
      attention,
      // The ≤50 the UI renders, so a fleet of hundreds does not ship a list the
      // operator cannot read. `attention` above is the honest full count.
      idle: idle.slice(0, 50).map(({ id, name, posture, lastUsedAt }) => ({ id, name, posture, lastUsedAt })),
    });
  } catch (error) {
    console.log("Error computing key stats:", error);
    return NextResponse.json({ error: "Failed to compute key stats" }, { status: 500 });
  }
}
