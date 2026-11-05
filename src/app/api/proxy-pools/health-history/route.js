/**
 * GET /api/proxy-pools/health-history — the per-pool outcome series.
 *
 * Proxy Console Separation §3.2 · the Fitness lens's history seam.
 *
 *   ?poolId=<id>            optional — scope to one pool (else the whole fleet)
 *   ?period=<24h|3d|…>      validated by resolvePeriodWindow → 400 on unknown
 *
 * Response: { poolId, period, series:[{ poolId, ts, verdict, latencyMs }],
 *             collecting, source, meta }.
 *
 * WHY THIS EXISTS (plan §2 wound #2): proxyFitness is an OVERWRITTEN 30s
 * snapshot — there is no history to chart. W2a's append-only
 * proxyPoolHealthHistory (migration 030) is the seam; if that table is absent
 * the series is EMPTY and `collecting:true` — the overwritten snapshot is never
 * charted as if it were history.
 *
 * THE POSTURE SEAM — `openStoreAdapter`, the harbour's permitted doorway (see the
 * analytics route for the full MySQL rationale). Deliberately not a repo that
 * resolves the driver directly.
 *
 * SAFETY — integers, timestamps, a poolId and a verdict string. No pool row, no
 * `proxyUrl`. Safe by construction for the posture-read allow-list. LOUD 500 on
 * a thrown dependency.
 */
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { FilterParamError, resolvePeriodWindow } from "@/lib/db/usageNames";
import { healthHistoryImpl } from "@/lib/db/usageAggregation.js";
import { openStoreAdapter } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "24h";
    const poolId = searchParams.get("poolId") || null;
    resolvePeriodWindow(period); // 400 on unknown, before opening the store

    const db = await openStoreAdapter();
    const result = await healthHistoryImpl(db, { poolId, period });

    return NextResponse.json({
      poolId: result?.poolId ?? poolId,
      period: result?.period || period,
      series: result?.series || [],
      collecting: result?.collecting === true,
      source: result?.source || "proxyPoolHealthHistory",
      meta: result?.meta || {},
    });
  } catch (error) {
    if (error instanceof FilterParamError) {
      return NextResponse.json(
        { error: "INVALID_FILTER_PARAM", field: error.field, value: error.value },
        { status: 400 }
      );
    }
    log.error("PROXYPOOLS", "[health-history]:", error?.message || error);
    return NextResponse.json({ error: "Failed to read pool health history" }, { status: 500 });
  }
}
