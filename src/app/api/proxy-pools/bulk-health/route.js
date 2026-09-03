/**
 * POST /api/proxy-pools/bulk-health
 *
 * Bulk health check with concurrency cap + optional auto-disable.
 *
 * ⚠️ v0.9.44 (milestone 0.6, LIVE-B): this route used to carry its OWN copy of
 * the health loop — a pre-v0.9.42 copy that Wave 0 never touched, because Wave 0
 * repaired the engine (`checkAllPools` / `checkPoolHealth` in proxyFleet.js) and
 * this file had already forked. Three defects in twenty lines:
 *
 *   B1 `if (autoDisable && !result.ok)` — deactivated a pool on ANY failure,
 *      including a timeout, a 5xx, or a throw in the probe's own path. Wave 0's
 *      law is that a pool may be deactivated only on a DETERMINISTIC verdict;
 *      everything else is `indeterminate` and leaves the pool active. That law
 *      exists because the fleet once self-liquidated: a missing import threw,
 *      the throw read as `{ok:false}`, every pool was disabled, and the damage
 *      replicated to the live MariaDB twin.
 *   B2 No `indeterminate` bucket — three states collapsed into `alive`/`dead`,
 *      so an indeterminate probe was REPORTED as dead even when it did not
 *      disable anything.
 *   B3 `checkPoolHealth(pool.id)` re-fetched a pool row the route already held
 *      from its own `getProxyPools` call — an N+1 across the whole fleet.
 *
 * The defect class was duplication, so the repair removes the second copy rather
 * than fixing it: this route is now a thin wrapper over the engine, and B1-B3
 * close because the engine already answers all three correctly. A single loop
 * means the two paths cannot drift apart again — which is exactly how this
 * happened.
 *
 * Named import, not the `fleet` default: the default export is a lazy facade
 * kept alive for older callers (proxyFleet.js:930+), and binding the function
 * directly removes one indirection from a route whose whole job is now to call
 * it. `auth.js:3` was converted the same way during Wave 0.
 */
import { NextResponse } from "next/server";
import { checkAllPools } from "@/lib/network/proxyFleet.js";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { autoDisable = false, concurrency = null } = body ?? {};

    // An explicit operator cap is still validated; the DEFAULT is now null so
    // the engine's dynamic concurrency (min(16, max(4, ceil(N/50)))) applies.
    // The old default of 4 pinned a 1,000-pool sweep to ~250s for no reason —
    // the scheduler at proxyFleet.js:716 has always used the dynamic value.
    if (concurrency !== null && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)) {
      return NextResponse.json({ error: "concurrency must be 1-20" }, { status: 400 });
    }

    const result = await checkAllPools({ autoDisable: !!autoDisable, concurrency });

    // checkAllPools catches internally and returns null on a total failure (e.g.
    // the pool listing itself threw). Surfacing that as an empty 200 with
    // `total: 0` would read as "the fleet is healthy" — the exact shape of
    // silence Wave 0 exists to prevent. Fail loudly instead.
    if (!result) {
      return NextResponse.json({ error: "health check failed" }, { status: 500 });
    }

    // `results` carries the per-pool detail (poolId, ok, verdict, elapsedMs,
    // error, status) — it was always built inside checkAllPools, just never
    // returned. `indeterminate` is new to this payload; `dead` now means
    // PROVEN dead rather than "not ok".
    return NextResponse.json(result);
  } catch (err) {
    console.error("[bulk-health]", err.message);
    return NextResponse.json({ error: "health check failed" }, { status: 500 });
  }
}
