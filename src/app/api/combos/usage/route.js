import { NextResponse } from "next/server";
import { getComboUsage } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

// GET /api/combos/usage?hours=24&buckets=24
// Per-combo usage attribution (migration 015, v0.9.40). Guarded by the
// dashboardGuard's "/api/combos" prefix — same wall as GET /api/combos.
// Returns totals + a fixed-width bucketed series per combo so the combos
// page can draw sparklines without shipping raw rows.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const hours = Math.min(72, Math.max(1, Number(searchParams.get("hours")) || 24));
    const buckets = Math.min(72, Math.max(4, Number(searchParams.get("buckets")) || 24));

    const result = await getComboUsage({ hours, buckets });
    return NextResponse.json(result);
  } catch (error) {
    console.log("Error fetching combo usage:", error);
    return NextResponse.json({ error: "Failed to fetch combo usage" }, { status: 500 });
  }
}
