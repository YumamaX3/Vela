// GET /api/backup/list — ledger entries, paginated. S4: metadata only — the
// repo surface already omits the error field (its strings carry paths/SQL
// detail and stay inside the DB).
import { NextResponse } from "next/server";
import { listBackupLedger } from "@/lib/db/repos/backupRepo";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit")) || 50;
    const offset = Number(searchParams.get("offset")) || 0;
    const entries = await listBackupLedger({ limit, offset });
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ error: "Failed to list backup ledger" }, { status: 500 });
  }
}
