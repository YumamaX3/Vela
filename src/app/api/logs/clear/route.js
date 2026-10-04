// Log Pipeline v2 · M7 — POST /api/logs/clear
//
// DESTRUCTIVE AND IRREVERSIBLE. §6's posture is three locks, and all three
// are load-bearing:
//
//   1. ALWAYS_PROTECTED — the `"/api/logs"` roster literal already escalates
//      the whole prefix above requireLogin===false. Nothing here re-declares
//      it; a second auth branch would only open a path the roster misses.
//   2. `x-9r-password` RE-CONFIRM — a live session is not enough for an
//      irreversible erase. Absent or wrong answers 401 (the
//      settings-database precedent). A stolen cookie alone cannot destroy the
//      operator's log ledger.
//   3. ONE authAuditLog ROW PER SUCCESSFUL CLEAR — through the existing
//      metadata-only audit service, in a DIFFERENT table from logEvents. That
//      separation is the whole point (A09): a clear that leaves no trace is
//      the monitoring failure erasing itself. The audit row survives the
//      delete because it is not in the deleted table.
//
// THE CSRF SECOND LOCK applies to this POST automatically — it sits above
// every auth branch in dashboardGuard's proxy() and refuses a browser-labelled
// cross-site mutation before this handler is ever reached.
import { NextResponse } from "next/server";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { auditAuthEvent } from "@/lib/auth/authAudit.js";
import { runOrderedClear, SETTLE_BOUND_MS } from "@/lib/logshipper/clear.js";
import { getLogshipperStats } from "@/lib/logshipper/index.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PASSWORD_HEADER = "x-9r-password";

/**
 * The event name. The audit service's `AUTH_EVENTS` vocabulary is frozen (every
 * entry is consumed by the session/login ledger), so this door declares its own
 * — namespaced under `logs.` so it can never collide with a login event, and
 * named rather than re-typed at the call site.
 *
 * Deliberately NOT exported: Next's generated route-type gate
 * (`.next/types/app/api/logs/clear/route.ts`) admits only handler + config
 * exports from a route module, and an extra named export fails the build's
 * typecheck (`TS2344 ... is not assignable to type 'never'`).
 */
const LOGS_CLEARED_EVENT = "logs.cleared";

export async function POST(request) {
  try {
    // Lock 2 — the re-confirm, BEFORE anything irreversible happens.
    const presented = request.headers.get(PASSWORD_HEADER);
    if (!presented || !(await verifyDashboardPassword(presented))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    // The ordered clear (§6's seven steps, in clear.js).
    const verdict = await runOrderedClear();

    // The retention posture is recorded WITH the clear: "I deleted 4,000 rows"
    // is materially different from "I deleted 4,000 rows under a 14-day sweep
    // that will keep deleting", and the trail is the only place that pairing
    // survives.
    const stats = getLogshipperStats();
    const retention = stats.retention ?? { mode: "age", days: 14 };

    // Lock 3 — the audit row. METADATA ONLY by construction: the audit
    // service drops any key that smells like a credential and truncates
    // strings, so the detail below can carry no secret even if it tried.
    await auditAuthEvent(LOGS_CLEARED_EVENT, {
      request,
      detail: {
        deleted: verdict.deleted,
        settled: verdict.settled,
        transport: stats.transport,
        posture: stats.posture,
        retentionMode: retention.mode ?? null,
        retentionDays: retention.days ?? null,
        // The peer class, derived from the stamping the custom server applies.
        // `local` and `remote` are the only two facts the trail needs about
        // WHO cleared, and neither is inferred from a spoofable header alone.
        peerClass: request.headers.get("x-9r-real-ip") ? "stamped" : "unstamped",
      },
    });

    return NextResponse.json({
      cleared: true,
      deleted: verdict.deleted,
      settled: verdict.settled,
      steps: verdict.steps,
      elapsedMs: verdict.elapsedMs,
      settleBoundMs: SETTLE_BOUND_MS,
    });
  } catch (error) {
    console.error("[API] logs/clear failed:", error);
    return NextResponse.json({ error: "Failed to clear logs" }, { status: 500 });
  }
}
