// POST /api/backup/drill — trigger the restore drill. "A backup never restored
// is a hope." The drill decrypts the newest artifact into a scratch DB — the
// live database is never touched. S4: password re-confirm with lockout.
import { NextResponse } from "next/server";
import { runRestoreDrill } from "@/lib/db/repos/backupRepo";
import { verifyBackupPassword } from "../_lib/auth";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const denied = await verifyBackupPassword(request, body.password);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });

    const result = await runRestoreDrill();
    return NextResponse.json(result);
  } catch (err) {
    const msg = err?.message || "";
    const safe = msg.startsWith("[backup] VELA_BACKUP_ENCRYPTION_KEY") ? msg : "Drill failed";
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
