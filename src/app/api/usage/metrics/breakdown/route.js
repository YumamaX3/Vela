// Usage Observatory W2-B — GET /api/usage/metrics/breakdown
// GROUP BY one dimension (provider|model|keyId|endpoint) with one metric.
// Dimension + metric are validated against the frozen identifier-covenant
// maps. Reads inherit dashboardGuard.
import { NextResponse } from "next/server";
import { getBreakdown } from "@/lib/usageDb";
import { parseFilters, parsePeriod, metricsErrorResponse } from "../_lib/params";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getBreakdown({
      filters: parseFilters(searchParams),
      period: parsePeriod(searchParams),
      dimension: searchParams.get("dimension") || "provider",
      metric: searchParams.get("metric") || "cost",
    });
    return NextResponse.json(result);
  } catch (error) {
    return metricsErrorResponse(error, "breakdown");
  }
}
