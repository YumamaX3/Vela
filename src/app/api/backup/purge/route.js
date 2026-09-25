// POST /api/backup/purge — the usage-retention window, triggered by hand.
//
// The scheduler already purges AFTER each scheduled backup (purged rows live
// in the artifact by ordering). This route is the operator's own hand on the
// same lever: purge usageHistory + requestDetails older than the retention
// window NOW, without waiting for the next tick. Under /api/backup/* it
// inherits ALWAYS_PROTECTED; as a mutation it re-confirms the dashboard
// password inside lockout accounting (the run/restore/drill precedent).
//
// The body may carry { retentionDays } to override the env window for one
// call; an absent/zero value falls back to VELA_USAGE_RETENTION_DAYS. A
// non-positive window purges nothing (the repo's own guard) — reported
// honestly rather than dressed as success.
import { NextResponse } from "next/server";
import { purgeOldUsage } from "@/lib/db/repos/backupRepo";
import { verifyBackupPassword } from "../_lib/auth";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const denied = await verifyBackupPassword(request, body.password);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });

    const days = Number(body.retentionDays);
    const result = await purgeOldUsage(
      Number.isFinite(days) && days > 0 ? { retentionDays: days } : {}
    );
    if (!result.purged) {
      return NextResponse.json(
        { ok: false, purged: false, message: "Retention window is 0 (keep forever) — nothing purged" },
        { status: 200 }
      );
    }
    return NextResponse.json({
      ok: true,
      purged: true,
      usageHistory: result.usageHistory,
      requestDetails: result.requestDetails,
      message: `Purged ${result.usageHistory} usage rows and ${result.requestDetails} request details`,
    });
  } catch (err) {
    const msg = err?.message || "";
    const safe = msg.startsWith("[backup] VELA_BACKUP_ENCRYPTION_KEY") ? msg : "Purge failed";
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
