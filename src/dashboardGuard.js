import { NextResponse } from "next/server";
import { getSettings, validateApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { verifyDashboardAuthToken, AUTH_COOKIE_NAME } from "@/lib/auth/dashboardSession";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";
import { timingSafeEqual } from "@/shared/utils/timingSafeEqual.js";

const CLI_TOKEN_HEADER = "x-vela-cli-token";
const CLI_TOKEN_SALT = "vela-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  // Constant-time compare (house pattern — SHA-256 digests, length-check-first).
  return timingSafeEqual(token, await getCliToken());
}

// Locality-before-credential (CLI Rebirth M0): the machine-derived CLI token
// proves proximity to the box, nothing more — it is honored ONLY from a local
// origin. Remote callers must present an API key or a JWT session instead.
async function hasLocalCliToken(request) {
  if (!isLocalRequest(request)) return false;
  return await hasValidCliToken(request);
}

// True when a non-local caller presents a machine token — every seam rejects
// that shape with 403 (forbidden), not 401 (unauthenticated).
function presentsRemoteCliToken(request) {
  return !isLocalRequest(request) && Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

// Public API paths — no auth required (LLM API has its own key auth inside handler).
const PUBLIC_API_PATHS = [
  "/api/health",
  "/api/init",
  "/api/locale",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/auth/oidc",
  "/api/auth/saml",
  "/api/version",
  "/api/settings/require-login",
];

// Public top-level prefixes (LLM API endpoints with their own API key auth).
const PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex"];

// Always require JWT token regardless of requireLogin setting
const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/version/shutdown",
  "/api/version/update",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  // Pricing Covenant: mutating endpoint that triggers server-side outbound fetches —
  // never public even when requireLogin is off. (It sits in ALWAYS_PROTECTED while the
  // wider /api/pricing/* prefix falls through to the deny-by-default /api/* branch
  // below; the overlap is intentional — only /sync must escalate above requireLogin.)
  "/api/pricing/sync",
  // Storage Covenant Wave B4 (S4): the backup surface — restore must NEVER ride
  // the deny-by-default /api/* branch that passes when requireLogin===false,
  // and the CLI-token bypass of /api/settings/database is NOT inherited.
  // Prefix match covers /api/backup/{status,run,list,restore,drill}.
  "/api/backup",
  // Usage Observatory W2-B (phase13): the streaming CSV export is an
  // unbounded-stream surface — it escalates above requireLogin=false like the
  // backup surface does (Gate-11 decision: only export escalates, reads stay
  // posture-consistent). The other /api/usage/metrics/* reads ride the
  // deny-by-default branch (JWT-or-requireLogin) by construction.
  "/api/usage/metrics/export",
  // Usage Observatory W4-A (sealed plan W4): the saved-view surface —
  // ALWAYS_PROTECTED write endpoint by the plan's own words. The guard is
  // method-agnostic, so the whole prefix (GET list included) requires JWT or
  // CLI token; the Needle UI fails open when the dashboard runs without login.
  "/api/usage/views",
];

// Require auth, but allow through if requireLogin is disabled.
//
// ⚠️ DEAD CODE REMOVED AT v0.9.45 (milestone 1, Security Closure). This list was
// consulted by `proxy()` until commit bb868085 ("deny-by-default API auth")
// replaced `if (PROTECTED_API_PATHS.some(...))` with the `pathname.startsWith("/api/")`
// branch below, leaving the 18-entry list defined but ORPHANED — never consulted,
// never exported, referenced only in comments (8 usage-route headers cited it as
// the live gating mechanism; those comments were corrected in the same commit).
// The live mechanism is the deny-by-default branch: any `/api/*` path not in
// PUBLIC_API_PATHS / PUBLIC_PREFIXES / ALWAYS_PROTECTED / LOCAL_ONLY_PATHS passes
// when `hasLocalCliToken(request) || isAuthenticated(request)`, and isAuthenticated
// returns TRUE whenever requireLogin===false. The posture this list once named is
// now that branch's behavior.
//
// §5.1's design ("remove /api/proxy-pools so it defaults to ALWAYS_PROTECTED")
// could not be implemented literally — there is no default-to-ALWAYS_PROTECTED, and
// removing from a dead list is a no-op. The Star's decree 2026-09-03 resolved it to
// the method-aware fail-closed block below (PROXY_POOLS_POSTURE_READS), scoped to
// /api/proxy-pools so every other route stays byte-identical.

