/**
 * Callback host derivation — "back into what Vela got accessed."
 *
 * The dashboard-login flows (OIDC/SAML) already derive their origin from the
 * request; the provider-connection OAuth flow used to hardcode
 * `http://localhost:PORT/callback`, so accessing Vela from a LAN IP
 * (http://192.168.1.20:32060), a Tailscale hostname, or any other shore
 * sent Google & friends back to the OPERATOR'S own machine instead of the
 * dashboard they were looking at. These helpers derive the callback base URL
 * from the actual access point — localhost stays localhost, LAN IP stays
 * LAN IP, hostname stays hostname.
 */

function trimTrailingSlashes(value) {
  return (value || "").replace(/\/+$/, "");
}

/**
 * Server-side: derive the public origin of an incoming request.
 *
 * Priority:
 *   1. The request's own host header — the exact URL the operator used to
 *      reach this dashboard. x-forwarded-host/proto are honored ONLY when
 *      the peer is loopback (custom-server.js stamps x-9r-real-ip from the
 *      TCP socket and strips client-supplied forwarding headers from
 *      non-loopback peers), so a remote client cannot forge the callback
 *      target with a spoofed forwarded header.
 *   2. BASE_URL env override — for exotic deployments where the Host header
 *      is rewritten by an upstream proxy.
 *   3. The request URL's own origin.
 *
 * @param {Request|{headers?: Headers, url?: string}} request
 * @returns {string} origin without trailing slash, e.g. "http://192.168.1.20:32060"
 */
export function getCallbackOrigin(request) {
  try {
    const host = request?.headers?.get?.("host") || "";
    if (host) {
      const realIp = request.headers.get("x-9r-real-ip") || "";
      const peerIsLoopback =
        realIp === "127.0.0.1" || realIp === "::1" || realIp.startsWith("::ffff:127.");
      const forwardedHost = request.headers.get("x-forwarded-host") || "";
      if (peerIsLoopback && forwardedHost) {
        const urlProto = request.url ? new URL(request.url).protocol.replace(/:$/, "") : "";
        const proto = request.headers.get("x-forwarded-proto") || urlProto || "http";
        return trimTrailingSlashes(`${proto}://${forwardedHost}`);
      }
      const proto = request.url ? new URL(request.url).protocol.replace(/:$/, "") : "";
      return trimTrailingSlashes(`${proto || "http"}://${host}`);
    }
    const configured = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
    if (configured) return trimTrailingSlashes(configured);
    if (request?.url) return trimTrailingSlashes(new URL(request.url).origin);
  } catch {
    // fall through to the default below
  }
  return "http://localhost:32060";
}

/**
 * Client-side: the origin the operator is browsing the dashboard on.
 * localhost stays localhost; 192.168.1.20 stays 192.168.1.20; hostnames stay.
 * @returns {string} e.g. "http://192.168.1.20:32060"
 */
export function getBrowserCallbackOrigin() {
  if (typeof window === "undefined") return "http://localhost:32060";
  return trimTrailingSlashes(window.location.origin);
}
