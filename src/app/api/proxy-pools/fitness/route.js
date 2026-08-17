/**
 * GET /api/proxy-pools/fitness
 * Full fitness projection for fleet status page
 */
import { NextResponse } from "next/server";
import fleet from "@/lib/network/proxyFleet.js"; // Fleet Captain

export async function GET() {
  try {
    const summary = fleet.getFitnessSummary();
    return NextResponse.json({ fitness: summary });
  } catch (err) {
    console.error("[fitness]", err.message);
    return NextResponse.json({ error: "fitness query failed" }, { status: 500 });
  }
}

/**
 * POST /api/proxy-pools/fitness/reset
 * Reset fitness for specific pool/provider
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { poolId, providerId = null } = body;

    if (!poolId) {
      return NextResponse.json({ error: "poolId required" }, { status: 400 });
    }

    await fleet.resetFitness(poolId, providerId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[fitness-reset]", err.message);
    return NextResponse.json({ error: "reset failed" }, { status: 500 });
  }
}
