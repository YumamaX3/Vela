/**
 * GET /api/network/status — the Network lens's read-only truth in one call.
 *
 * Returns the four readers together (rate windows, upstream health + EWMA,
 * observed egress identities, timeout policy) so the lens makes ONE request
 * rather than four. Each reader fails open independently — a sleeping
 * subsystem returns an empty shape, never an error for the whole response.
 * ALWAYS_PROTECTED via the /api/network prefix (dashboardGuard).
 */
import { NextResponse } from "next/server";
import { getRateLimitSnapshot, getUpstreamHealth, getEgressReport, getTimeoutPolicy } from "@/lib/network/networkStatus.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const [rateLimits, upstream, egress, timeouts] = await Promise.all([
    getRateLimitSnapshot(),
    getUpstreamHealth(),
    getEgressReport(),
    getTimeoutPolicy(),
  ]);
  return NextResponse.json(
    { rateLimits, upstream, egress, timeouts, checkedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