// Security Closure (v0.9.45, milestone 1, §5.1) — the proxy-pools posture-read
// allow-list. Everything under /api/proxy-pools is FAIL-CLOSED by default (a
// mutation, or a read not named here, always requires a JWT or a local CLI token,
// regardless of requireLogin); ONLY these exact pathnames, and ONLY on GET, ride the
// posture-consistent deny-by-default branch below.
//
// The three entries carry every verified dashboard GET consumer (7 files):
//   GET /api/proxy-pools          — page.js:83 (?includeUsage), providers/[id]/page.js:303,
//                                   ConnectionsCard.js:313, ProviderLimits/index.js:457,
//                                   NoAuthProxyCard.js:26 (all ?isActive) — query strings are
//                                   not part of nextUrl.pathname, so one entry covers all five.
//   GET /api/proxy-pools/fitness  — page.js:73, FleetStatusPanel.jsx:16
//   GET /api/proxy-pools/export   — no consumer today (§15.4 lists it dead) but posture-consistent
//                                   by design, and it leaks the full pool set when wired.
//
// Why fail-closed and not "remove from a list": PROTECTED_API_PATHS (the mechanism
// §5.1 described) is dead code — see its removal note above. The deny-by-default branch
// passes the WHOLE prefix when requireLogin===false, including the three deploy routes
// that mint open forward-proxies and bulk-health with autoDisable. This block is the
// method-aware gate that branch cannot express.
//
// Coupling that must not be separated: this read-list is safe ONLY because redaction
// (§5.4) lands in the same release — GET /api/proxy-pools returns full pool objects
// today (proxyUrl carries credentials). The list and the masking ship together or not
// at all.
//
// A new GET read route under the prefix is over-protected → it 401s visibly in the UI
// until added here. Loud beats silent. (GET /api/proxy-pools/<id> is exactly that case:
// exported but unused by any consumer, so it fail-closes with no dashboard impact.)
const PROXY_POOLS_POSTURE_READS = new Set([
  "/api/proxy-pools",
  "/api/proxy-pools/fitness",
  "/api/proxy-pools/export",
]);

// Routes that spawn child processes or read host secrets — restrict to localhost.
const LOCAL_ONLY_PATHS = [
  "/api/cli-tools/cowork-settings",
  "/api/cli-tools/antigravity-mitm",
  "/api/mcp/",
  "/api/tunnel/tailscale-install",
  "/api/tunnel/tailscale-enable",
  "/api/tunnel/tailscale-disable",
  "/api/tunnel/tailscale-check",
  "/api/tunnel/enable",
  "/api/tunnel/disable",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/auth/reset-password",
  "/api/headroom/start",
  "/api/headroom/stop",
  "/api/headroom/proxy",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// Accepts a Host header, a URL hostname or a raw socket address. Splitting on the first
// colon only works for IPv4 and would reduce every IPv6 form to "", so a dual-stack
// listener handing back ::ffff:127.0.0.1 would not read as loopback.
function isLoopbackHostname(h) {
  if (!h) return false;
  let name = String(h).trim().toLowerCase();
  if (name.startsWith("[")) {
    const end = name.indexOf("]");
    if (end === -1) return false;
    name = name.slice(1, end);
  } else if (name.indexOf(":") !== -1 && name.indexOf(":") === name.lastIndexOf(":")) {
    name = name.slice(0, name.indexOf(":"));
  }
  if (name.startsWith("::ffff:")) name = name.slice(7);
  return LOOPBACK_HOSTS.has(name);
}

function isLoopbackPeer(request) {
  if (hasTrustedPeerHeaders(request)) {
    return isLoopbackHostname(request.headers.get("x-9r-real-ip"));
  }
  // Bare `next dev` forks its server, so the wrapper never loads and no peer address
  // reaches us. Host is spoofable, so this stays confined to development.
  if (process.env.NODE_ENV === "development") {
    return isLoopbackHostname(request.headers.get("host"));
  }
  return false;
}

export function isLocalRequest(request) {
  // Stamped by custom-server.js when forwarding headers exist: request came through
  // a reverse proxy, so the loopback socket is the proxy hop, not the end-user.
  if (request.headers.get("x-9r-via-proxy")) return false;
  if (!isLoopbackPeer(request)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) return false;
    } catch { return false; }
  }
  return true;
}

