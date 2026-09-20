/**
 * GET /api/proxy-pools/stats — the fleet census.
 *
 * One server-computed census of the proxy fleet, so the dashboard, the API and
 * any future client agree on a single arithmetic (the same reasoning as
 * GET /api/combos/stats, which this mirrors). Counts only:
 *
 *   total / active / inactive   pools, from getProxyPools() — the WHOLE table,
 *                               not just the active slice, so the three add up.
 *   bound                       connections currently bound to a pool: the SUM of
 *                               the shared usage map, i.e. the fleet-wide form of
 *                               the per-pool `boundConnectionCount` that
 *                               GET /api/proxy-pools returns (the dashboard renders
 *                               that as "{n} bound", so the unit is connections).
 *   relays                      pools whose type is a relay envelope
 *                               (vercel | cloudflare | deno), plus their total.
 *   fitness                     the fitness summary projected to four buckets:
 *                               blocked (an OPEN unfit window), healthy
 *                               (score >= HEALTHY_SCORE — the dashboard's own "Fit"
 *                               threshold), unhealthy (everything else), tracked
 *                               (rows). One row is a (pool, provider) pair.
 *   egress                      over the pools counted: how many have a live geo
 *                               probe, how many flapped (>= 2 distinct egress IPs),
 *                               and how many distinct countries they egress from.
 *   tested                      pools by their last verdict: ok (testStatus
 *                               "active"), fail ("error"), unknown (everything
 *                               else, including never-tested).
 *   lastTestedAt                the most recent pool test timestamp, ISO, or null.
 *
 * SAFETY — why this route can sit on the posture-read allow-list.
 * Every other entry in PROXY_POOLS_POSTURE_READS emits pool OBJECTS (masked at the
 * HTTP edge, §5.4). This one emits only integers and one timestamp: no pool row is
 * spread into the response, so no `proxyUrl` — masked or otherwise — can cross this
 * boundary. The census is safe BY CONSTRUCTION, which is why it needs no masker;
 * the structural test asserts the wire carries no `proxyUrl` key at all.
 *
 * HELPER REUSE. `bound` comes from buildUsageMap (in lib/network/poolUsage.js,
 * where it moved after `next build` rejected exporting it from the sibling
 * route module) and the fitness block from fleet.getFitnessSummary() — the exact
 * helpers the two neighbouring reads already run. Re-deriving either here would
 * be the duplication that let bulk-health drift out of sync; this route counts,
 * it does not re-implement counting.
 *
 * FAILURE IS LOUD. A thrown dependency returns 500, never a zeroed census — a census
 * that silently reads "0 pools" during a DB outage is worse than an error, because
 * nothing downstream can tell it apart from a genuinely empty fleet.
 */
import { NextResponse } from "next/server";
import { getProviderConnections, getProxyPools } from "@/models";
import fleet from "@/lib/network/proxyFleet.js";
import { poolGeoSnapshot } from "@/lib/network/poolGeo.js";
import { buildUsageMap } from "@/lib/network/poolUsage.js";

// force-dynamic: a census must describe the fleet NOW, never a build-time snapshot.
export const dynamic = "force-dynamic";

// The dashboard's own "Fit" threshold (FleetStatusPanel.jsx: `score >= 0.7`), reused
// so the census and the per-provider panel never disagree about what "healthy" means.
// Its "Caution" (>= 0.4) and "Poor" both fold into `unhealthy`: a binary census has no
// room for a third bucket, and `blocked` already carries the hard-stop case.
const HEALTHY_SCORE = 0.7;
const RELAY_TYPES = ["vercel", "cloudflare", "deno"];
// A pool's last verdict is one of three classes. "active" is the only ok; "error" is
// the only fail; every other value (and null) is honestly unknown.
const TESTED_OK = "active";
const TESTED_FAIL = "error";

/** An unfit row blocks only while its window is OPEN. An expired or unparseable
 *  window is not a block (pick() self-recovers on expiry), and a null unfitUntil is
 *  an open-ended block — the same rule the fitness deck applies client-side. */
function isBlocked(record, now) {
  if (!record?.unfit) return false;
  if (!record.unfitUntil) return true;
  const until = Date.parse(record.unfitUntil);
  return Number.isNaN(until) ? true : now < until;
}

export async function GET() {
  try {
    const [pools, connections] = await Promise.all([
      getProxyPools(),
      getProviderConnections(),
    ]);
    const list = (Array.isArray(pools) ? pools : []).filter(Boolean);
    const usageMap = buildUsageMap(Array.isArray(connections) ? connections : []);

    const now = Date.now();
    const relays = { vercel: 0, cloudflare: 0, deno: 0, total: 0 };
    const tested = { ok: 0, fail: 0, unknown: 0 };
    const ids = new Set();
    let active = 0;
    let bound = 0;
    let lastTestedMs = null;

    for (const pool of list) {
      if (!pool) continue;
      ids.add(pool.id);
      if (pool.isActive) active += 1;
      if (RELAY_TYPES.includes(pool.type)) {
        relays[pool.type] += 1;
        relays.total += 1;
      }
      if (pool.testStatus === TESTED_OK) tested.ok += 1;
      else if (pool.testStatus === TESTED_FAIL) tested.fail += 1;
      else tested.unknown += 1;
      // Only pools that still exist contribute to the bound count — the usage map
      // is keyed by poolId and could otherwise carry a binding left by a pool that
      // was deleted between the two reads.
      bound += usageMap.get(pool.id) || 0;
      const testedAt = pool.lastTestedAt ? Date.parse(pool.lastTestedAt) : NaN;
      if (!Number.isNaN(testedAt) && (lastTestedMs === null || testedAt > lastTestedMs)) {
        lastTestedMs = testedAt;
      }
    }

    const summary = fleet.getFitnessSummary();
    const records = Array.isArray(summary?.pools) ? summary.pools : [];
    const fitness = { blocked: 0, unhealthy: 0, healthy: 0, tracked: records.length };
    for (const record of records) {
      if (isBlocked(record, now)) fitness.blocked += 1;
      else if (Number(record?.score) >= HEALTHY_SCORE) fitness.healthy += 1;
      else fitness.unhealthy += 1;
    }

    // Egress is scoped to the pools this census counted, so a geo entry left by a
    // deleted pool cannot inflate "probed" past "total".
    const geo = poolGeoSnapshot(now);
    const countries = new Set();
    let probed = 0;
    let unstable = 0;
    for (const [poolId, entry] of Object.entries(geo || {})) {
      if (!ids.has(poolId)) continue;
      probed += 1;
      if (entry?.isUnstable) unstable += 1;
      if (entry?.country) countries.add(entry.country);
    }

    return NextResponse.json({
      total: list.length,
      active,
      inactive: list.length - active,
      bound,
      relays,
      fitness,
      egress: { probed, unstable, countries: countries.size },
      tested,
      lastTestedAt: lastTestedMs === null ? null : new Date(lastTestedMs).toISOString(),
    });
  } catch (err) {
    // Loud, never a zeroed census — see the header. A zeroed body is the shape of an
    // empty fleet, and a DB outage must not be able to impersonate one.
    console.error("[proxy-pools/stats]", err?.message || err);
    return NextResponse.json({ error: "Failed to compute proxy pool census" }, { status: 500 });
  }
}
