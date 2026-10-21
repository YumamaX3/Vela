import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { fetchOidcDiscovery, getPublicOrigin, probeOidcClientSecret } from "@/lib/auth/oidc";
import { verifyDashboardAuthToken, AUTH_COOKIE_NAME } from "@/lib/auth/dashboardSession";
import { assertPublicUrl } from "@/shared/utils/ssrfGuard";

// SECURITY (SRV-1, CRITICAL): this route used to open under `requireLogin === false`
// with NO credential, then fetch a CALLER-SUPPLIED issuerUrl and POST the stored
// `oidcClientSecret` to whatever token_endpoint that URL's discovery document
// named — i.e. to an attacker's own host. Two distinct breaches in one handler:
// unauthenticated SSRF, and theft of the enterprise IdP client secret. The
// middleware already passes the whole /api/auth/oidc prefix (dashboardGuard
// PUBLIC_API_PATHS), so the route's own gate was the only thing standing
// between an anonymous caller and your IdP secret.
//
// The gate below is deliberately credential-first: testing an IdP connection is
// an operator action, never an anonymous one. The SSRF assert is defence in
// depth — a credentialed operator can still point at an internal host, which is
// exactly what assertPublicUrl forbids.
async function canAccessTestRoute() {
  const settings = await getSettings();

  // No anonymous access, in EITHER posture. The old `requireLogin === false →
  // return true` was the vulnerability.
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  return await verifyDashboardAuthToken(token);
}


export async function POST(request) {
  try {
    if (!(await canAccessTestRoute())) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const settings = await getSettings();

    const issuerUrl = String(body.issuerUrl || settings.oidcIssuerUrl || "").trim();
    const clientId = String(body.clientId || settings.oidcClientId || "").trim();
    const scopes = String(body.scopes || settings.oidcScopes || "openid profile email").trim() || "openid profile email";
    // SRV-1 leg 2 — the STORED client secret may only ever be probed against
    // the issuer the operator actually configured. Without this, any caller who
    // supplies their own `issuerUrl` gets the real IdP client secret POSTed to
    // THAT host's token_endpoint — the theft, even with a valid session.
    const configuredIssuer = String(settings.oidcIssuerUrl || "").trim();
    const probingConfiguredIssuer = issuerUrl === configuredIssuer;
    // Did the caller bring their own secret, or are we about to use the stored
    // one? Only the stored credential needs the configured-issuer guard below;
    // the caller-supplied path is the ordinary "test before you save" flow.
    const callerSuppliedSecret = Object.prototype.hasOwnProperty.call(body, "clientSecret");
    const usingStoredSecret = !callerSuppliedSecret;
    const clientSecret = String(
      callerSuppliedSecret
        ? body.clientSecret
        : probingConfiguredIssuer
          ? settings.oidcClientSecret || ""
          : ""
    ).trim();

    if (!issuerUrl) {
      return NextResponse.json({ error: "Issuer URL is required" }, { status: 400 });
    }
    if (!clientId) {
      return NextResponse.json({ error: "Client ID is required" }, { status: 400 });
    }

    // SRV-1 leg 1 — refuse internal / link-local / metadata targets outright.
    // The repo already owns this gate (ssrfGuard.assertPublicUrl) and uses it
    // two modules away; its absence here was an omission, not a policy.
    try {
      assertPublicUrl(issuerUrl);
    } catch {
      return NextResponse.json({ error: "Issuer URL must be a public https URL" }, { status: 400 });
    }

    // Refuse only when it is the OPERATOR'S STORED secret that would cross to a
    // host they did not configure — the theft. A caller-supplied secret probed
    // against a caller-supplied issuer is the normal "test before you save"
    // flow and must keep working; only the stored credential is protected here.
    if (usingStoredSecret && !probingConfiguredIssuer) {
      return NextResponse.json(
        { error: "Refusing to send the stored client secret to a non-configured issuer URL" },
        { status: 400 }
      );
    }

    const discovery = await fetchOidcDiscovery(issuerUrl);
    const redirectUri = `${getPublicOrigin(request)}/api/auth/oidc/callback`;
    const secretProbe = await probeOidcClientSecret({
      tokenEndpoint: discovery.token_endpoint,
      clientId,
      clientSecret,
      redirectUri,
    });

    if (secretProbe.tested && secretProbe.valid === false) {
      return NextResponse.json({
        ok: false,
        discoveryOk: true,
        clientSecretTested: true,
        clientSecretValid: false,
        issuerUrl,
        clientId,
        scopes,
        redirectUri,
        authorizationEndpoint: discovery.authorization_endpoint || "",
        tokenEndpoint: discovery.token_endpoint || "",
        jwksUri: discovery.jwks_uri || "",
        error: `Discovery loaded, but the client secret is not valid: ${secretProbe.message}`,
      });
    }

    return NextResponse.json({
      ok: true,
      discoveryOk: true,
      clientSecretTested: secretProbe.tested,
      clientSecretValid: secretProbe.valid,
      issuerUrl,
      clientId,
      scopes,
      redirectUri,
      authorizationEndpoint: discovery.authorization_endpoint || "",
      tokenEndpoint: discovery.token_endpoint || "",
      jwksUri: discovery.jwks_uri || "",
      message: secretProbe.message,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "OIDC test failed" }, { status: 500 });
  }
}
