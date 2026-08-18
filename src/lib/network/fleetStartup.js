/**
 * Fleet Captain boot hook — load fitness + start scheduler on server start
 */
import proxyFleet, { init } from "./proxyFleet.js";

export async function startFleet() {
  try {
    await proxyFleet.__test__.loadFitness();
    proxyFleet.startHealthScheduler();
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
