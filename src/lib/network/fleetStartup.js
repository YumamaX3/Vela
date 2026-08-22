/**
 * Fleet Captain boot hook — load fitness + start scheduler on server start
 */
import proxyFleet, { init } from "./proxyFleet.js";
import { startPoolEgressProbe } from "./poolEgressProbe.js";
import { pruneStaleGeo } from "./poolGeo.js";

export async function startFleet() {
  try {
    await proxyFleet.__test__.loadFitness();
    proxyFleet.startHealthScheduler();
    startPoolEgressProbe(); // v0.9.18 — background egress geo probe (fail-open)
    // State sweeper: prune expired geo entries every 10 min (MIBP pattern).
    // Fitness rows are DB-persisted with their own TTL/decay; only the
    // in-memory geo cache needs pruning.
    const sweeper = setInterval(() => {
      try {
        const geo = pruneStaleGeo();
        if (geo > 0) console.log(`[fleetStartup] pruned ${geo} stale geo entries`);
      } catch { /* fail-open */ }
    }, 10 * 60 * 1000);
    if (sweeper.unref) sweeper.unref();
    console.log("[fleetStartup] Fleet Captain initialized");
  } catch (err) {
    console.warn("[fleetStartup] Fleet Captain init failed:", err.message);
  }
}

// Alias init for instrumentation.js compatibility
export { init };

// Auto-execute if this is the main entry point
if (typeof require !== "undefined" && require.main === module) {
  startFleet();
}

export default startFleet;
