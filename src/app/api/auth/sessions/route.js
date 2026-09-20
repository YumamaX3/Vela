import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession, AUTH_COOKIE_NAME } from "@/lib/auth/dashboardSession";
import { listAuthSessions, pruneAuthSessions } from "@/lib/db/repos/authStoreRepo.js";

// GET /api/auth/sessions — every session the ledger holds, the caller's own
// flagged.
//
// This route is NOT reachable by an unauthenticated caller: "/api/auth/sessions"
// sits in ALWAYS_PROTECTED (dashboardGuard.js), so it requires a JWT or the local
// CLI token even when requireLogin is false. A list of live sessions is
// reconnaissance; it never rides the deny-by-default branch.
//
// Revoked rows are shown rather than hidden — the `revokedAt` is the honest
// record of a kill, and a vanished row would read as "never existed".
export async function GET() {
  try {
    const cookieStore = await cookies();
    const current = await getDashboardAuthSession(cookieStore.get(AUTH_COOKIE_NAME)?.value);
    const currentId = current?.jti || null;

    // Housekeeping on the read path: drop rows that can no longer authenticate
    // anyone, so the list stays honest and the table stays bounded.
    await pruneAuthSessions(new Date().toISOString());

    const rows = await listAuthSessions();
    const now = Date.now();
    return NextResponse.json({
      sessions: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        expiresAt: row.expiresAt,
        ip: row.ip,
        userAgent: row.userAgent,
        label: row.label,
        revokedAt: row.revokedAt,
        revokedReason: row.revokedReason,
        current: row.id === currentId,
        expired: row.expiresAt ? Date.parse(row.expiresAt) <= now : false,
      })),
      currentId,
    });
  } catch (error) {
    // Error-hygiene: the detail goes to the log, the caller gets a stable line.
    console.error("[auth/sessions] list failed:", error?.message || error);
    return NextResponse.json(
      { error: "Could not read the session ledger. Check the server logs." },
      { status: 500 }
    );
  }
}
