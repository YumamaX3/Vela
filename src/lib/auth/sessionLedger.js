/**
 * sessionLedger — one writer for the dashboard session ledger (Auth Hardening W1,
 * migration 016).
 *
 * Three routes mint sessions: the password login, the SAML ACS, and the OIDC
 * callback. A row written by three separate hands would be three dialects, so
 * the write lives here once.
 *
 * WHY THE ROW EXISTS AT ALL: the dashboard JWT is stateless (HS256, 24h). A
 * stateless token cannot be listed and cannot be killed. Recording the token's
 * own `jti` is what makes /api/auth/sessions able to show a live session and
 * DELETE able to end it.
 *
 * FAIL-OPEN, ALWAYS. A ledger write must never fail a login that already
 * succeeded — the cookie is set either way. A missing row costs the operator
 * exactly one thing: the ability to revoke that particular session.
 */
import { insertAuthSession } from "@/lib/db/repos/authStoreRepo.js";
import { getClientIp } from "./loginLimiter.js";

function safeClientIp(request) {
  try {
    return getClientIp(request);
  } catch {
    return null;
  }
}

/**
 * Record the ledger row for a session that was just minted.
 *
 * @param {{jti?: string, expiresAt?: string}|undefined} minted the object
 *   setDashboardAuthCookie() returns.
 * @param {Request} request the incoming request (for ip + user agent).
 * @param {{ip?: string|null, label?: string|null}} [opts]
 * @returns {Promise<boolean>} true when a row landed.
 */
export async function recordSession(minted, request, { ip = null, label = null } = {}) {
  // No identity handed back means no session was minted (a no-op cookie setter),
  // so there is nothing to record and no harbor to touch.
  if (!minted?.jti) return false;
  try {
    const now = new Date().toISOString();
    await insertAuthSession({
      id: minted.jti,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: minted.expiresAt,
      ip: ip ?? safeClientIp(request),
      // Truncated on the ledger's own terms: a User-Agent header is
      // attacker-controlled and unbounded.
      userAgent: (request?.headers?.get?.("user-agent") || "").slice(0, 255) || null,
      label: label ? String(label).slice(0, 120) : null,
    });
    return true;
  } catch (err) {
    // The store's failure is the operator's to see; the login is not the place
    // to surface it (the caller's credential was valid).
    console.error("[sessionLedger] ledger write failed (fail-open):", err?.message || err);
    return false;
  }
}

export default recordSession;
