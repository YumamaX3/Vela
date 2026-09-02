/**
 * Next.js 16 instrumentation hook — fires on first request during Node runtime.
 * Updated for Proxy Completion Covenant W1: boot Fleet Captain via fleet.init().
 *
 * NOTE: the Fleet Captain import MUST stay dynamic (inside the nodejs guard).
 * A top-level `import { init } from "@/lib/network/fleetStartup.js"` drags the
 * entire DB/network tree (node:fs, node:crypto, better-sqlite3, …) into the
 * Edge-runtime bundle, and Next.js then emits ~16k "Node.js API not supported
 * in the Edge Runtime" warnings per cold compile. The guard already no-ops on
 * Edge — the dynamic import stops the tree from being bundled there at all.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Boot Fleet Captain once per server lifetime (fire-and-forget).
    // v0.9.42: call startFleet, not init. init only builds the singleton;
    // startFleet also starts the egress geo probe and the geo pruner sweeper,
    // neither of which ever ran while this reached past it for `init`.
    try {
      const { startFleet } = await import("@/lib/network/fleetStartup.js");
      await startFleet();
    } catch (err) {
      console.warn("[instrumentation] Fleet Captain init failed:", err.message);
    }
  }
}
