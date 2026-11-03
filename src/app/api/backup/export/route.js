// POST /api/backup/export — the SCOPED backup producer (cross-harbour).
//
// The encrypted .velabak engine (runBackup) is whole-harbour on the sqlite
// posture (and refuses a crop on mysql); this route is the portable sibling:
// a JSON artifact whose MANIFEST declares its scope, written to the export
// directory and restored by POST /api/settings/database (the section law) or
// by the backup cockpit's artifact readers.
//
// Body: { password, scope?: { sections?, providers? }, persistDefault? }
//   • no scope            → the whole-database artifact (unchanged surface)
//   • scope.sections      → exactly those of providers|keys|combos|proxyPools|
//                           injections|settings
//   • scope.providers     → an explicit provider id list; implies
//                           providers+keys+combos+proxyPools cropped to them
//   • persistDefault      → record this as the operator's default artifact scope
//
// S2: redacted at the source (redact: true) — this is a plaintext-readable JSON
// surface, so no secret-field may cross it; a scoped RESTORE is still a trust
// crossing and runs the S1 quarantine unless adoptSecrets is confirmed.
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { exportBackup } from "@/lib/db/repos/backupRepo";
import { normalizeBackupScope } from "@/lib/db/repos/backupSecurity.js";
import { BACKUPS_DIR, ensureDirs } from "@/lib/db/paths.js";
import { verifyBackupPassword } from "../_lib/auth";
import * as log from "@/sse/utils/logger.js";

export const dynamic = "force-dynamic";

/** Where export artifacts land: BACKUPS_DIR/exports (next to artifacts/). */
function exportsDir() {
  ensureDirs();
  const dir = path.join(BACKUPS_DIR, "exports");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const denied = await verifyBackupPassword(request, body.password);
    if (denied) return NextResponse.json(denied.body, { status: denied.status });

    let scope = null;
    if (body.scope !== undefined && body.scope !== null) {
      try {
        scope = normalizeBackupScope(body.scope);
      } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (!scope) return NextResponse.json({ error: "scope must name at least one section or provider" }, { status: 400 });
    }

    const artifact = await exportBackup({ scope, persistDefault: body.persistDefault === true });
    const file = path.join(exportsDir(), `${artifact.artifactId}.json`);
    fs.writeFileSync(file, JSON.stringify(artifact, null, 2), { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch {}
    return NextResponse.json({
      ok: true,
      artifactId: artifact.artifactId,
      fileName: `${artifact.artifactId}.json`,
      manifest: artifact.manifest,
    });
  } catch (err) {
    log.warn("BACKUP", "[backup/export] scoped export failed:", err?.message || String(err));
    return NextResponse.json({ error: "Export failed" }, { status: 400 });
  }
}
