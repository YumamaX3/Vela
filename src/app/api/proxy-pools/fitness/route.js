/**
 * GET /api/proxy-pools/fitness
 * Full fitness projection for fleet status page (includes egress geo, v0.9.18)
 */
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import fleet from "@/lib/network/proxyFleet.js"; // Fleet Captain
import { poolGeoSnapshot } from "@/lib/network/poolGeo.js";

export async function GET() {
  try {
    const summary = fleet.getFitnessSummary();
    const geo = poolGeoSnapshot();
    return NextResponse.json({ fitness: summary, geo });
  } catch (err) {
    log.error("PROXYPOOLS", "fitness:", err.message);
    return NextResponse.json({ error: "fitness query failed" }, { status: 500 });
  }
}

/**
 * POST /api/proxy-pools/fitness
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
    log.error("PROXYPOOLS", "[fitness-reset]", err.message);
    return NextResponse.json({ error: "reset failed" }, { status: 500 });
  }
}
