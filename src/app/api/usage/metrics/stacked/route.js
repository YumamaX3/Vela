// Usage Observatory W2-C — GET /api/usage/metrics/stacked
// Time × dimension stacked series (top-N + Other): one series per dimension
// value (bucketed points), the long tail folded into "Other". Funds the
// Overview deck's stacked areas (Row C) and the Analytics deck's UsageByKey /
// ErrorMix. Dimension, metric, granularity and period are validated against
// the frozen identifier-covenant maps; reads inherit dashboardGuard
// (its deny-by-default "/api/*" branch — same posture as its siblings).
import { NextResponse } from "next/server";
import { getStackedSeries } from "@/lib/usageDb";
import {
  parseFilters,
  parsePeriod,
  parseGranularity,
  metricsErrorResponse,
} from "../_lib/params";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getStackedSeries({
      filters: parseFilters(searchParams),
      period: parsePeriod(searchParams),
      dimension: searchParams.get("dimension") || "provider",
      granularity: parseGranularity(searchParams),
      metric: searchParams.get("metric") || "requests",
    });
    return NextResponse.json(result);
  } catch (error) {
    return metricsErrorResponse(error, "stacked");
  }
}
