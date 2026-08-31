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

// Tag 3: with the default password retired, an unset-password local login has
// no credential at all. The dashboard must not brick for the operator at the
// console, so loopback requests pass through frictionless — exactly today's
// posture, minus the guessable password.
async function admitPasswordlessLoopback(request) {
  const cookieStore = await cookies();
  await setDashboardAuthCookie(cookieStore, request);
  return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
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
      return NextResponse.json(
        { error: `Too many login attempts. Try again in ${gate.retryAfter}s.`, retryAfter: gate.retryAfter },
        { status: 429, headers: { "Retry-After": String(gate.retryAfter), ...NO_STORE_HEADERS } }
      );
    }

    const { password } = await request.json();
    const settings = await getSettings();

    // Block login via tunnel/tailscale if dashboard access is disabled
    if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    const storedHash = settings.password;

    if (settings.authMode === "sso" || settings.authMode === "saml" || settings.authMode === "oidc") {
      const ssoType = settings.ssoType || (settings.authMode === "saml" ? "saml" : "oidc");
      if (ssoType === "saml" && isSamlConfigured(settings)) {
        return NextResponse.json({ error: "Password login is disabled. Use SAML SSO sign in." }, { status: 403 });
      }
      if (ssoType === "oidc" && isOidcConfigured(settings)) {
        return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
      }
    }

    // Tag 3: NO password is configured anywhere (no stored hash, no
    // INITIAL_PASSWORD env). Loopback keeps the frictionless operator
    // posture; every non-loopback origin is refused — never falls open.
    if (!storedHash && !process.env.INITIAL_PASSWORD) {
      if (isLocalRequest(request)) return admitPasswordlessLoopback(request);
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
      await setDashboardAuthCookie(cookieStore, request);

      return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
    }

    const { remainingBeforeLock } = recordFail(ip);
    const postLock = checkLock(ip);
    if (postLock.locked) {
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
