// GET /api/backup/status — policy, next run, degraded flag, last result (S4
// metadata only). ALWAYS_PROTECTED at dashboardGuard; no password re-confirm
// for reads.
import { NextResponse } from "next/server";
import { getBackupStatus } from "@/shared/services/backupScheduler";

export async function GET() {
  try {
    return NextResponse.json(getBackupStatus());
  } catch {
    return NextResponse.json({ error: "Failed to read backup status" }, { status: 500 });
  }
}
