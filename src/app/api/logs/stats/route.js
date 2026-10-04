// Log Pipeline v2 · M7 — GET /api/logs/stats
//
// A thin, HONEST passthrough of getLogshipperStats(). §6 names the fields:
// ring counts · dropped counter · worker state · degraded flag · posture
// (sqlite|mysql|mirror) · `twin: "not-mirrored"` when mirror · retention
// posture · shutdown-flush window. `getLogshipperStats()` already computes
// every one of them (M4 built it for this door) — the route's whole job is to
// add the two numbers only the DURATION can answer: how many rows the durable
// ledger holds, and the retention posture actually in force.
//
// WHY the extra count is asked for HERE and not folded into the shipper
// stats: the shipper must never open a database on a stats read (§2's R4 and
// probeDriver's whole reason for existing). This door is a dashboard route, so
// opening the harbor is its job; the shipper's stats stay I/O-free.
//
// POSTURE: covered by the `"/api/logs"` ALWAYS_PROTECTED roster entry. A count
// of the durable ledger is still a census of what the harbor has recorded.
import { NextResponse } from "next/server";
import { getLogshipperStats } from "@/lib/logshipper/index.js";
import { countLogEvents } from "@/lib/db/repos/sqlite/logQuery.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const stats = getLogshipperStats();

    // The retention posture the WORKER is actually enforcing. Until M8 wires
    // `settings.logRetention`, this is the shipper's own default — reported as
    // a value, not as an omission, so the harbor never implies a retention
    // policy nobody has configured.
    const retention = stats.retention ?? { mode: "age", days: 14, source: "default" };

    let rows = null;
    let rowsError = null;
    try {
      rows = await countLogEvents({});
    } catch (error) {
      // An honest `null` + reason, never a zero. A zero here would read as
      // "the ledger is empty", which is a claim about the harbor's state that
      // a failed read has no standing to make.
      rowsError = String(error?.message ?? error);
    }

    return NextResponse.json({
      ...stats,
      durableRows: rows,
      durableRowsError: rowsError,
      retention,
    });
  } catch (error) {
    console.error("[API] logs/stats failed:", error);
    return NextResponse.json({ error: "Failed to read logshipper stats" }, { status: 500 });
  }
}
