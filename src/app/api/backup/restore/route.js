// POST /api/backup/restore — the trust crossing. S1: RESTORE-QUARANTINED
// fields restore only under adoptSecrets=true AND an explicit confirmSecrets
// acknowledgement (two deliberate clicks, never one). S4: password re-confirm
// with lockout accounting; error responses are sanitized (never artifact
// internals, paths, or SQL). S6: the response carries restartRequired — after
// a secret-bundle restore a restart is MANDATORY before sessions are trusted.
//
// SCOPED RESTORE: `body.scope` names the sections (+ optional provider ids) a
// cross-harbour export artifact should replace; a scoped .velabak artifact
// already declares its own scope in its payload/manifest, which importDb reads.
//
// PREVIEW: `?preview=1` (or body.preview) returns the artifact's manifest —
// version, date, the sections it PRESENT — and the scope it declares, WITHOUT
// applying anything: no decrypt-into-DB, no safety backup, no ledger row. It
// reads the unencrypted artifact header and (for a JSON export artifact) the
// manifest block; it never touches the live harbour.
import { NextResponse } from "next/server";
import { restoreBackup, listBackupArtifacts, verifyBackupArtifact } from "@/lib/db/repos/backupRepo";
import { normalizeBackupScope } from "@/lib/db/repos/backupSecurity.js";
import { verifyBackupPassword } from "../_lib/auth";
import fs from "node:fs";
import path from "node:path";

function readArtifactManifest(backupId) {
  const listed = listBackupArtifacts().find((a) => a.id === backupId) || null;
  const headerMeta = listed
    ? { created: listed.created, trigger: listed.trigger, schemaVersion: listed.schemaVersion, sourceMode: listed.sourceMode, scope: listed.scope, secretBundle: listed.secretBundle }
    : null;
  return { listed, headerMeta };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const denied = await verifyBackupPassword(request, body.password);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });

    const { searchParams } = new URL(request.url);
    const wantsPreview = searchParams.get("preview") === "1" || body.preview === true;

    let requestedScope = null;
    if (body.scope !== undefined && body.scope !== null) {
      try {
        requestedScope = normalizeBackupScope(body.scope);
      } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (!requestedScope) {
        return NextResponse.json({ error: "scope must name at least one section or provider" }, { status: 400 });
      }
    }

    const { backupId } = body;

    if (wantsPreview) {
      // READS ONLY: the header of the artifact (unencrypted manifest), the
      // payload's section census (decrypt — proving the artifact opens — but
      // writing NOTHING), and the declared scope. No safety backup, no import,
      // no ledger.
      const { listed, headerMeta } = readArtifactManifest(backupId);
      if (!listed) {
        return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
      }
      let verified = null;
      let verifyError = null;
      try {
        const v = verifyBackupArtifact(backupId);
        verified = { sections: v.sections, schemaVersion: v.schemaVersion, exportedAt: v.exportedAt, scope: v.scope ?? null };
      } catch (err) {
        verifyError = err?.message?.startsWith("[backup] VELA_BACKUP_ENCRYPTION_KEY")
          ? err.message
          : "Artifact could not be opened — wrong key or corrupted backup";
      }
      const scope = requestedScope || verified?.scope || headerMeta?.scope || null;
      // Sections PRESENT: where the artifact carries a section census, that is
      // the truth; before it, presence is "declared scope present".
      const declared = scope?.sections ?? null;
      // PRESENT is what the census SAW — never what a default would assume.
      // An artifact that will not open has no present sections, and says so.
      const present = verified?.sections
        ? Object.entries(verified.sections).filter(([, n]) => n > 0).map(([k]) => k)
        : [];
      const comparable = !scope || !requestedScope || !verified?.scope || JSON.stringify(scope) === JSON.stringify(verified.scope);
      return NextResponse.json({
        preview: true,
        artifactId: listed.id,
        manifest: {
          format: "velabak",
          version: verified?.schemaVersion ?? headerMeta?.schemaVersion ?? null,
          date: verified?.exportedAt ?? headerMeta?.created ?? null,
          trigger: headerMeta?.trigger ?? null,
          sourceMode: headerMeta?.sourceMode ?? null,
          sections: declared && declared.length ? declared : null, // null ⇒ full (declare none)
          present,
          scope,
          secretBundle: headerMeta?.secretBundle ?? [],
          verifiable: Boolean(verified),
        },
        request: { scope: requestedScope, scopeMatchesArtifact: comparable },
        verifyError,
        applied: false,
      });
    }

    const { adoptSecrets = false, confirmSecrets = false } = body;
    if (adoptSecrets === true && confirmSecrets !== true) {
      return NextResponse.json(
        {
          error: "adoptSecrets requires confirmSecrets=true — quarantined fields (password, authMode, oidc*, key hashes) cross the trust boundary only under explicit acknowledgement",
        },
        { status: 400 }
      );
    }

    const result = await restoreBackup({ artifactId: backupId, adoptSecrets: adoptSecrets === true, trigger: "api", scope: requestedScope });
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
