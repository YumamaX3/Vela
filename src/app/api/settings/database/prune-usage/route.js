// POST /api/settings/database/prune-usage — drop usage rows older than N days.
// Port of 9router-go `HandlePruneUsageHistory` (dry-run supported).
import * as log from "@/sse/utils/logger.js";
import { NextResponse } from "next/server";
import { authorizeMaintenance, readJsonBody } from "@/lib/maintenanceAuth.js";
import { pruneUsage } from "@/lib/db/repos/sqlite/maintenanceRepo.js";

export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const denied = await authorizeMaintenance(request, body?.password);
    if (denied) return denied;

    const days = Number(body?.days);
    const dryRun = body?.dryRun === true || String(body?.dryRun) === "1";
    if (!Number.isFinite(days) || days < 0) {
      return NextResponse.json({ error: "days must be a non-negative number" }, { status: 400 });
    }
    return NextResponse.json(await pruneUsage({ days, dryRun }));
  } catch (error) {
    log.error("SETTINGS", "Failed to prune usage:", (error?.message ?? error));
    return NextResponse.json({ error: "Failed to prune usage history" }, { status: 500 });
  }
}
