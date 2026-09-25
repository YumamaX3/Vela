// GET /api/backup/inventory — the Data cockpit's storage census.
//
// Under /api/backup/* this route inherits dashboardGuard's ALWAYS_PROTECTED
// (JWT regardless of requireLogin) — the cockpit never rides the
// deny-by-default branch, exactly as the rest of the backup surface does not.
// Reads only, so no password re-confirm (the /api/backup/{status,list}
// precedent). Metadata only (S4): row counts, file sizes, policy flags. The
// off-site block carries NO credential — the endpoint is reduced to its host,
// and the access/secret keys never leave the env.
import { NextResponse } from "next/server";
import { getStorageInventory } from "@/lib/db/repos/backupRepo";
import { getBackupStatus } from "@/shared/services/backupScheduler";
import { s3Config, isS3Enabled } from "@/lib/db/repos/s3Offsite";

export async function GET() {
  try {
    const inventory = await getStorageInventory();
    const backup = getBackupStatus();
    const cfg = s3Config();
    let endpointHost = null;
    if (cfg.endpoint) {
      try {
        endpointHost = new URL(cfg.endpoint).host;
      } catch {
        endpointHost = cfg.endpoint.replace(/\/\/[^@/]*@/, "//");
      }
    }
    return NextResponse.json({
      inventory,
      backup,
      offsite: {
        enabled: cfg.enabled,
        armed: isS3Enabled(),
        endpointHost,
        bucket: cfg.bucket || null,
        region: cfg.region || null,
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to read storage inventory" }, { status: 500 });
  }
}
