// Storage Covenant Wave B2 / Proxy Fleet Rebirth milestone 1 (§5.2) —
// the relay template. ONE home for the relay's security logic.
//
// WHY THIS MODULE EXISTS
// Before §5.2 the relay body was three inline string copies — vercel-deploy:13-45,
// cloudflare-deploy:10-52, deno-deploy:11-50 — and all three deployed an OPEN
// FORWARD PROXY: they read x-relay-target, refused only when it was absent, and
// forwarded every header to whatever host the caller named. No secret, no
// allow-list. The relay has a production caller (open-sse/utils/proxyFetch.js:353),
// so this was live traffic, not a dead surface.
//
// LIVE-B's lesson is that a duplicated guard drifts: bulk-health kept its own
// pre-v0.9.42 loop and diverged from the repaired checkAllPools. Three copies of
// an authentication check would drift the same way — one platform patched, two
// left open, and nothing in the tests would notice. So the security logic is
// written ONCE here and rendered into three platform dialects.
//
// WHAT THE GENERATED RELAY DOES, IN ORDER
//   1. Verify x-relay-auth against the platform secret — BEFORE anything else,
//      so an unauthenticated caller always sees 401 and learns nothing about what
//      the relay expects. Fails CLOSED: a relay whose secret did not land refuses
//      every request rather than forwarding open.
//   2. Require x-relay-target.
//   3. Refuse any target host not on the deploy-baked allow-list (403).
//   4. Strip x-relay-auth, x-relay-target, x-relay-path, host, and the whole
//      x-9r-* family before forwarding.
//   5. Forward. `Authorization` is deliberately PRESERVED — it belongs to the
//      provider, which is exactly why this header is x-relay-auth and not
//      Authorization.
//
// THE x-9r-* STRIP IS A PREFIX DENY-LIST, NOT AN ENUMERATION
// Five members exist in source today (real-ip, peer-token, via-proxy, password,
// internal-models-fetch) and the constitution forbids renaming them. But the
// custom server's stamping protocol may grow a member, and a relay that enumerated
// five names would forward the sixth. Prefix matching cannot be outgrown.
//
// WHY THE COMPARISON HASHES
// Web Crypto has no timingSafeEqual. Both sides are SHA-256'd and the digests
// compared, which removes the length/prefix short-circuit a plain `===` on
// unequal strings has. `crypto.subtle` is safe HERE and unsafe in the dashboard:
// these relays are deployed to HTTPS-only platforms, while the dashboard is
// documented to run on plain-http LAN origins (docker-compose.example.yml:73/:94),
// which is why proxyRedaction.js refuses to depend on it.
/** Relay protocol version. The caller sends x-relay-auth ONLY when a pool row
 *  carries relayVersion >= 2 — see §5.2's transition hazard. */
export const RELAY_VERSION = 2;

/** Env var name the secret is delivered under on all three platforms.
 *  Chosen to satisfy Deno's forbidden prefixes (DENO_*, LD_*, OTEL_*) and its
 *  reserved cloud-credential names. */
export const RELAY_AUTH_ENV = "VELA_RELAY_AUTH";

/** The health probe's target host. proxyTest.js:10-11 probes every relay against
 *  `https://httpbin.org/get`, so a deploy-baked allow-list that omits this host makes
 *  the relay answer the fleet's own health sweep with 403.
 *
 *  THE CONSEQUENCE, MEASURED NOT ASSUMED. 403 is not in
 *  DETERMINISTIC_FAILURE_STATUSES (proxyTest.js:199 — {400,404,410}), so
 *  classifyProbeVerdict returns "indeterminate", and checkAllPools auto-disables
 *  ONLY on "dead" (proxyFleet.js:796). So an omitted probe host does NOT
 *  self-liquidate the pool — the failure is quieter and still real: the pool can
 *  never read "alive" in the sweep, forever, and the operator watches a healthy
 *  relay sit permanently unconfirmed with no error explaining why. The same
 *  permanent-indeterminate symptom is what §5.2e exists to prevent on the auth side
 *  (a probe with no x-relay-auth gets 401, which is also not deterministic).
 *
 *  So this host is not optional — it is what makes a v2 relay able to prove it is
 *  alive at all. */
export const PROBE_HOST = "httpbin.org";