function isPublicLlmApi(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// Pure predicate behind §5.1's gate, extracted so a storm can assert the
// read-list/method matrix without standing up a request. A pathname under the
// prefix is a posture-consistent read ONLY on GET and ONLY if listed; everything
// else (any mutation, any unlisted read) is fail-closed.
function isProxyPoolsPostureRead(pathname, method) {
  if (!pathname.startsWith("/api/proxy-pools")) return false;
  return method === "GET" && PROXY_POOLS_POSTURE_READS.has(pathname);
}

function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader;
  const googleApiKeyHeader = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader;
  // ?key= is dead — keys in URLs leak into logs, history, and Referrer headers.
  return null;
}

async function hasValidApiKey(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

async function canAccessPublicLlmApi(request) {
  if (isLocalRequest(request)) return true;
  // Locality before credential: the machine token admits local callers only —
  // remote callers must present an API key.
  if (await hasLocalCliToken(request)) return true;
  return await hasValidApiKey(request);
}

async function canAccessLocalOnlyRoute(request) {
  // Locality before credential: the machine token admits local callers only.
  if (await hasLocalCliToken(request)) return true;
  // Browser on host: loopback Host + Origin (blocks tunnel/CSRF) + auth (JWT or requireLogin=false)
  if (isLocalRequest(request) && await isAuthenticated(request)) return true;
  return false;
}

async function hasValidToken(request) {
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  return await verifyDashboardAuthToken(token);
}

// Read settings directly from DB to avoid self-fetch deadlock in proxy
async function loadSettings() {
  try {
    return await getSettings();
  } catch {
    return null;
  }
}

async function isAuthenticated(request) {
  if (await hasValidToken(request)) return true;
  const settings = await loadSettings();
  if (settings && settings.requireLogin === false) return true;
  return false;
}

function isPublicApi(pathname) {
  if (isPublicLlmApi(pathname)) return true;
  return PUBLIC_API_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const __test__ = {
  isLocalRequest,
  isPublicLlmApi,
  extractApiKey,
  canAccessPublicLlmApi,
  canAccessLocalOnlyRoute,
  // §5.1 — the fail-closed gate's read/method predicate, exposed so the storm can
  // assert the matrix without a live request.
  isProxyPoolsPostureRead,
  PROXY_POOLS_POSTURE_READS,
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Local-only gate for spawn-capable / host-secret routes.
  if (LOCAL_ONLY_PATHS.some((p) => pathname.startsWith(p))) {
    if (!(await canAccessLocalOnlyRoute(request))) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
  }

  // Always protected - require valid JWT or LOCAL CLI token (machineId-based).
  // Locality before credential: the CLI-token admission requires locality; the
  // JWT branch is unchanged. A remote caller whose only credential is the
  // machine token is forbidden, not unauthenticated.
  if (ALWAYS_PROTECTED.some((p) => pathname.startsWith(p))) {
    if (await hasLocalCliToken(request) || await hasValidToken(request))
      return NextResponse.next();
    if (presentsRemoteCliToken(request))
      return NextResponse.json({ error: "Forbidden: CLI token is only accepted from local origins" }, { status: 403 });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isPublicLlmApi(pathname)) {
    // Keys arrive via Authorization: Bearer only. ?key= is rejected at the single
    // chokepoint with its own honest code (plan §3.4).
    if (request.nextUrl.searchParams?.has("key")) {
      return NextResponse.json(
        { error: { code: "query_param_key_rejected", message: "API keys in query parameters are not accepted. Use the Authorization: Bearer header." } },
        { status: 400 }
      );
    }
    if (await canAccessPublicLlmApi(request)) return NextResponse.next();
    // A remote caller whose only credential is the machine token is forbidden,
    // not merely unauthenticated — the token is local-bound.
    if (presentsRemoteCliToken(request))
      return NextResponse.json({ error: "Forbidden: CLI token is only accepted from local origins" }, { status: 403 });
    return NextResponse.json({ error: "API key required for remote API access" }, { status: 401 });
  }

  // Security Closure (§5.1) — proxy-pools fail-closed gate. Placed BEFORE the
  // deny-by-default /api/* branch so it wins for the whole prefix. Method-aware:
  // the guard is otherwise purely path-based, and this is the one place the ADR
  // required distinguishing a posture-consistent read from a mutation.
  if (pathname.startsWith("/api/proxy-pools")) {
    // Preflight carries no body and no action — passes unconditionally. The dashboard
    // is same-origin so a preflight never fires today; this is insurance for a
    // cross-origin caller and costs nothing.
    if (request.method === "OPTIONS") return NextResponse.next();

    const isPostureRead = isProxyPoolsPostureRead(pathname, request.method);

    if (!isPostureRead) {
      // Fail-closed: every mutation (POST/PUT/DELETE) and every unlisted read requires
      // a JWT or a LOCAL CLI token, regardless of requireLogin. This is what protects
      // the deploy routes that mint open forward-proxies and bulk-health's autoDisable
      // from being reachable unauthenticated under requireLogin=false.
      //
      // The third arm is the locality escape, and it is load-bearing. Without it this
      // gate 401s EVERY proxy-pools mutation for a first-run local user: README:133
      // documents entry with no password (requireLogin===false), and a browser on the
      // box carries neither a JWT cookie nor the machine-derived CLI header. Measured,
      // not theorised — a probe of the eleven surfaces under that exact posture showed
      // create / edit / toggle / test / delete / bulk-health / all three deploy routes
      // returning 401 while the page itself still rendered. The locality escape is the
      // same shape canAccessLocalOnlyRoute already uses for 15 spawn-capable routes, so
      // this is a house posture, not a new one.
      //
      // What stays closed: isLocalRequest is unspoofable — it needs the socket-derived
      // x-9r-real-ip proven by the per-process x-9r-peer-token AND a loopback Origin, so
      // a remote caller, a cross-origin page loaded on localhost, and a requireLogin=true
      // instance without a JWT all still fall through to 401/403 below.
      if (await hasLocalCliToken(request) || await hasValidToken(request)
          || (isLocalRequest(request) && await isAuthenticated(request)))
        return NextResponse.next();
      // Locality-before-credential (matches the ALWAYS_PROTECTED, public-LLM and
      // deny-by-default seams): a remote caller whose sole credential is the machine
      // token is FORBIDDEN (403), not merely unauthenticated (401). The Star's chosen
      // preview returned 401 here; I return 403 to keep this seam honest with the
      // house pattern — a machine token from a remote origin is a distinct, louder
      // failure than no credential. Deviation named, not silent.
      if (presentsRemoteCliToken(request))
        return NextResponse.json({ error: "Forbidden: CLI token is only accepted from local origins" }, { status: 403 });
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // Posture-consistent GET read → fall through to the deny-by-default branch, which
    // passes it under requireLogin===false exactly as the other dashboard reads are.
  }

  // Deny-by-default for /api/* — public allow-list bypasses, everything else requires auth.
  // Locality before credential: CLI-token admission requires locality; the
  // JWT/requireLogin posture (isAuthenticated) is unchanged. A remote caller
  // whose only credential is the machine token is forbidden, not unauthenticated.
  if (pathname.startsWith("/api/")) {
    if (isPublicApi(pathname)) return NextResponse.next();
    if (await hasLocalCliToken(request) || await isAuthenticated(request))
      return NextResponse.next();
    if (presentsRemoteCliToken(request))
      return NextResponse.json({ error: "Forbidden: CLI token is only accepted from local origins" }, { status: 403 });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    let requireLogin = true;
    let tunnelDashboardAccess = true;

    try {
      const settings = await loadSettings();
      if (settings) {
        requireLogin = settings.requireLogin !== false;
        tunnelDashboardAccess = settings.tunnelDashboardAccess === true;

        // Block tunnel/tailscale access if disabled (redirect to login)
        if (!tunnelDashboardAccess) {
          const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
          const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
          const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
          if ((tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost)) {
            return NextResponse.redirect(new URL("/login", request.url));
          }
        }
      }
    } catch {
      // On error, keep defaults (require login, block tunnel)
    }

    // If login not required, allow through
    if (!requireLogin) return NextResponse.next();

    // Verify JWT token
    const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    if (token) {
      if (await verifyDashboardAuthToken(token)) {
        return NextResponse.next();
      } else {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect / to /dashboard if logged in, or /dashboard if it's the root
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}
