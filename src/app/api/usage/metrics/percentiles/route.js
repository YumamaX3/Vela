// Usage Observatory W2-B — GET /api/usage/metrics/percentiles
// Latency p50/p95/p99, two-tier honest: exact nearest-rank ≤3d, histogram
// from usageDaily.latencyBuckets beyond (meta.approximate + coverage tell
// the truth). Reads inherit dashboardGuard.
import { NextResponse } from "next/server";
import { getPercentiles } from "@/lib/usageDb";
import { parseFilters, parsePeriod, metricsErrorResponse } from "../_lib/params";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getPercentiles({
      filters: parseFilters(searchParams),
      period: parsePeriod(searchParams, "3d"),
    });
    return NextResponse.json(result);
  } catch (error) {
    return metricsErrorResponse(error, "percentiles");
  }
}
