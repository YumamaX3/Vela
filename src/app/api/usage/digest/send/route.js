// Usage Observatory W3-D — /api/usage/digest/send — manual digest trigger.
//
// Protection: the dashboardGuard middleware covers every "/api/*" path by
// default (its deny-by-default branch: JWT or local CLI token, and it passes
// on requireLogin===false). A write surface, but a benign one: it posts the
// digest to the operator-configured channels and stamps the marker. That
// branch is method-agnostic, so this POST rides the same posture as the GETs
// around it — nothing here escalates above requireLogin.
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
