// Storage Covenant Wave C5 — the mirror startup matrix.
//
// Plan (plans/storage-covenant.md, startup degradation + driver×mode matrix):
//   mirror | sqlite chain + pump | reachable     → full mirror
//   mirror | sqlite chain        | transient loss → primary serves; outbox
//                                                    accumulates; alert rises
//   mirror | sqlite chain        | down at boot  → start degraded: primary up,
//                                                    pump retrying; mode STAYS
//                                                    mirror (never silently
//                                                    downgrades to sqlite)
//
// This module is the ONE place the three mirror rhythms start: the pump (C3,
// boot catch-up drains the outage backlog), the usage-resync watermark (C4),
// and the divergence sweep (C4). Under any posture OTHER than mirror, the
// rhythms are stopped — they ride the outbox/pump, which only exists in mirror.
//
// The law that binds: fail-open, never block boot. The mirror's whole promise
// is that the primary keeps serving when the twin is down — so starting the
// rhythms must NEVER throw or await the twin. startMirrorPump fires an
// immediate catch-up that backs off on its own when the twin is unreachable;
// the twin is NOT probed here. Mode never silently downgrades.
import { getDbMode } from "@/lib/db/repos/bind.js";

/** Start/stop the mirror rhythms to match the current posture. Idempotent;
 *  safe to call repeatedly (boot + settings changes). Fail-open by law —
 *  any error is logged, never thrown to the caller. */
export function configureMirrorStartup() {
  try {
    const mode = getDbMode();
    if (mode !== "mirror") {
      // Not mirror — the rhythms have no outbox to drain; stop them if a prior
      // posture-change started them. (Mode is resolved once per process, so this
      // branch is normally a no-op at boot.)
      void stopMirrorRhythms();
      return;
    }
    void startMirrorRhythms();
  } catch (e) {
    // Fail-open: a startup error must never take the primary down.
    console.warn(`[mirror] startup configuration failed (fail-open, primary keeps serving): ${e?.message || e}`);
  }
}

/** Start all three mirror rhythms. Each start is idempotent; the pump's boot
 *  catch-up fires immediately (draining the outage backlog), then settles into
 *  its rhythm. None of these await the twin — a down twin just means the pump
 *  backs off and the outbox accumulates (the mirror's core promise). */
export async function startMirrorRhythms() {
  const [{ startMirrorPump }, { startUsageResync }, { startMirrorSweep }] = await Promise.all([
    import("@/lib/db/mirror/mirrorPump.js"),
    import("@/lib/db/mirror/usageResync.js"),
    import("@/lib/db/mirror/mirrorSweep.js"),
  ]);
  startMirrorPump();      // boot catch-up drains pending ops, then the rhythm
  startUsageResync();     // usage watermark append (the exempt class's path)
  startMirrorSweep();     // divergence fingerprint + full-resync guard
  console.log("[mirror] startup — pump + usage-resync + divergence sweep armed (primary serving; mode stays mirror)");
}

/** Stop all three mirror rhythms (idempotent). Used when leaving mirror
 *  posture or shutting down. */
export async function stopMirrorRhythms() {
  const [{ stopMirrorPump }, { stopUsageResync }, { stopMirrorSweep }] = await Promise.all([
    import("@/lib/db/mirror/mirrorPump.js"),
    import("@/lib/db/mirror/usageResync.js"),
    import("@/lib/db/mirror/mirrorSweep.js"),
  ]);
  stopMirrorPump();
  stopUsageResync();
  stopMirrorSweep();
}
