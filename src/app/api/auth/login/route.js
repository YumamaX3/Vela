import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";
import {
  checkLock,
  recordFail,
  recordSuccess,
  getClientIp,
  consumeLoginAttempt,
} from "@/lib/auth/loginLimiter";
import { recordSession } from "@/lib/auth/sessionLedger.js";
import { auditAuthEvent, AUTH_EVENTS } from "@/lib/auth/authAudit.js";
import { isLocalRequest } from "@/dashboardGuard";
import { timingSafeEqual } from "@/shared/utils/timingSafeEqual.js";
import { NO_PASSWORD_REMOTE_MESSAGE } from "@/lib/auth/loginMessages.js";

const RESET_HINT = "Forgot password? Clear it via Vela CLI → Settings → Reset Password (clear), then enter from the local console and set a new one under Profile → Security.";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

// A device label is operator-authored text that lands in the ledger's `label`
// column and is read back on the session list. It is NOT an identity: it gates
// nothing, and the schema says so in as many words ("never trusted as
// identity"). Sanitised HERE because this is the trust boundary — the cap
// matches sessionLedger's own slice so the client cannot choose how much of the
// column it fills, and control characters are flattened because a label is one
// line.
const DEVICE_LABEL_MAX = 120;
function sanitizeDeviceLabel(raw) {
  if (typeof raw !== "string") return null;
  const flattened = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return flattened ? flattened.slice(0, DEVICE_LABEL_MAX) : null;
}

// Tag 3: with the default password retired, an unset-password local login has
// no credential at all. The dashboard must not brick for the operator at the
// console, so loopback requests pass through frictionless — exactly today's
// posture, minus the guessable password.
async function admitPasswordlessLoopback(request, ip, deviceLabel = null) {
  const cookieStore = await cookies();
  const minted = await setDashboardAuthCookie(cookieStore, request);
  await recordSession(minted, request, { ip, label: deviceLabel });
  await auditAuthEvent(AUTH_EVENTS.LOGIN_FRICTIONLESS, { request, ip, detail: { method: "frictionless" } });
  return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      await auditAuthEvent(AUTH_EVENTS.LOGIN_LOCKED, { request, ip, detail: { reason: "locked", retryAfter: lock.retryAfter } });
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s. ${RESET_HINT}`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter), ...NO_STORE_HEADERS } }
      );
    }

    // Fixed-window rate limit, independent of the failure ladder: bounds raw
    // attempt volume per IP even when individual attempts never touch a
    // password compare.
    const gate = consumeLoginAttempt(ip);
    if (!gate.allowed) {
      await auditAuthEvent(AUTH_EVENTS.LOGIN_RATE_LIMITED, { request, ip, detail: { reason: "rate_limited", retryAfter: gate.retryAfter } });
      return NextResponse.json(
        { error: `Too many login attempts. Try again in ${gate.retryAfter}s.`, retryAfter: gate.retryAfter },
        { status: 429, headers: { "Retry-After": String(gate.retryAfter), ...NO_STORE_HEADERS } }
      );
    }

    const { password, label } = await request.json();
    const deviceLabel = sanitizeDeviceLabel(label);
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      await auditAuthEvent(AUTH_EVENTS.LOGIN_BLOCKED, { request, ip, detail: { reason: "tunnel_dashboard_access_disabled" } });
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    const storedHash = settings.password;

    if (settings.authMode === "sso" || settings.authMode === "saml" || settings.authMode === "oidc") {
      const ssoType = settings.ssoType || (settings.authMode === "saml" ? "saml" : "oidc");
      if (ssoType === "saml" && isSamlConfigured(settings)) {
        await auditAuthEvent(AUTH_EVENTS.LOGIN_BLOCKED, { request, ip, detail: { reason: "password_login_disabled_saml" } });
        return NextResponse.json({ error: "Password login is disabled. Use SAML SSO sign in." }, { status: 403 });
      }
      if (ssoType === "oidc" && isOidcConfigured(settings)) {
        await auditAuthEvent(AUTH_EVENTS.LOGIN_BLOCKED, { request, ip, detail: { reason: "password_login_disabled_oidc" } });
        return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
      }
    }

    // Tag 3: NO password is configured anywhere (no stored hash, no
    // INITIAL_PASSWORD env). Loopback keeps the frictionless operator
    // posture; every non-loopback origin is refused — never falls open.
    if (!storedHash && !process.env.INITIAL_PASSWORD) {
      if (isLocalRequest(request)) return admitPasswordlessLoopback(request, ip, deviceLabel);
      await auditAuthEvent(AUTH_EVENTS.LOGIN_BLOCKED, { request, ip, detail: { reason: "no_password_configured_remote" } });
      return NextResponse.json(
        { error: NO_PASSWORD_REMOTE_MESSAGE },
        { status: 403, headers: NO_STORE_HEADERS }
      );
    }

    let isValid = false;
    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      // INITIAL_PASSWORD env fallback — constant-time compare (house pattern).
      isValid = timingSafeEqual(password, process.env.INITIAL_PASSWORD);
    }

    if (isValid) {
      recordSuccess(ip);

      const cookieStore = await cookies();
      const minted = await setDashboardAuthCookie(cookieStore, request);
      await recordSession(minted, request, { ip, label: deviceLabel });
      await auditAuthEvent(AUTH_EVENTS.LOGIN_OK, {
        request,
        ip,
        detail: { method: storedHash ? "password" : "initial_password", sessionId: minted?.jti || null },
      });

      return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
    }

    const { remainingBeforeLock } = recordFail(ip);
    await auditAuthEvent(AUTH_EVENTS.LOGIN_FAIL, { request, ip, detail: { reason: "invalid_password", remainingBeforeLock } });
    const postLock = checkLock(ip);
    if (postLock.locked) {
      await auditAuthEvent(AUTH_EVENTS.LOGIN_LOCKED, { request, ip, detail: { reason: "locked", retryAfter: postLock.retryAfter } });
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s. ${RESET_HINT}`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
        { status: 429, headers: { "Retry-After": String(postLock.retryAfter), ...NO_STORE_HEADERS } }
      );
    }
    return NextResponse.json(
      { error: `Invalid password. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
      { status: 401 }
    );
  } catch (error) {
    // Error-hygiene (Auth Hardening W1): /api/auth/login is a PUBLIC path, so an
    // internal error string echoed here would narrate its own shape — a DB or
    // crypto failure describing itself — to whoever probed the gate. The detail
    // goes to the log instead (consoleLogBuffer keeps it visible to the operator
    // on the dashboard's console-log page); the caller gets a stable line.
    console.error("[auth/login] unexpected failure:", error?.message || error);
    return NextResponse.json(
      { error: "Login failed. Check the server logs." },
      { status: 500 }
    );
  }
}
