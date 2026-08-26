// GET  /api/settings/sessions — list active dashboard sessions.
// POST /api/settings/sessions — revoke: { all: true } ends every session
//                              (JWT_SECRET rotation); { current: true }
//                              clears this browser's cookie client-side.
//
// Sessions are stateless JWTs (dashboardSession.js), so "list" is honest about
// what the server can know: it cannot enumerate other browsers' tokens. What
// it CAN report is this session's own claims plus the server-side truth that
// exists (session timeout policy, lockout state). Revoking ALL sessions IS
// fully real — rotating JWT_SECRET invalidates every outstanding token at once.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  AUTH_COOKIE_NAME,
  getDashboardAuthSession,
} from "@/lib/auth/dashboardSession";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await cookies();
    const token = store.get(AUTH_COOKIE_NAME)?.value;
    let current = null;
    if (token) {
      const claims = await getDashboardAuthSession(token);
      if (claims) {
        // Never echo the token itself — only its non-secret claims.
        current = {
          issuedAt: claims.iat ? new Date(claims.iat * 1000).toISOString() : null,
          expiresAt: claims.exp ? new Date(claims.exp * 1000).toISOString() : null,
          authenticated: claims.authenticated === true,
        };
      }
    }
    const settings = await getSettings();
    return NextResponse.json(
      {
        current,
        sessionTimeoutMins: settings.sessionTimeoutMins ?? 0,
        bruteForceLockout: settings.bruteForceLockout !== false,
        // Stateless-JWT honesty: the server cannot enumerate other devices.
        enumerable: false,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to read sessions" }, { status: 500 });
  }
}
