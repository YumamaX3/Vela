/**
 * GET /api/proxy-pools/export
 * Export all pools with fitness summary
 */
import { NextResponse } from "next/server";
import { getProxyPools } from "@/lib/localDb";
import fleet from "@/lib/network/proxyFleet.js"; // Fleet Captain for fitness data

export async function GET() {
  try {
    const pools = await getProxyPools({ isActive: true });
    const fitnessSummary = fleet.getFitnessSummary();

    return NextResponse.json({
      pools: pools.map(p => ({
        id: p.id,
        name: JSON.parse(p.data).name,
        type: JSON.parse(p.data).type,
        isActive: p.isActive,
      })),
      fitness: fitnessSummary,
    });
  } catch (err) {
    console.error("[export]", err.message);
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }
}
