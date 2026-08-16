// Usage Observatory W2-B — GET /api/usage/metrics/kpis
// Current-window totals + previous-window totals (one CASE WHEN query) so the
// KPI cards can show honest deltas. Reads inherit dashboardGuard's
// JWT-or-requireLogin (PROTECTED_API_PATHS "/api/usage" prefix).
import { NextResponse } from "next/server";
import { getKpis } from "@/lib/usageDb";
import { parseFilters, parsePeriod, metricsErrorResponse } from "../_lib/params";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getKpis({
      filters: parseFilters(searchParams),
      period: parsePeriod(searchParams, "24h"),
    });
    return NextResponse.json(result);
  } catch (error) {
    return metricsErrorResponse(error, "kpis");
  }
}
