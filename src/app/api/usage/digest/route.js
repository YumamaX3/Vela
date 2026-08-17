// Usage Observatory W3-D — /api/usage/digest — preview the weekly digest.
//
// Protection: the dashboardGuard middleware covers the whole "/api/usage"
// prefix (PROTECTED_API_PATHS) — posture-consistent with every other usage
// read surface. Read-only: builds the digest shape from the ledger without
// sending it and without touching the once-per-week marker.
//
//   GET /api/usage/digest — { enabled, status, digest } for the config card's
//                            preview + scheduler status.
import { NextResponse } from "next/server";
import { buildWeeklyDigest, getDigestStatus, isDigestEnabled } from "@/sse/services/usageDigest.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [enabled, digest, status] = await Promise.all([
      isDigestEnabled(),
      buildWeeklyDigest(),
      Promise.resolve(getDigestStatus()),
    ]);
    return NextResponse.json({ enabled, status: { ...status, enabled }, digest });
  } catch (error) {
    return NextResponse.json({ error: error.message || "digest preview failed" }, { status: 500 });
  }
}
