// POST /api/settings/database/vacuum — reclaim free pages.
// Port of 9router-go `HandleVacuumDatabase`.
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { authorizeMaintenance, readJsonBody } from "@/lib/maintenanceAuth.js";
import { vacuumDatabase } from "@/lib/db/repos/sqlite/maintenanceRepo.js";

export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const denied = await authorizeMaintenance(request, body?.password);
    if (denied) return denied;
    return NextResponse.json(await vacuumDatabase());
  } catch (error) {
    log.error("SETTINGS", "Failed to vacuum:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to vacuum database" }, { status: 500 });
  }
}
