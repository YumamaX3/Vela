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
 *
 * v0.9.65: the fleet import rides the SAME "@/lib/network/proxyFleet.js"
 * specifier the API routes use — never "./proxyFleet.js". On Windows the two
 * specifiers can resolve to two module instances (the storm suites' wound):
 * boot would hydrate and sweep one store while every route read another, and
 * the deck would show an empty sea over a fleet that was actually on fire.
 * Same specifier, same instance — in turbopack dev and in the standalone
 * build alike.
 */
import { init, pruneExpiredBlocks } from "@/lib/network/proxyFleet.js";
import { startPoolEgressProbe } from "./poolEgressProbe.js";
import { pruneStaleGeo } from "./poolGeo.js";

export async function startFleet() {
  try {
    // init() owns the singleton: loadFitness + startHealthScheduler +
    // scheduleFlush. Reaching into __test__ for loadFitness duplicated it
    // against a null binding — call the real thing.
    await init();
    startPoolEgressProbe(); // v0.9.18 — background egress geo probe (fail-open)
    // Unified state sweeper (v0.9.65, MIBP parity): every 10 min, relax
    // expired unfit blocks back to neutral (the block was already ignored at
    // pick time — this reclaims active state and persists the relaxation) and
    // prune stale geo entries. Fail-open: a failed tick retries next period.
    const sweeper = setInterval(() => {
      try {
        const relaxed = pruneExpiredBlocks();
        const geo = pruneStaleGeo();
        if (relaxed > 0 || geo > 0) {
          console.log(`[fleetStartup] state sweeper: relaxed ${relaxed} expired blocks, pruned ${geo} stale geo entries`);
        }
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
