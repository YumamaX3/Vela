// Storage Covenant Wave B4 — S4 route auth for /api/backup/*.
// Plan line 492-497: dashboardGuard's ALWAYS_PROTECTED (JWT) is the first
// layer; mutating routes (run/restore/drill) additionally require password
// re-confirm via verifyDashboardPassword, WRAPPED IN LOCKOUT ACCOUNTING (the
// login limiter was previously unthrottled on this path — brute-force surface).
// The CLI-token bypass of /api/settings/database is NOT inherited here.
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";

/** Verify password re-confirm with lockout accounting.
 *  @returns null when OK, or a NextResponse-ready {status, body} to return. */
export async function verifyBackupPassword(request, password) {
  const ip = getClientIp(request);
  const lock = checkLock(ip);
  if (lock.locked) {
    return {
      status: 429,
      body: { error: `Too many attempts — retry after ${lock.retryAfter}s` },
    };
  }
  const ok = await verifyDashboardPassword(password);
  if (!ok) {
    recordFail(ip);
    return { status: 401, body: { error: "Invalid password" } };
  }
  recordSuccess(ip);
  return null;
}
