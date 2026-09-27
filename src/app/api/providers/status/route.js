import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";

export const dynamic = "force-dynamic";

// GET /api/providers/status — the rail's glint census (v1.0.30 "The Beacon
// Shore"). Counts only: no credentials, no providerSpecificData, no names
// cross this door — the same read-boundary law §5.4 set for the main route,
// applied by construction (nothing sensitive is ever selected).
//
// The state vocabulary mirrors ProvidersPage.deriveState so the nav rail and
// the providers console can never disagree on what "degraded" means — one
// server-computed census, not per-lens private opinions (the v0.9.86 lesson).
// Providers with zero connections are absent by design: nothing to glint
// about, and the noAuth nuance is a console display concern, not a signal.
function isCooling(conn) {
  const now = Date.now();
  return Object.entries(conn).some(
    ([k, v]) => k.startsWith("modelLock_") && v && new Date(v).getTime() > now,
  );
}

// One provider's connections → one fleet state. Precedence is deliberate and
// identical to the console's: cooling beats broken (a cooling key may
// recover on its own), any rejected key downgrades the provider even if a
// sibling key still serves.
function deriveState(conns) {
  if (conns.every((c) => c.isActive === false)) return "idle";
  const active = conns.filter((c) => c.isActive !== false);
  if (active.some((c) => isCooling(c))) return "cooling";
  const broken = active.filter((c) => {
    const s = c.testStatus === "unavailable" && !isCooling(c) ? "active" : c.testStatus;
    return s === "error" || s === "expired" || s === "unavailable";
  });
  if (broken.length === active.length) return "down";
  if (broken.length > 0) return "degraded";
  return "healthy";
}

// Fleet-worst precedence: down > degraded > cooling > idle > healthy. A
// provider you must look at outranks one that is merely waiting out a lock.
const WORST_ORDER = ["down", "degraded", "cooling", "idle", "healthy"];

export async function GET() {
  try {
    const connections = await getProviderConnections();
    const byProvider = new Map();
    for (const c of connections) {
      if (!byProvider.has(c.provider)) byProvider.set(c.provider, []);
      byProvider.get(c.provider).push(c);
    }
    const counts = { healthy: 0, degraded: 0, down: 0, cooling: 0, idle: 0 };
    let worst = null;
    for (const conns of byProvider.values()) {
      const state = deriveState(conns);
      counts[state] += 1;
      if (WORST_ORDER.indexOf(state) < WORST_ORDER.indexOf(worst ?? "healthy")) {
        worst = state;
      }
    }
    return NextResponse.json({ counts, worst, providers: byProvider.size });
  } catch (error) {
    console.log("Error building provider status census:", error);
    return NextResponse.json({ error: "Failed to build provider status" }, { status: 500 });
  }
}
