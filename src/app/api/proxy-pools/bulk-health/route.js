/**
 * POST /api/proxy-pools/bulk-health
 * Bulk health check with concurrency cap + optional auto-disable
 */
import { NextResponse } from "next/server";
import { getProxyPools } from "@/lib/localDb";
import fleet from "@/lib/network/proxyFleet.js"; // Fleet Captain

export async function POST(request) {
  try {
    const body = await request.json();
    const { autoDisable = false, concurrency = 4 } = body;

    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
      return NextResponse.json({ error: "concurrency must be 1-20" }, { status: 400 });
    }

    const allPools = await getProxyPools({ isActive: true });
    const results = [];
    let alive = 0, dead = 0;

    // Concurrency-limited execution
    for (let i = 0; i < allPools.length; i += concurrency) {
      const batch = allPools.slice(i, i + concurrency);
      await Promise.all(batch.map(async (pool) => {
        try {
          const result = await fleet.checkPoolHealth(pool.id);
          results.push({ poolId: pool.id, ok: result.ok, elapsedMs: result.elapsedMs });

          if (result.ok) alive++; else dead++;

          if (autoDisable && !result.ok) {
            // Auto-disable dead pool
            const { updateProxyPool } = await import("@/lib/localDb");
            await updateProxyPool(pool.id, { isActive: false });
          }
        } catch (err) {
          results.push({ poolId: pool.id, ok: false, error: err.message });
          dead++;
        }
      }));
    }

    return NextResponse.json({ total: allPools.length, alive, dead, results });
  } catch (err) {
    console.error("[bulk-health]", err.message);
    return NextResponse.json({ error: "health check failed" }, { status: 500 });
  }
}
