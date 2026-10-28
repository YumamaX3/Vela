// CodeBuddy's four products — CodeBuddy and WorkBuddy, on two shores.
//
// The gateway is not one service. There are four:
//
//   cn-cli    CodeBuddy  (China)         copilot.tencent.com
//   cn-work   WorkBuddy  (China)         www.workbuddy.cn
//   intl-cli  CodeBuddy  (international) www.codebuddy.ai
//   intl-work WorkBuddy  (international) www.workbuddy.ai
//
// They share relative authentication paths and one credential SHAPE, but not one
// host — a token minted on the domestic shore is worthless on the international
// one, and a WorkBuddy account is not a CodeBuddy account. Routing every request
// to a single base URL therefore works right up until it silently does not.
//
// Carried from the reference gateway (codebuddy2api, app/site_routing.py), whose
// two laws are kept whole:
//
//   1. THE PROFILE COMES FROM THE CREDENTIAL, NEVER FROM INPUT. A domain or issuer
//      is only accepted when it names one of the known hosts; anything else — a
//      port, userinfo, a path, a query, a look-alike domain — is refused outright
//      rather than normalized into something routable.
//
//   2. JWT CLAIMS ARE HINTS, NOT AUTHORITY. The issuer is read to CHOOSE a shore;
//      the upstream still validates the signature and the account's permissions.
//      Two hints that disagree are a conflict, and a conflict is an error — never a
//      coin-flip between two hosts.

/** The four products, and the endpoint each speaks to. */
export const CODEBUDDY_PROFILES = Object.freeze({
  "cn-cli": "https://copilot.tencent.com",
  "cn-work": "https://www.workbuddy.cn",
  "intl-cli": "https://www.codebuddy.ai",
  "intl-work": "https://www.workbuddy.ai",
});

/** Known hosts, and the profile each answers for. */
export const CODEBUDDY_DOMAINS = Object.freeze({
  "www.codebuddy.cn": "cn-cli",
  "www.workbuddy.cn": "cn-work",
  "copilot.tencent.com": "cn-cli",
  "www.codebuddy.ai": "intl-cli",
  "www.workbuddy.ai": "intl-work",
});

/** The domain stored on a credential for each profile — refresh echoes it back. */
export const CODEBUDDY_PROFILE_DOMAINS = Object.freeze({
  "cn-cli": "www.codebuddy.cn",
  "cn-work": "www.workbuddy.cn",
  "intl-cli": "www.codebuddy.ai",
  "intl-work": "www.workbuddy.ai",
});

/** The relative path every product shares for a token refresh. */
export const CODEBUDDY_REFRESH_PATH = "/v2/plugin/auth/token/refresh";

export const CODEBUDDY_REGIONS = Object.freeze({ cn: "domestic", intl: "international" });

/** Thrown when a credential's hints disagree or name an unknown host. */
export class CodeBuddyRoutingError extends Error {
  constructor(message) {
    super(message);
    this.name = "CodeBuddyRoutingError";
  }
}

/** Which shore a profile belongs to. */
export function profileRegion(profile) {
  if (!Object.hasOwn(CODEBUDDY_PROFILES, profile)) {
    throw new CodeBuddyRoutingError(`Unknown CodeBuddy profile: ${profile}`);
  }
  return profile.startsWith("intl") ? CODEBUDDY_REGIONS.intl : CODEBUDDY_REGIONS.cn;
}

/** Which product a profile belongs to. */
export function profileProduct(profile) {
  profileRegion(profile);
  return profile.endsWith("-work") ? "workbuddy" : "cli";
}

/** The endpoint a profile speaks to. */
export function profileEndpoint(profile) {
  profileRegion(profile);
  return CODEBUDDY_PROFILES[profile];
}

/**
 * The chat door for a profile.
 *
 * All four products share the SAME relative path — `/v2/chat/completions` — and
 * differ only in host. Verified against the reference gateway's own chat URL
 * builder (site_routing.py: `PROFILE_ENDPOINTS[profile] + "/v2/chat/completions"`),
 * which is why the four profiles need a registry entry each and no per-profile
 * buildUrl override. The one genuine path divergence is the ANSI/console door,
 * and that is handled by channelCheck, not here.
 */
