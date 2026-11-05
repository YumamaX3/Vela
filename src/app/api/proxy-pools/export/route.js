/**
 * GET /api/proxy-pools/export
 * Export all ACTIVE pools (identifying fields only) with their fitness summary.
 *
 * §2 wound #6 mend (Proxy Console Separation W2b). The old body called
 * `JSON.parse(p.data).name` — but the repo's readers (`getProxyPools` →
 * rowToPool) already SPREAD the JSON blob into flat fields and expose `name`/
 * `type` at the top level. `p.data` is undefined on those rows, so JSON.parse
 * threw and every export was a 500. The fix projects the flat fields the repo
 * actually returns; no parse, no throw.
 *
 * SAFETY: the projection is the explicit allow-list (id, name, type, isActive)
 * the redaction census names — this route never emitted `proxyUrl` and still
 * does not. Fitness is the summarized four-bucket shape, no per-pool credential.
 */
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { getProxyPools } from "@/lib/localDb";
import fleet from "@/lib/network/proxyFleet.js"; // Fleet Captain for fitness data

export async function GET() {
  try {
    const pools = await getProxyPools({ isActive: true });
    const fitnessSummary = fleet.getFitnessSummary();

    return NextResponse.json({
      pools: (pools || []).map((p) => ({
        id: p.id,
        name: p.name ?? null,
        type: p.type ?? null,
        isActive: p.isActive,
      })),
      fitness: fitnessSummary,
    });
  } catch (err) {
    log.error("PROXYPOOLS", "export:", err.message);
    return NextResponse.json({ error: "export failed" }, { status: 500 });
  }
}
