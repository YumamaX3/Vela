// Usage Observatory W3-D — /api/usage/digest/send — manual digest trigger.
//
// Protection: the dashboardGuard middleware covers the whole "/api/usage"
// prefix (PROTECTED_API_PATHS). A write surface, but a benign one: it posts
// the digest to the operator-configured channels and stamps the marker.
//
//   POST /api/usage/digest/send — force a send NOW (bypasses the week dedupe
//                                  but never the enabled-channel check).
import { NextResponse } from "next/server";
import { runWeeklyDigest } from "@/sse/services/usageDigest.js";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await runWeeklyDigest({ force: true });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
