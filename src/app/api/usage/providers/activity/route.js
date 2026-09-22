import { NextResponse } from "next/server";
import { getPerProviderFrame } from "@/lib/usageDb";

/**
 * GET /api/usage/providers/activity
 *
 * Live per-provider activity for the providers console: requests and errors
 * over a rolling 60s window, keyed by provider id. Funded by
 * getPerProviderFrame, which is memoized (<=30s) and fail-open, so a console
 * refresh never stamps a query per provider the way a per-row fan-out would.
 * Reads inherit the same guard as every /api/usage sibling.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const frame = await getPerProviderFrame();
    return NextResponse.json({
      perProvider: frame?.perProvider || {},
      windowMs: frame?.windowMs ?? 60000,
      ts: frame?.ts ?? null,
    });
  } catch (error) {
    console.log("Error fetching provider activity:", error);
    // Fail-open like the frame itself: an empty window is honest, a 500 is not.
    return NextResponse.json({ perProvider: {}, windowMs: 60000, ts: null });
  }
}
