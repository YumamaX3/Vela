// POST /api/backup/run — immediate backup. S4: password re-confirm wrapped in
// lockout accounting. 409 if one is already running (idempotency law).
import { NextResponse } from "next/server";
import { runBackup } from "@/lib/db/repos/backupRepo";
import { verifyBackupPassword } from "../_lib/auth";

// Route-level mutex: a second request while one is running gets 409.
// (Best-effort per module instance — the engine's running guard is the true
// backstop.)
let running = false;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const denied = await verifyBackupPassword(request, body.password);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });

    if (running) {
      return NextResponse.json({ error: "A backup is already running" }, { status: 409 });
    }
    running = true;
    try {
      const result = await runBackup({ trigger: "api" });
      // S4 — metadata only: never artifact bytes, never key material.
      return NextResponse.json({
        ok: result.ok,
        artifactId: result.artifactId,
        sizeBytes: result.sizeBytes,
        schemaVersion: result.manifest?.schemaVersion ?? null,
        secretBundleFiles: result.manifest?.secretBundle ?? [],
      });
    } finally {
      running = false;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err?.message?.startsWith("[backup] VELA_BACKUP_ENCRYPTION_KEY") ? err.message : "Backup failed" },
      { status: 400 }
    );
  }
}
