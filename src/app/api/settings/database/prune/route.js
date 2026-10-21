// POST /api/settings/database/prune — retention-driven purge of request
// details + usage rows. Port of 9router-go `HandlePruneDatabase`, riding the
// harbor's existing purgeOldUsage so there is one deletion path, not two.
import { NextResponse } from "next/server";
import { authorizeMaintenance, readJsonBody } from "@/lib/maintenanceAuth.js";
import { purgeOldUsage } from "@/lib/db/repos/backupRepo.js";

export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const denied = await authorizeMaintenance(request, body?.password);
    if (denied) return denied;

    const days = Number(body?.days ?? process.env.VELA_USAGE_RETENTION_DAYS ?? 7);
    if (!Number.isFinite(days) || days <= 0) {
      return NextResponse.json({ error: "days must be a positive number" }, { status: 400 });
    }
    const result = await purgeOldUsage({ retentionDays: days });
    return NextResponse.json({ success: true, retentionDays: days, ...result });
  } catch (error) {
    console.error("[Database] Failed to prune:", error);
    return NextResponse.json({ error: "Failed to prune database" }, { status: 500 });
  }
}
