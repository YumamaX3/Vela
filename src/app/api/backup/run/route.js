// POST /api/backup/run — immediate backup. S4: password re-confirm wrapped in
// lockout accounting. 409 if one is already running (idempotency law).
import { NextResponse } from "next/server";
import { runBackup } from "@/lib/db/repos/backupRepo";
import { normalizeBackupScope } from "@/lib/db/repos/backupSecurity.js";
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

    // A scoped backup (optional): the manifest declares exactly what it carries.
    let scope = null;
    if (body.scope !== undefined && body.scope !== null) {
      try {
        scope = normalizeBackupScope(body.scope);
      } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (!scope) return NextResponse.json({ error: "scope must name at least one section or provider" }, { status: 400 });
    }

    if (running) {
      return NextResponse.json({ error: "A backup is already running" }, { status: 409 });
    }
    running = true;
    try {
      const result = await runBackup({ trigger: "api", scope });
      // S4 — metadata only: never artifact bytes, never key material.
      return NextResponse.json({
        ok: result.ok,
        artifactId: result.artifactId,
        sizeBytes: result.sizeBytes,
        schemaVersion: result.manifest?.schemaVersion ?? null,
        secretBundleFiles: result.manifest?.secretBundle ?? [],
        scope: result.manifest?.scope ?? null,
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
