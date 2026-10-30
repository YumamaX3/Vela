// GET /api/settings/database/stats — harbor footprint and row census.
// Port of 9router-go `HandleGetDatabaseStats`.
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { authorizeMaintenance } from "@/lib/maintenanceAuth.js";
import { getDatabaseStats } from "@/lib/db/repos/sqlite/maintenanceRepo.js";

export async function GET(request) {
  try {
    const denied = await authorizeMaintenance(request);
    if (denied) return denied;
    return NextResponse.json(await getDatabaseStats());
  } catch (error) {
    log.error("SETTINGS", "Failed to read stats:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to read database stats" }, { status: 500 });
  }
}
