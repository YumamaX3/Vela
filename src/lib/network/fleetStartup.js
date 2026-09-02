/**
 * Fleet Captain boot hook — load fitness + start scheduler on server start
 *
 * v0.9.42: this module was the boot orchestrator in name only. The default
 * import below is `global.__velaProxyFleet || null`, which is null at
 * module-eval time, so `proxyFleet.__test__.loadFitness()` threw a null
 * dereference on every call — and nothing ever called it. instrumentation.js
 * reached past this file for the re-exported `init` instead, which meant the
 * egress geo probe (:12) and the geo pruner sweeper (:16) never ran in any
 * deployment, ever. Both are now on the real boot path.
 */
import { init } from "./proxyFleet.js";
import { startPoolEgressProbe } from "./poolEgressProbe.js";
import { pruneStaleGeo } from "./poolGeo.js";

export async function startFleet() {
  try {
    // init() owns the singleton: loadFitness + startHealthScheduler +
    // scheduleFlush. Reaching into __test__ for loadFitness duplicated it
    // against a null binding — call the real thing.
    await init();
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
