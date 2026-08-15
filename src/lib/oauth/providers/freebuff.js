/**
 * Freebuff / Codebuff CLI login — fingerprint device flow (NOT OAuth2).
 *
 * Wire (captured from the official CLI, cross-checked against two prior-art
 * ports):
 *   1. POST https://freebuff.com/api/auth/cli/code { fingerprintId }
 *        → { fingerprintId, fingerprintHash, loginUrl, expiresAt }
 *   2. User opens loginUrl in a browser and signs in.
 *   3. Poll GET /api/auth/cli/status?fingerprintId=..&fingerprintHash=..&expiresAt=..
 *        every ~5s: 401 while pending, then 200 { user: { authToken, ... } }.
 *
 * There is NO token refresh — the authToken is static until it dies; mapTokens
 * returns refreshToken:null and no expiresIn/expiresAt (the route derives
 * expiresAt from expiresIn, and a leak would silently arm the refresh
 * machinery against a provider with no refresh endpoint).
 *
 * Security decisions (sealed plan gates):
 *  - loginUrl is hostname-validated against an allowlist BEFORE it reaches
 *    OAuthModal's window.open — a compromised login endpoint cannot hand the
 *    modal a phishing URL. Exact-host or dot-boundary suffix match, https only.
 *  - fingerprintId is PER-CONNECTION (random UUID), never machine-global:
 *    a shared machine hash across accounts is a multi-account detection signal
 *    for Codebuff, and one ban would taint every account sharing it. The
 *    composite device_code carries it through the browser round-trip so the
 *    persisted client_id always matches the login-time one.
 *  - The composite is ephemeral — never a long-term secret; pollToken
 *    validates its shape defensively before parsing.
 */
import crypto from "node:crypto";
import {
  FREEBUFF_LOGIN_URL,
  FREEBUFF_STATUS_URL,
  FREEBUFF_LOGIN_HOSTS,
} from "open-sse/config/freebuff.js";

const DEVICE_CLI_UA = "codebuff-cli/0.0.138";
const OAUTH_TIMEOUT_MS = 300000;

const freebuff = {
  config: {
    baseUrl: "https://freebuff.com",
    deviceCodeUrl: FREEBUFF_LOGIN_URL,
    statusUrl: FREEBUFF_STATUS_URL,
    oauthTimeoutMs: OAUTH_TIMEOUT_MS,
  },
  flowType: "device_code",

  requestDeviceCode: async (config) => {
    const fingerprintId = crypto.randomUUID();

    const response = await fetch(config.deviceCodeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": DEVICE_CLI_UA,
      },
      body: JSON.stringify({ fingerprintId }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Freebuff device code request failed (${response.status})${text ? `: ${text.slice(0, 160)}` : ""}`);
    }

    const data = await response.json().catch(() => ({}));
    const loginUrl = data?.loginUrl || data?.login_url;
    const fingerprintHash = data?.fingerprintHash;
    const rawExpiresAt = data?.expiresAt ?? data?.expires_at;

    if (!loginUrl || !fingerprintHash) {
      throw new Error("Freebuff device code response missing loginUrl or fingerprintHash");
    }

    // Hostname-allowlist gate — never let an upstream-supplied URL reach
    // window.open unvalidated (phishing surface).
    let parsed;
    try { parsed = new URL(loginUrl); } catch { throw new Error(`Freebuff returned an invalid loginUrl`); }
    const host = parsed.hostname.toLowerCase(); // punycode form
    const allowed = parsed.protocol === "https:" && (
      FREEBUFF_LOGIN_HOSTS.has(host) ||
      [...FREEBUFF_LOGIN_HOSTS].some((h) => host.endsWith(`.${h}`))
    );
    if (!allowed) {
      throw new Error(`Freebuff loginUrl host not allowed: ${host}`);
    }

    const expiresAtMs = typeof rawExpiresAt === "string"
      ? Date.parse(rawExpiresAt)
      : Number(rawExpiresAt);
    const expiresIn = Number.isFinite(expiresAtMs) && expiresAtMs > Date.now()
      ? Math.floor((expiresAtMs - Date.now()) / 1000)
      : Math.floor(OAUTH_TIMEOUT_MS / 1000);

    // Composite rides data.device_code untouched through the route + modal —
    // the extraData path is hardcoded per-provider in OAuthModal and would
    // need modal surgery; this contract needs none.
    return {
      device_code: `${fingerprintId}|${fingerprintHash}|${Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + OAUTH_TIMEOUT_MS}`,
      verification_uri: loginUrl,
      interval: 5,
      expires_in: expiresIn,
    };
  },

  pollToken: async (config, deviceCode) => {
    // Defensive shape validation before parsing — the composite transits the
    // browser (devtools/XSS surface); a malformed value must reject cleanly.
    const parts = typeof deviceCode === "string" ? deviceCode.split("|") : [];
    if (parts.length !== 3) {
      return { ok: false, data: { error: "invalid_device_code", error_description: "Malformed freebuff device code" } };
    }
    const [fingerprintId, fingerprintHash, expiresAtRaw] = parts;
    const expiresAt = Number(expiresAtRaw);
    if (!fingerprintId || !fingerprintHash || !Number.isFinite(expiresAt)) {
      return { ok: false, data: { error: "invalid_device_code", error_description: "Malformed freebuff device code" } };
    }
    if (expiresAt <= Date.now()) {
      return { ok: false, data: { error: "expired_token", error_description: "Freebuff login expired — start the login again" } };
    }

    const url = `${config.statusUrl}?fingerprintId=${encodeURIComponent(fingerprintId)}&fingerprintHash=${encodeURIComponent(fingerprintHash)}&expiresAt=${expiresAt}`;
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": DEVICE_CLI_UA },
    });

    // Upstream answers 401 while the user has not authorized yet.
    if (response.status === 401) {
      return { ok: true, data: { error: "authorization_pending" } };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, data: { error: "access_denied", error_description: `Freebuff login failed (${response.status})${text ? `: ${text.slice(0, 120)}` : ""}` } };
    }

    const data = await response.json().catch(() => ({}));
    const user = data?.user;
    if (!user?.authToken) {
      return { ok: true, data: { error: "authorization_pending" } };
    }

    // pollForToken success-gates on result.data.access_token — synthesize it.
    return {
      ok: true,
      data: {
        access_token: user.authToken,
        fingerprintId,
        fingerprintHash,
        email: user.email || null,
        name: user.name || null,
        userId: user.id || null,
      },
    };
  },

  mapTokens: (tokens) => ({
    accessToken: tokens.access_token,
    refreshToken: null,
    // NO expiresIn/expiresAt — the authToken has no refresh path. The route
    // derives expiresAt from expiresIn; emitting either would arm the refresh
    // machinery against a refresh-less provider (regression test covers this).
    email: tokens.email || undefined,
    displayName: tokens.name || undefined,
    providerSpecificData: {
      authMethod: "freebuff_cli",
      fingerprintId: tokens.fingerprintId || null,
      fingerprintHash: tokens.fingerprintHash || null,
      userId: tokens.userId || null,
    },
  }),
};

export default freebuff;
