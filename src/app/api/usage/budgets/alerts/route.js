// Usage Observatory W3-C — /api/usage/budgets/alerts — the active-breach
// surface for the dashboard banner. Read-only.
//
// Protection: the dashboardGuard middleware covers every "/api/*" path by
// default (its deny-by-default branch: JWT or local CLI token, and it passes
// on requireLogin===false) — posture-consistent with every other usage read
// surface.
//
//   GET /api/usage/budgets/alerts — the breaches still live in their window,
//                                    worst first, for the cockpit banner.
import { NextResponse } from "next/server";
import { getActiveBudgetBreaches } from "@/sse/services/budgetAlerts.js";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ breaches: getActiveBudgetBreaches() });
}