export function chatUrlForProfile(profile) {
  return `${profileEndpoint(profile)}/v2/chat/completions`;
}

/**
 * Accept a routing hint only when it names a known host on https, with no port,
 * no userinfo, no query and no fragment. A path is refused unless the caller says
 * the value is an issuer claim (which carries one).
 *
 * @param {string} value
 * @param {{issuer?: boolean}} [options]
 * @returns {string} the bare hostname
 */
export function normalizeDomain(value, { issuer = false } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    throw new CodeBuddyRoutingError("Invalid site hint");
  }
  // Control characters and URL delimiters mean this was never a hostname.
  if ([...value].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) {
    throw new CodeBuddyRoutingError("Invalid site hint");
  }
  const trimmed = value.trim();
  if (!trimmed || /[\\?#]/.test(trimmed)) {
    throw new CodeBuddyRoutingError("Invalid site hint");
  }

  let parsed;
  try {
    parsed = new URL(/:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new CodeBuddyRoutingError("Unsupported site hint");
  }

  const host = parsed.hostname;
  if (parsed.protocol !== "https:") throw new CodeBuddyRoutingError("Unsupported site hint");
  if (!Object.hasOwn(CODEBUDDY_DOMAINS, host)) throw new CodeBuddyRoutingError("Unsupported site hint");
  // `URL.host` omits userinfo, so a credential smuggled in as `user:pass@host` would
  // otherwise read as the bare host and be accepted. Refuse it explicitly.
  if (parsed.username || parsed.password) throw new CodeBuddyRoutingError("Unsupported site hint");
  // netloc must be the bare host: a port changes who is dialled.
  if (parsed.host !== host) throw new CodeBuddyRoutingError("Unsupported site hint");
  if (!issuer && parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new CodeBuddyRoutingError("Unsupported site hint");
  }
  return host;
}

/**
 * Read `iss` from a JWT without trusting it. Returns null for anything that is not
 * a well-formed three-part token with a JSON payload.
 */
export function tokenIssuer(token) {
  if (typeof token !== "string" || token.split(".").length !== 3) return null;
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === "object" && typeof claims.iss === "string" ? claims.iss : null;
  } catch {
    return null;
  }
}

/**
 * The hints a credential carries: its stored domain and its token's issuer.
 * Either may be absent; each must be valid if present.
 */
export function credentialHints(auth = {}) {
  const domain = auth.domain ? normalizeDomain(auth.domain) : null;
  const issuerClaim = tokenIssuer(auth.accessToken);
  const issuer = issuerClaim ? normalizeDomain(issuerClaim, { issuer: true }) : null;
  return { domain, issuer };
}

/**
 * Which shore a credential belongs to.
 *
 * Defaults to domestic when no hint survives; two hints naming different shores
 * raise rather than pick one.
 */
export function siteForCredential(auth = {}) {
  const { domain, issuer } = credentialHints(auth);
  const sites = new Set(
    [domain, issuer].filter(Boolean).map((host) => profileRegion(CODEBUDDY_DOMAINS[host])),
  );
  if (sites.size > 1) throw new CodeBuddyRoutingError("Conflicting credential sites");
  return sites.size === 1 ? [...sites][0] : CODEBUDDY_REGIONS.cn;
}

/**
 * Which of the four products a credential belongs to.
 *
 * `copilot.tencent.com` is deliberately excluded from the branding test: it is the
 * SHARED domestic endpoint, so it cannot tell CodeBuddy from WorkBuddy. The branded
 * hosts can.
 */
export function profileForCredential(auth = {}) {
  siteForCredential(auth);
  const { domain, issuer } = credentialHints(auth);
  const branded = [domain, issuer].filter((host) => host && host !== "copilot.tencent.com");
  const profiles = new Set(branded.map((host) => CODEBUDDY_DOMAINS[host]));
  if (profiles.size > 1) throw new CodeBuddyRoutingError("Conflicting credential products");
  return profiles.size === 1 ? [...profiles][0] : "cn-cli";
}

/** The domain a credential should store for its product. */
export function domainForCredential(auth = {}) {
  profileForCredential(auth);
  const { domain, issuer } = credentialHints(auth);
  return domain || issuer || "www.codebuddy.cn";
}
