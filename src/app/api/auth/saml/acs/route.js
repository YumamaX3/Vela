import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import {
  getSamlBaseUrl,
  isSamlConfigured,
  pickSamlDisplayName,
  pickSamlEmail,
  validateSamlResponse,
} from "@/lib/auth/saml.js";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { recordSession } from "@/lib/auth/sessionLedger.js";
import { auditAuthEvent, AUTH_EVENTS } from "@/lib/auth/authAudit.js";

export async function POST(request) {
  const settings = await getSettings();
  const origin = getSamlBaseUrl(request, settings);
  const ip = getClientIp(request);

  const lock = checkLock(ip);
  if (lock.locked) {
    await auditAuthEvent(AUTH_EVENTS.LOGIN_LOCKED, { request, ip, detail: { reason: "locked", retryAfter: lock.retryAfter, method: "saml" } });
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(`Too many failed attempts. Try again in ${lock.retryAfter}s.`)}`,
        origin
      )
    );
  }

  const cookieStore = await cookies();
  const storedRequestId = cookieStore.get("saml_state")?.value || "";

  // Always clear saml_state cookie after attempt
  cookieStore.delete("saml_state");

  try {
    const formData = await request.formData();
    const SAMLResponse = formData.get("SAMLResponse");

    if (!SAMLResponse) {
      recordFail(ip);
      await auditAuthEvent(AUTH_EVENTS.LOGIN_FAIL, { request, ip, detail: { reason: "saml_missing_response" } });
      return NextResponse.redirect(new URL("/login?error=saml_missing_response", origin));
    }

    if (!isSamlConfigured(settings)) {
      recordFail(ip);
      await auditAuthEvent(AUTH_EVENTS.LOGIN_FAIL, { request, ip, detail: { reason: "saml_not_configured" } });
      return NextResponse.redirect(new URL("/login?error=saml_not_configured", origin));
    }

    const profile = await validateSamlResponse(request, { SAMLResponse }, storedRequestId, settings);

    const samlEmail = pickSamlEmail(profile, settings) || null;
    const samlName = pickSamlDisplayName(profile, settings) || "SAML user";

    recordSuccess(ip);

    const minted = await setDashboardAuthCookie(cookieStore, request, {
      saml: true,
      samlEmail,
      samlName,
    });
    await recordSession(minted, request, { ip, label: samlEmail || samlName || "SAML SSO" });
    await auditAuthEvent(AUTH_EVENTS.LOGIN_OK, { request, ip, detail: { method: "saml", sessionId: minted?.jti || null } });

    return NextResponse.redirect(new URL("/dashboard", origin));
  } catch (error) {
    recordFail(ip);
    await auditAuthEvent(AUTH_EVENTS.LOGIN_FAIL, { request, ip, detail: { reason: "saml_acs_failed" } });
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message || "saml_acs_failed")}`, origin)
    );
  }
}
