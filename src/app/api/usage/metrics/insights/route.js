// Usage Observatory W4-B — GET /api/usage/metrics/insights
// The Lookout's feed: the signal registry (usageInsights.js) evaluated over
// the SAME window + census the decks look at. Reads inherit dashboardGuard's
// JWT-or-requireLogin (PROTECTED_API_PATHS "/api/usage" prefix).
// Column guards ride the evaluator: every signal demands a minimum sample
// before it may speak; a quiet window returns an honest empty list.
import { NextResponse } from "next/server";
import { getInsights } from "@/lib/usageDb";
import { parseFilters, parsePeriod, metricsErrorResponse } from "../_lib/params";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getInsights({
      filters: parseFilters(searchParams),
      period: parsePeriod(searchParams, "24h"),
    });
    return NextResponse.json(result);
  } catch (error) {
    return metricsErrorResponse(error, "insights");
  }
}
