import { NextResponse } from "next/server";
import { getKeyUsageStats } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

// GET /api/keys/usage?period=all — per-key rollup { [keyId]: { requests,
// promptTokens, completionTokens, totalTokens, cost, lastUsed } } for the
// Endpoints page. Attribution is keyId-based (hash-at-rest), so totals
// survive key rotation. Keys with no usage in the window are absent.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const byKey = await getKeyUsageStats(period);
    return NextResponse.json({ period, byKey });
  } catch (error) {
    console.error("[API] Failed to get per-key usage:", error);
    return NextResponse.json({ error: "Failed to fetch key usage" }, { status: 500 });
  }
}
