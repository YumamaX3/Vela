/**
 * GET /api/proxy-pools/egress-history — Proxy Console Separation W2a/W2b
 * (plan §3.2). `?poolId=<id>` + optional `?period=` →
 * `{poolId, period, collecting, source, entries:[{ts, ip, country, ok}], stable,
 * flapCount, current, meta}`.
 *
 * THE TWO SOURCES, EACH LABELED HONESTLY (plan §2 wound 4):
 *   • the PERSISTED ledger (`proxyPoolEgressHistory`, migration 030) answers
 *     once the table exists — `source: "proxyPoolEgressHistory"`, survives a
 *     restart;
 *   • until it does, the in-memory ring answers — `source: "memory"` — and
 *     `collecting: true` says the persistence seam has not landed. The two are
 *     never mixed into one payload: one shape must be one truth.
 *
 * POSTURE (plan §3.4): timestamps, IPs, country codes — the same strings the
 * dashboard's egress column has always shown. No pool row, no `proxyUrl`.
 */
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { FilterParamError } from "@/lib/db/usageNames";
import { projectEgressHistory, egressHistoryImpl } from "@/lib/db/usageAggregation.js";
import { openStoreAdapter } from "@/lib/db/index.js";
import { getPoolGeo } from "@/lib/network/poolGeo.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const poolId = searchParams.get("poolId") || null;
    const period = searchParams.get("period") || "24h";
    if (!poolId) {
      return NextResponse.json({ error: "poolId required" }, { status: 400 });
    }

    // Persisted ledger first; fail-open to the ring on ANY failure (a DB that
    // has not reached 030 answers `collecting: true`, which is the signal to
    // fall through — not an error).
    let persisted = null;
    try {
      const db = await openStoreAdapter();
      persisted = await egressHistoryImpl(db, { poolId, period });
    } catch {
      persisted = null;
    }

    if (persisted && !persisted.collecting) {
      const geo = getPoolGeo(poolId);
      const current = geo ? { ip: geo.ip || "", country: geo.country || "", ts: geo.ts ? new Date(geo.ts).toISOString() : null } : null;
      // Stability rides the SAME ring classification the dashboard uses; the
      // ledger's own distinct-IP count is the durable fallback when the ring
      // has expired.
      const ledgerIps = new Set(persisted.entries.map((e) => e.ip).filter(Boolean));
      const ipCount = geo ? geo.ipCount : ledgerIps.size;
      return NextResponse.json({
        ...persisted,
        stable: geo ? geo.isUnstable !== true : ipCount < 2,
        flapCount: Math.max(0, ipCount - 1),
        current: current || (persisted.entries.length ? persisted.entries[persisted.entries.length - 1] : null),
      });
    }

    // The in-memory ring — the legacy shape, labeled `source: "memory"`.
    const geo = getPoolGeo(poolId);
    const projected = projectEgressHistory(geo, poolId);
    return NextResponse.json({ ...projected, period, collecting: true });
  } catch (error) {
    if (error instanceof FilterParamError) {
      return NextResponse.json(
        { error: "INVALID_FILTER_PARAM", field: error.field, value: error.value },
        { status: 400 }
      );
    }
    log.error("PROXYPOOLS", "[egress-history]:", error?.message || error);
    return NextResponse.json({ error: "Failed to read pool egress history" }, { status: 500 });
  }
}
