/**
 * POST /api/proxy-pools/fitness/clear-all
 * Clear every (or per-provider) fitness block + record — the proxy-fitness
 * deck's "Clear All" action (MIBP parity, v0.9.65).
 */
import { NextResponse } from "next/server";
import fleet from "@/lib/network/proxyFleet.js";

export async function POST(request) {
  try {
    let providerId = null;
    try {
      const body = await request.json();
      if (typeof body?.provider === "string" && body.provider) providerId = body.provider;
    } catch {
      // empty body → clear everything
    }
    const cleared = await fleet.clearAllFitness(providerId);
    return NextResponse.json({ success: true, cleared });
  } catch (err) {
    console.error("[fitness-clear-all]", err.message);
    return NextResponse.json({ error: "clear-all failed" }, { status: 500 });
  }
}
