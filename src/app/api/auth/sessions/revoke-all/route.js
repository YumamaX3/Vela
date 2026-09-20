import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getDashboardAuthSession,
  clearDashboardAuthCookie,
  AUTH_COOKIE_NAME,
} from "@/lib/auth/dashboardSession";
import { revokeAllAuthSessions } from "@/lib/db/repos/authStoreRepo.js";
import { auditAuthEvent, AUTH_EVENTS } from "@/lib/auth/authAudit.js";

// POST /api/auth/sessions/revoke-all — logout everywhere.
//
// Body (optional): { "keepCurrent": true } spares the caller's own session, so
// an operator can evict every other device without signing themselves out. A
// missing or unparseable body is not an error — it means "kill everything",
// which is the safer reading of an ambiguous request.
//
// The count returned is what the store actually changed (`changes`), so an
// operator who revokes twice sees 0 the second time rather than a fiction.
export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {}; // an absent body is a valid "revoke everything"
    }
    const keepCurrent = body?.keepCurrent === true;

    const cookieStore = await cookies();
    const current = await getDashboardAuthSession(cookieStore.get(AUTH_COOKIE_NAME)?.value);
    const keepId = keepCurrent ? current?.jti || null : null;

    const revoked = await revokeAllAuthSessions({
      at: new Date().toISOString(),
      reason: "revoke_all",
      keepId,
    });

    await auditAuthEvent(AUTH_EVENTS.SESSIONS_REVOKED_ALL, {
      request,
      detail: { revoked, keptCurrent: Boolean(keepId) },
    });

    // If the caller's own session was among the dead, clear the jar with it.
    if (!keepId) clearDashboardAuthCookie(cookieStore);

    return NextResponse.json({ success: true, revoked, keptCurrent: Boolean(keepId) });
  } catch (error) {
    console.error("[auth/sessions] revoke-all failed:", error?.message || error);
    return NextResponse.json(
      { error: "Could not revoke the sessions. Check the server logs." },
      { status: 500 }
    );
  }
}
