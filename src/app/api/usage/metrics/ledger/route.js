// Usage Observatory W2-B — GET /api/usage/metrics/ledger
// Server-paginated request ledger. Keyset pagination: `after` is the JSON
// cursor from the previous page's nextCursor ({v, id}), carrying the SORT
// column's own value. Sort column is validated against the frozen
// SORTABLE_COLUMNS map (identifier covenant). Reads inherit dashboardGuard.
import { NextResponse } from "next/server";
import { getLedgerRows } from "@/lib/usageDb";
import { parseFilters, parsePeriod, metricsErrorResponse } from "../_lib/params";

export const dynamic = "force-dynamic";

function parseCursor(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Number.isFinite(Number(parsed.id))) return parsed;
    throw new Error("cursor id not numeric");
  } catch {
    return undefined; // signal: malformed → 400
  }
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const after = parseCursor(searchParams.get("after"));
    if (after === undefined) {
      return NextResponse.json({ error: "INVALID_FILTER_PARAM", field: "after" }, { status: 400 });
    }
    const result = await getLedgerRows({
      filters: parseFilters(searchParams),
      period: parsePeriod(searchParams),
      sort: searchParams.get("sort") || "timestamp",
      order: searchParams.get("order") === "asc" ? "asc" : "desc",
      after,
      limit: Number(searchParams.get("limit")) || 50,
    });
    return NextResponse.json(result);
  } catch (error) {
    return metricsErrorResponse(error, "ledger");
  }
}
