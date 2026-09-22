import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

// PUBLIC BY DESIGN — this path sits in dashboardGuard's PUBLIC_API_PATHS so the login
// screen can learn the login posture before anyone holds a session. What it must NOT
// do is hand an anonymous caller the operator's own hostnames: `tunnelUrl` and
// `tailscaleUrl` name the gateway's public address, and this endpoint answered them
// to anyone who could reach it (Security Closure M2 — an unauthenticated
// information-disclosure surface).
//
// The postures stay; the addresses go. Nothing in-repo read them from here (measured:
// the only source reference to this pathname is the guard's own public list, and the
// authenticated `GET /api/settings` still carries both values for the UI that needs
// them).
export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      requireLogin: settings.requireLogin !== false,
      tunnelDashboardAccess: settings.tunnelDashboardAccess !== false,
    });
  } catch (error) {
    return NextResponse.json({ requireLogin: true }, { status: 200 });
  }
}
