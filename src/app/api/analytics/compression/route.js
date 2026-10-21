// GET /api/analytics/compression?period=24h|7d|30d|all
//
// Port of 9router-go `HandleGetCompressionAnalytics`. The window name is the
// one the Usage page already uses; `since` (hours) remains accepted because it
// was this endpoint's only name before. The resolved period is echoed so an
// empty window cannot be mistaken for a different one.
import { NextResponse } from "next/server";
import { getCompressionAnalyticsSummary } from "@/lib/db/repos/compressionAnalyticsRepo.js";

const PERIOD_HOURS = { "1h": 1, "6h": 6, "24h": 24, "7d": 168, "30d": 720 };

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const raw = searchParams.get("period") || "";
    const sinceHours = Number(searchParams.get("since"));

    let hours = null;
    let label = "all";
    if (PERIOD_HOURS[raw]) {
      hours = PERIOD_HOURS[raw];
      label = raw;
    } else if (Number.isFinite(sinceHours) && sinceHours > 0) {
      hours = Math.min(sinceHours, 720);
      label = `${hours}h`;
    }

    const sinceIso = hours ? new Date(Date.now() - hours * 3600_000).toISOString() : null;
    const summary = await getCompressionAnalyticsSummary({ sinceIso, period: label });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[Analytics] Failed to read compression summary:", error);
    return NextResponse.json({ error: "Failed to read compression analytics" }, { status: 500 });
  }
}