/**
 * The relay's shared core, rendered identically into all three platforms.
 *
 * Written with NO template literals and NO `${` so that embedding it in a JS
 * template string here cannot collide with the host module's interpolation — the
 * only escape needed is `\\/$` for the trailing-slash regex, matching the three
 * inline copies it replaces. The allow-list is injected by replacing the
 * `__ALLOWED_HOSTS__` sentinel with a JSON.stringify'd array, which is always a
 * valid JS array literal.
 */
const RELAY_CORE = `
var RELAY_VERSION = 2;
var ALLOWED_HOSTS = __ALLOWED_HOSTS__;

function jsonReply(status, body) {
  return new Response(JSON.stringify(body), {
    status: status,
    headers: { "content-type": "application/json" },
  });
}

function isAllowedTarget(target) {
  var parsed;
  try { parsed = new URL(target); } catch (e) { return false; }
  // Scheme is checked even under the wildcard. A relay is an HTTP forwarder; a
  // target like file:// or gopher:// is never legitimate, and on an edge runtime
  // it would surface as an opaque fetch failure rather than a refusal. Checking
  // here keeps the operator's "*" opt-in from also opting into non-HTTP schemes.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  // "*" is the ADR's explicit operator escape hatch. It is baked into the source
  // (so it is visible in the deployed artifact), logged at deploy, and surfaced in
  // the deploy response — never a silent default.
  if (ALLOWED_HOSTS.indexOf("*") !== -1) return true;
  var host = parsed.hostname;
  return !!host && ALLOWED_HOSTS.indexOf(host) !== -1;
}

async function sha256hex(text) {
  var bytes = new TextEncoder().encode(text);
  var digest = await crypto.subtle.digest("SHA-256", bytes);
  var view = new Uint8Array(digest);
  var out = "";
  for (var i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
  return out;
}

// Fails CLOSED. An absent or empty secret refuses everything: a relay whose
// platform secret did not land must never silently become an open proxy again.
//
// Both sides are trimmed, and the asymmetry is the reason. A header value is
// OWS-trimmed by the Headers API itself on all three runtimes (measured: setting
// "TOKEN " and getting it back yields "TOKEN"), but the expected side arrives from
// a platform environment variable, which is NOT trimmed. An operator who pastes a
// secret with a trailing newline therefore gets a relay that 401s every single
// request — after the dashboard reported a successful deploy, with no diagnostic
// anywhere. Trimming both sides makes that paste harmless.
async function isAuthorized(expected, provided) {
  if (!expected || !provided) return false;
  var a = await sha256hex(String(expected).trim());
  var b = await sha256hex(String(provided).trim());
  return a === b;
}

function forwardHeaders(incoming) {
  var headers = new Headers(incoming);
  headers.delete("x-relay-auth");
  headers.delete("x-relay-target");
  headers.delete("x-relay-path");
  headers.delete("host");
  // Prefix deny-list: collect first, delete second — mutating a Headers iterator
  // mid-walk is not safe on any of the three runtimes.
  var doomed = [];
  headers.forEach(function (value, key) {
    if (key.toLowerCase().indexOf("x-9r-") === 0) doomed.push(key);
  });
  for (var i = 0; i < doomed.length; i++) headers.delete(doomed[i]);
  return headers;
}

async function relayRequest(incoming, secret) {
  // Auth FIRST. An unauthenticated caller gets 401 whatever else it sent, so the
  // relay never tells a stranger whether it wanted a target header or which hosts
  // it would have accepted.
  if (!(await isAuthorized(secret, incoming.headers.get("x-relay-auth")))) {
    return jsonReply(401, { error: "Unauthorized" });
  }

  var target = incoming.headers.get("x-relay-target");
  if (!target) return jsonReply(400, { error: "Missing x-relay-target header" });

  // The 403 never echoes the target back — reflecting attacker-supplied input
  // into a response body is how a probe learns what the allow-list contains.
  if (!isAllowedTarget(target)) {
    return jsonReply(403, { error: "Target host is not permitted by this relay" });
  }

  var relayPath = incoming.headers.get("x-relay-path") || "/";
  var targetUrl = target.replace(/\\/$/, "") + relayPath;

  var init = { method: incoming.method, headers: forwardHeaders(incoming.headers) };
  if (incoming.method !== "GET" && incoming.method !== "HEAD") {
    init.body = incoming.body;
    init.duplex = "half";
  }

  try {
    var response = await fetch(targetUrl, init);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    return jsonReply(502, { error: error.message });
  }
}
`;

