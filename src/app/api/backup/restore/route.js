// POST /api/backup/restore — the trust crossing. S1: RESTORE-QUARANTINED
// fields restore only under adoptSecrets=true AND an explicit confirmSecrets
// acknowledgement (two deliberate clicks, never one). S4: password re-confirm
// with lockout accounting; error responses are sanitized (never artifact
// internals, paths, or SQL). S6: the response carries restartRequired — after
// a secret-bundle restore a restart is MANDATORY before sessions are trusted.
import { NextResponse } from "next/server";
import { restoreBackup } from "@/lib/db/repos/backupRepo";
import { verifyBackupPassword } from "../_lib/auth";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const denied = await verifyBackupPassword(request, body.password);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });

    const { backupId, adoptSecrets = false, confirmSecrets = false } = body;
    if (adoptSecrets === true && confirmSecrets !== true) {
      return NextResponse.json(
        {
          error: "adoptSecrets requires confirmSecrets=true — quarantined fields (password, authMode, oidc*, key hashes) cross the trust boundary only under explicit acknowledgement",
        },
        { status: 400 }
      );
    }

    const result = await restoreBackup({ artifactId: backupId, adoptSecrets: adoptSecrets === true, trigger: "api" });
    return NextResponse.json({
      ok: result.ok,
      artifactId: result.artifactId,
      schemaVersion: result.schemaVersion,
      restoredSecrets: result.restoredSecrets,
      restartRequired: result.restartRequired,
      safetyBackupTaken: result.safetyBackupTaken,
      message: result.restartRequired
        ? "Restore complete. A RESTART IS REQUIRED before sessions are trusted — the JWT signing key is captured at module load and will not match the restored bundle until the process restarts."
        : "Restore complete.",
    });
  } catch (err) {
    // S4 — sanitize: key-material refusals are safe to surface (they name the
    // ENV VAR, nothing more); everything else stays generic.
    const msg = err?.message || "";
    const safe = msg.startsWith("[backup] VELA_BACKUP_ENCRYPTION_KEY")
      ? msg
      : msg.includes("authentication failed") || msg.includes("truncated") || msg.includes("magic mismatch")
        ? "Artifact verification failed — wrong key or corrupted backup"
        : msg.includes("newer than this build")
          ? msg
          : "Restore failed";
    return NextResponse.json({ error: safe }, { status: 400 });
  }
}
