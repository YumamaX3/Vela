// GET  /api/backup/artifacts          — list every sealed artifact on disk
// GET  /api/backup/artifacts?id=...   — verify ONE artifact (decrypt + census)
//
// Under /api/backup/* this inherits ALWAYS_PROTECTED. Listing reads the
// UNENCRYPTED header only (no key needed); verification is the deliberate act
// that opens the seal with VELA_BACKUP_ENCRYPTION_KEY and reports the section
// census the artifact carries — so "does this backup still restore?" gets a
// real answer instead of a hope. Metadata only (S4): never ciphertext, never
// key material, never the secret-bundle contents (only their file names).
import { NextResponse } from "next/server";
import { listBackupArtifacts, verifyBackupArtifact } from "@/lib/db/repos/backupRepo";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (id) {
      try {
        const result = verifyBackupArtifact(id);
        return NextResponse.json(result);
      } catch (err) {
        // Sanitized: a key-material refusal names the ENV VAR and nothing else.
        const msg = err?.message || "";
        const safe = msg.startsWith("[backup] VELA_BACKUP_ENCRYPTION_KEY")
          ? msg
          : msg.includes("not found")
            ? "Artifact not found"
            : "Verification failed — wrong key or corrupted artifact";
        return NextResponse.json({ error: safe }, { status: 400 });
      }
    }
    return NextResponse.json({ artifacts: listBackupArtifacts() });
  } catch {
    return NextResponse.json({ error: "Failed to read artifact inventory" }, { status: 500 });
  }
}
