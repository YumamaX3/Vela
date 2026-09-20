import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  clearDashboardAuthCookie,
  getDashboardAuthSession,
  AUTH_COOKIE_NAME,
} from "@/lib/auth/dashboardSession";
import { revokeAuthSession } from "@/lib/db/repos/authStoreRepo.js";
import { auditAuthEvent, AUTH_EVENTS } from "@/lib/auth/authAudit.js";

/**
 * POST /api/auth/logout
 *
 * Clearing a cookie is not a logout. The dashboard token is a stateless HS256
 * JWT with a 24h life, so dropping the jar leaves a replayable bearer alive
 * until it expires on its own — anyone who copied it keeps their seat.
 *
 * Auth Hardening W1 (migration 016) gives the token a name (`jti`) and this
 * route now spends it: the ledger row is marked revoked, and
 * verifyDashboardAuthToken's memoised revocation consult refuses the token from
 * the next request onward. Logout is the operator's kill switch, not a hint.
 *
 * FAIL-OPEN on the ledger write, deliberately. If the store is unreachable the
 * cookie is still cleared — a logout that half-worked beats a logout that
 * refused and left the operator still holding a live token in a browser.
 */
export async function POST(request) {
  const cookieStore = await cookies();
  const session = await getDashboardAuthSession(cookieStore.get(AUTH_COOKIE_NAME)?.value);

  if (session?.jti) {
    try {
      await revokeAuthSession(session.jti, {
        at: new Date().toISOString(),
        reason: "logout",
      });
      await auditAuthEvent(AUTH_EVENTS.SESSION_REVOKED, {
        request,
        detail: { sessionId: session.jti, reason: "logout" },
      });
    } catch (err) {
      // The cookie still goes: the caller asked to leave, and the ledger's
      // silence must not hold them here.
      console.error("[auth/logout] session revocation failed (fail-open):", err?.message || err);
    }
  }

  clearDashboardAuthCookie(cookieStore);
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
  return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
}