/**
 * Render the relay source for one platform.
 *
 * Each wrapper owns its own env-access idiom, and each reads the secret through a
 * try/catch that yields "" on failure — so a platform where the variable did not
 * land produces a clean fail-closed 401 instead of a ReferenceError 500.
 *
 * @param {"vercel"|"cloudflare"|"deno"} platform
 * @param {string[]} allowedHosts baked into the source at deploy time
 */
/**
 * The caller side of the relay protocol.
 *
 * ONE home for both halves on purpose: `RELAY_VERSION` above describes what the
 * deployed relay understands, and this describes what a caller may send it. Keeping
 * them in one module is what makes the version gate below unable to drift — a caller
 * that bumped its own literal `2` while the template stayed at 1 (or vice versa)
 * would either break every relay or leak the secret to every v1 relay, and nothing
 * in the tests would connect the two numbers.
 *
 * THE GATE IS LOAD-BEARING. `relayVersion >= 2` is not a formality:
 *
 *   • Every relay deployed before §5.2 is v1. Its body read x-relay-target, refused
 *     only when it was absent, and forwarded EVERY header to whatever host the
 *     caller named. A v1 relay given an x-relay-auth header forwards that secret to
 *     the upstream provider — api.openai.com, and every other host in the
 *     allow-list — as an ordinary request header. That is not a failed auth; it is
 *     credential disclosure to a third party.
 *   • Pool rows created before §5.2 have no relayVersion column value at all. The
 *     repo defaults it to 1 (sqlite/proxyPoolsRepo.js:93, mysql twin :83) precisely
 *     so this gate reads them as v1.
 *
 * So a caller MUST send nothing when the version is not provably >= 2. The fail
 * direction is deliberate: an unrecognised version sends no secret (the relay 401s
 * or forwards openly, both survivable) rather than sending one to a relay that will
 * pass it on.
 *
 * @param {object|null} proxyOptions the unified payload from connectionProxy.js
 * @returns {Record<string,string>} `{}` when no secret may be sent, else the header
 */
export function relayAuthHeaders(proxyOptions) {
  const token = typeof proxyOptions?.relayAuth === "string" ? proxyOptions.relayAuth.trim() : "";
  if (!token) return {};

  const version = Number(proxyOptions?.relayVersion) || 1;
  if (!(version >= RELAY_VERSION)) return {};

  return { "x-relay-auth": token };
}

export function renderRelaySource(platform, allowedHosts) {
  if (!RELAY_CORE.includes("__ALLOWED_HOSTS__")) {
    // A refactor that drops the sentinel would silently deploy a relay with the
    // literal string in it, matching no host — fail closed, but unexplained.
    throw new Error("relay template lost its __ALLOWED_HOSTS__ sentinel");
  }
  const hosts = Array.isArray(allowedHosts) ? [...new Set(allowedHosts)].sort() : [];
  const core = RELAY_CORE.replace("__ALLOWED_HOSTS__", JSON.stringify(hosts));

  if (platform === "vercel") {
    return `${core}
export const config = { runtime: "edge" };

function readSecret() {
  try { return process.env.${RELAY_AUTH_ENV} || ""; } catch (e) { return ""; }
}

export default async function handler(req) {
  return relayRequest(req, readSecret());
}
`;
  }

  if (platform === "cloudflare") {
    return `${core}
function readSecret(env) {
  try { return (env && env.${RELAY_AUTH_ENV}) || ""; } catch (e) { return ""; }
}

export default {
  async fetch(request, env, ctx) {
    return relayRequest(request, readSecret(env));
  },
};
`;
  }

  if (platform === "deno") {
    return `${core}
function readSecret() {
  try { return Deno.env.get("${RELAY_AUTH_ENV}") || ""; } catch (e) { return ""; }
}

Deno.serve(async (request) => {
  return relayRequest(request, readSecret());
});
`;
  }

  throw new Error(`renderRelaySource: unknown platform "${platform}"`);
}
