import { NextResponse } from "next/server";
import { recentRoutes, healthScore } from "@/lib/network/pipeline/ledger.js";

export const dynamic = "force-dynamic";

/**
 * GET /api/proxy-pools/routing-ledger — W11 (F10).
 * The routing trace: the 256-slot ring, newest first, with the per-provider
 * health score rolled from the same window. `?provider=<id>` scopes both;
 * `?limit=<n>` caps the rows (max 256). Read-only — the ledger is the
 * operator's mirror, never the engine's input.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("provider") || null;
    const limitRaw = Number(searchParams.get("limit"));
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 32;
    const routes = recentRoutes({ providerId, limit });
    const health = healthScore(providerId);
    return NextResponse.json({ routes, health });
  } catch (error) {
    return NextResponse.json({ error: "Failed to read routing ledger" }, { status: 500 });
  }
}
