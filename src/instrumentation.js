/**
 * Next.js 16 instrumentation hook — fires on first request during Node runtime.
 * Updated for Proxy Completion Covenant W1: boot Fleet Captain via fleet.init()
 */
import { init } from "@/lib/network/fleetStartup.js";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Boot Fleet Captain once per server lifetime (fire-and-forget)
    try {
      await init();
    } catch (err) {
      console.warn("[instrumentation] Fleet Captain init failed:", err.message);
    }
  }
}
