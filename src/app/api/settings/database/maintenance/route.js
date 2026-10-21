// DATABASE MAINTENANCE — the missing cockpit for the harbor.
//
// WHY THIS EXISTS: `/api/settings/database` was export/import ONLY (GET and
// POST). There was no stats surface, no retention control, and — critically —
// no way to REPAIR a malformed image from inside the running gateway. The live
// failure showed exactly why that gap matters:
//
//   Failed to save usage stats: SqliteError: database disk image is malformed
//   [requestDetailsRepo] Batch write failed: ... database disk image is malformed
//
// Those arrived once per request, forever, with the only remedy being "find the
// file on the host and hope". Every route here answers to the same password /
// CLI-token contract as the sibling export/import surface.
//
// Routes (all under /api/settings/database/maintenance):
//   GET  ?                                    — file + table sizes, row counts
//   POST ?action=integrity|prune-usage|vacuum|repair
//
// The persistence itself lives in src/lib/db/repos/sqlite/maintenanceRepo.js
// (Storage Covenant: raw adapter access stays inside the harbor).
import { NextResponse } from "next/server";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

const CLI_TOKEN_HEADER = "x-vela-cli-token";
const PASSWORD_HEADER = "x-9r-password";

function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

async function authorized(request, passwordFromBody) {
  if (isCliRequest(request)) return true;
  const password = passwordFromBody ?? request.headers.get(PASSWORD_HEADER);
  return verifyDashboardPassword(password);
}

const unauthorized = () => NextResponse.json({ error: "Invalid password" }, { status: 401 });

export async function GET(request) {
  try {
    if (!(await authorized(request))) return unauthorized();

    const { getDatabaseStats } = await import("@/lib/db/repos/sqlite/maintenanceRepo.js");
    return NextResponse.json(await getDatabaseStats());
  } catch (error) {
    console.error("Error reading database stats:", error);
    return NextResponse.json({ error: "Failed to read database stats" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    if (!(await authorized(request, body?.password))) return unauthorized();

    const action = String(body.action || request.nextUrl?.searchParams?.get("action") || "").toLowerCase();
    const repo = await import("@/lib/db/repos/sqlite/maintenanceRepo.js");

    if (action === "integrity" || action === "check") {
      return NextResponse.json(await repo.runIntegrityProbe({ full: body.full === true }));
    }

    if (action === "prune-usage") {
      const days = Number(body.days);
      const dryRun = body.dryRun === true || String(body.dryRun) === "1";
      if (!Number.isFinite(days) || days < 0) {
        return NextResponse.json(
          { error: "days must be a non-negative number (0 = only demoted rows)" },
          { status: 400 }
        );
      }
      return NextResponse.json(await repo.pruneUsage({ days, dryRun }));
    }

    if (action === "vacuum") {
      return NextResponse.json(await repo.vacuumDatabase());
    }

    if (action === "repair") {
      return NextResponse.json(await repo.repairImage());
    }

    return NextResponse.json(
      { error: "Unknown action. Expected one of: integrity, prune-usage, vacuum, repair" },
      { status: 400 }
    );
  } catch (error) {
    if (error && (error.code === "SQLITE_CORRUPT" || /malformed/i.test(String(error.message)))) {
      return NextResponse.json(
        {
          error: "The database image is malformed — run POST /api/settings/database/repair.",
          code: error.code || "SQLITE_CORRUPT",
        },
        { status: 500 }
      );
    }
    console.error("Error running database maintenance:", error);
    return NextResponse.json({ error: "Database maintenance failed" }, { status: 500 });
  }
}
