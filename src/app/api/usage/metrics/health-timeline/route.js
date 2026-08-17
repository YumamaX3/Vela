// Usage Observatory W4-D — GET /api/usage/metrics/health-timeline
// Uptime-style daily health strips per provider. The two-tier engine lives in
// usageAggregation.js (healthTimelineImpl): ≤3d an exact usageHistory scan
// bucketed by LOCAL day (the rollup writer's own key convention), 7d+ the
// usageDaily.statusByProvider rollup — O(days), never O(rows). Reads inherit
// dashboardGuard's JWT-or-requireLogin (PROTECTED_API_PATHS "/api/usage"
// prefix) like every metrics sibling. The identifier covenant rides
// parseFilters/parsePeriod — unknown values become an honest 400.
import { NextResponse } from "next/server";
import { getHealthTimeline } from "@/lib/usageDb";
import { parseFilters, parsePeriod, metricsErrorResponse } from "../_lib/params";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getHealthTimeline({
      filters: parseFilters(searchParams),
      period: parsePeriod(searchParams, "7d"),
    });
    return NextResponse.json(result);
  } catch (error) {
    return metricsErrorResponse(error, "health-timeline");
  }
}
