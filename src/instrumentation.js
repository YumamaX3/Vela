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

    // M3 §2 — the durable log transport. Joins the console capture above,
    // inside the same nodejs guard: logshipper owns its own worker spawn, so
    // it must NOT be pulled into the Edge bundle. Fire-and-forget and
    // fail-soft — a transport that cannot boot must never stop the server.
    try {
      const { initLogshipper } = await import("@/lib/logshipper/index.js");
      await initLogshipper();
    } catch (err) {
      console.warn("[instrumentation] Logshipper init failed:", err.message);
    }

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

    // Model-catalog sync (fire-and-forget): the gateway's published modality /
    // limit snapshot, refreshed on a 24h cadence. Dynamic for the same reason as
    // the Fleet Captain import above — keep the fs tree out of the Edge bundle.
    try {
      const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
      startModelCatalogSync();
    } catch (err) {
      console.warn("[instrumentation] Model catalog sync failed:", err.message);
    }

    // OpenCode free-tier catalog (fire-and-forget). The free lane's membership
    // and endpoints are derived from models.opencode.ai/api.json — ported from
    // azrinaldi/opencode-free-bridge, 2026-10-20. The service also refreshes
    // lazily on the first free request, so this is a warm start, never a gate:
    // a boot-time failure leaves the shipped fallback standing.
    try {
      const { refreshOpenCodeCatalog } = await import("open-sse/services/opencodeCatalog.js");
      refreshOpenCodeCatalog().catch(() => {});
    } catch (err) {
      console.warn("[instrumentation] OpenCode catalog warm-up failed:", err.message);
    }

    // M4 (plans/2026-10-28-codebuddy-family.md) — bind the CodeBuddy family's
    // circuit breaker to the persistent ledger, so its open windows survive a
    // restart. Fire-and-forget inside the same nodejs guard: a binding failure
    // degrades to memory-only (the breaker guards, it simply forgets), never
    // to a boot failure. Dynamic import for the same reason as the Fleet
    // Captain above — keep the db/better-sqlite3 tree out of the Edge bundle.
    try {
      const { openStoreAdapter } = await import("@/lib/db/repos/sqlite/storeAdapter.js");
      const { bindCodeBuddyBreaker } = await import("open-sse/shared/codebuddy/breakerBinding.js");
      void bindCodeBuddyBreaker(await openStoreAdapter());
    } catch {
      // Memory-only. The next CodeBuddy request still guards; a harbour that
      // has not booted its db yet has nothing to persist either.
    }
  }
}
