// POST /api/settings/database/vacuum — reclaim free pages.
// Port of 9router-go `HandleVacuumDatabase`.
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
    console.error("[Database] Failed to vacuum:", error);
    return NextResponse.json({ error: "Failed to vacuum database" }, { status: 500 });
  }
}
