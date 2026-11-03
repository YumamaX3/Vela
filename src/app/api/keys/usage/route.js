import { NextResponse } from "next/server";
import { getKeyUsageStats } from "@/lib/usageDb";
import { emitWebhook } from "@/lib/webhooks.js";
import * as log from "@/sse/utils/logger.js";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

// GET /api/keys/usage?period=all — per-key rollup { [keyId]: { requests,
// promptTokens, completionTokens, totalTokens, cost, lastUsed } } for the
// Endpoints page. Attribution is keyId-based (hash-at-rest), so totals
// survive key rotation. Keys with no usage in the window are absent.
//
// USAGE EVENT — the ONE honest emission point for "a usage rollup completed":
// a COMPUTED rollup over the ledger window is complete by definition. It
// fires ONLY when the caller marks the read as a completed rollup
// (?notify=1 or ?refresh=1) — a dashboard poll that re-reads the same window
// every few seconds is not a completion, and ringing a webhook on every poll
// would be a lie told by the sender. The payload is aggregates + counts,
// never a per-key dump; the house masker coarsens what little identity rides.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const byKey = await getKeyUsageStats(period);
    // Fire-and-forget; the webhook layer masks the payload and is OFF by
    // default (an empty webhookEvents array emits nothing, reads nothing).
    const isCompletion = searchParams.get("notify") === "1" || searchParams.get("refresh") === "1";
    if (isCompletion) {
      const keys = Object.values(byKey || {});
      emitWebhook("usage", {
        period,
        rollup: "keys",
        keys: keys.length,
        requests: keys.reduce((n, k) => n + (k.requests || 0), 0),
        totalTokens: keys.reduce((n, k) => n + (k.totalTokens || 0), 0),
        cost: Number(keys.reduce((n, k) => n + (k.cost || 0), 0).toFixed(6)),
      });
    }
    return NextResponse.json({ period, byKey });
  } catch (error) {
    log.error("KEYS", "Failed to get per-key usage:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to fetch key usage" }, { status: 500 });
  }
}
