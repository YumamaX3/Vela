// Usage Observatory W2-B — GET /api/usage/metrics/timeseries
// Time-bucketed series for one metric. Two-tier under the hood: exact scan
// ≤3d, usageDaily rollup beyond. Granularity is validated against the frozen
// GRANULARITIES map (identifier covenant). Reads inherit dashboardGuard.
// W3-E: `previous=1` also returns the previous-window ghost series, aligned
// bucket-for-bucket onto the current axis (CostArea's compare overlay).
import { NextResponse } from "next/server";
import { getFilteredSeries } from "@/lib/usageDb";
import { parseFilters, parsePeriod, parseGranularity, parsePrevious, metricsErrorResponse } from "../_lib/params";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getFilteredSeries({
      filters: parseFilters(searchParams),
      period: parsePeriod(searchParams),
      granularity: parseGranularity(searchParams),
      metric: searchParams.get("metric") || "requests",
      previous: parsePrevious(searchParams),
    });
    return NextResponse.json(result);
  } catch (error) {
    return metricsErrorResponse(error, "timeseries");
  }
}
