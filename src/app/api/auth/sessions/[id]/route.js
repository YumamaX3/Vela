import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  getDashboardAuthSession,
  clearDashboardAuthCookie,
  AUTH_COOKIE_NAME,
} from "@/lib/auth/dashboardSession";
import { revokeAuthSession, getAuthSession } from "@/lib/db/repos/authStoreRepo.js";
import { auditAuthEvent, AUTH_EVENTS } from "@/lib/auth/authAudit.js";

// DELETE /api/auth/sessions/[id] — kill one session by its jti.
//
// Two honest outcomes, and the difference matters to the caller:
//   • a fresh kill   → { success: true }                (+ audit: session.revoked)
//   • an already-dead session → { success: true, alreadyRevoked: true } — an
//     idempotent no-op, never counted as a second revocation.
// An unknown id is a 404; it is not silently reported as killed.
//
// Revoking your OWN session clears the cookie too: leaving the browser holding
// a token that can only fail would be a dead jar, the same wound ADR-004 fixed
// for expiry.
//
// The revocation itself is bounded by the verifier's memo TTL (see
// dashboardSession.js) — a killed session dies within that window, not
// instantly, and the plan says so rather than pretending otherwise.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: "Session id is required" }, { status: 400 });
    }

    const cookieStore = await cookies();
    const current = await getDashboardAuthSession(cookieStore.get(AUTH_COOKIE_NAME)?.value);
    const isCurrent = Boolean(current?.jti && current.jti === id);

    const revoked = await revokeAuthSession(id, {
      at: new Date().toISOString(),
      reason: "operator_revoked",
    });

    if (!revoked) {
      const existing = await getAuthSession(id);
      if (!existing) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      if (isCurrent) clearDashboardAuthCookie(cookieStore);
      return NextResponse.json({ success: true, alreadyRevoked: true, current: isCurrent });
    }

    await auditAuthEvent(AUTH_EVENTS.SESSION_REVOKED, {
      request,
      detail: { sessionId: id, current: isCurrent, reason: "operator_revoked" },
    });

    if (isCurrent) clearDashboardAuthCookie(cookieStore);

    return NextResponse.json({ success: true, current: isCurrent });
  } catch (error) {
    console.error("[auth/sessions] revoke failed:", error?.message || error);
    return NextResponse.json(
      { error: "Could not revoke the session. Check the server logs." },
      { status: 500 }
    );
  }
}
