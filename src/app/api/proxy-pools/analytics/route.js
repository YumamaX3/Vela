/**
 * GET /api/proxy-pools/analytics — the per-pool usage census.
 *
 * Proxy Console Separation §3.2 · the Usage lens's data seam.
 *
 *   ?period=<24h|3d|7d|…>   (validated by resolvePeriodWindow → 400 on unknown)
 *
 * Response: { period, wired, since, source, pools:[{ poolId, label:{id,name,type},
 *             …requests/errors/tokens/cost/latency }], meta }.
 *
 * SAFETY — why this rides the posture-read allow-list (same argument as stats):
 * every row is integers + a poolId + a {id,name,type} label. No pool row is
 * spread into the wire, so `proxyUrl` can never cross — masked or otherwise.
 * buildPoolLabels is the ONE projection and it copies exactly three identifying
 * fields. The structural test walks the whole tree for `proxyUrl` / `scheme://`
 * and finds neither.
 *
 * THE POSTURE SEAM. This route opens the store through `openStoreAdapter` — the
 * harbour's one permitted raw-adapter doorway — and calls the engine-neutral
 * `poolAnalyticsImpl`. It deliberately does NOT go through a repo that resolves
 * the SQLite driver directly: under `VELA_DB_MODE=mysql` the raw driver path
 * (driver.js → resolveDriver) reads a SQLite file the mysql posture never
 * writes, while `openStoreAdapter` fails LOUD (storeAdapter's posture guard) —
 * the same fail-loud law the fleet's own persistence follows, never a silent
 * empty census from an orphan store.
 *
 * HONESTY — two separate truths. `wired` answers "does the poolId column exist"
 * (the seam landed); `since` is the attribution WATERLINE (oldest attributed
 * row) and `meta.collecting` follows the waterline, not the flag — so a page
 * says "collecting since <when>" for a cold-but-migrated harbour exactly as for
 * a pre-migrate one, and a busy hour is never misread as "migration missing"
 * (R6: honest empty state, never a fabricated backfill).
 *
 * FAILURE IS LOUD — a thrown dependency is a 500 with no `pools` key, so a
 * client can never mistake an outage for an empty fleet.
 */
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { FilterParamError, resolvePeriodWindow } from "@/lib/db/usageNames";
import { poolAnalyticsImpl, poolProviderMapImpl } from "@/lib/db/usageAggregation.js";
import { openStoreAdapter, getProxyPools } from "@/lib/db/index.js";
import { buildPoolLabels, resolvePoolLabel } from "@/lib/network/poolUsageLabels.js";

export const dynamic = "force-dynamic";

function errorResponse(error, label) {
  if (error instanceof FilterParamError) {
    return NextResponse.json(
      { error: "INVALID_FILTER_PARAM", field: error.field, value: error.value },
      { status: 400 }
    );
  }
  log.error("PROXYPOOLS", `[analytics] ${label}:`, error?.message || error);
  return NextResponse.json({ error: "Failed to read pool analytics" }, { status: 500 });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "24h";
    resolvePeriodWindow(period); // 400 on unknown, before opening the store

    const db = await openStoreAdapter();
    const result = await poolAnalyticsImpl(db, { period });

    // Labels — fail-open on their own: an unlabeled bucket is better than a
    // dark page. buildPoolLabels is the BOUNDARY ({id,name,type} only).
    let labelMap = new Map();
    try { labelMap = buildPoolLabels(await getProxyPools()); } catch { labelMap = new Map(); }

    // Provider facets — also fail-open (an unbound pool labels no providers).
    let providerMap = null;
    try { providerMap = await poolProviderMapImpl(db); } catch { providerMap = null; }

    const pools = (result?.pools || []).map((p) => ({
      ...p,
      label: resolvePoolLabel(labelMap, p.poolId),
      providers: providerMap && providerMap.get ? [...(providerMap.get(p.poolId) || [])].sort() : [],
    }));

    const since = result?.since ?? null;
    return NextResponse.json({
      period: result?.period || period,
      wired: result?.wired !== false, // the column exists (seam landed)
      since,
      source: result?.source || "usageHistory",
      pools,
      // `collecting` is VOLUME honesty, not seam honesty: no attributed row has
      // landed yet (null waterline, empty census). A quiet-but-wired hour says
      // "collecting since <when>" exactly as a pre-migrate harbour does — the
      // two truths never ride on one flag, so a busy hour is never mistaken for
      // "the migration never landed".
      meta: { ...(result?.meta || {}), collecting: since === null },
    });
  } catch (error) {
    return errorResponse(error, "census");
  }
}
