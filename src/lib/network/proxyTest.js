import { ProxyAgent, fetch as undiciFetch } from "undici";
// §5.2e — the probe and the request path share ONE version gate, so a relay is never
// authenticated by one and refused by the other. relayTemplate.js imports nothing of
// its own, so this adds no cycle.
import { relayAuthHeaders } from "./relayTemplate.js";
// §5.5c (Security Closure M2) — the probe surface's own URL gate. Until this tide
// `testUrl` and `proxyUrl` arrived RAW from the request body (`POST /api/settings/
// proxy-test`): a HEAD to any host the caller named, THROUGH any proxy the caller named
// — including one that dials the metadata endpoint. Two laws already exist for exactly
// these values, so this reuses them rather than writing a third:
//   validateProxyPoolUrl    — a proxy/relay URL (http/https/socks5; literal loopback
//                             exempt, because the operator's own 127.0.0.1:7890 proxy
//                             is configuration, not SSRF).
//   validateProviderTestUrl — a fetch TARGET (http/https only; loopback, metadata,
//                             link-local and unspecified refused as literals).
import { validateProxyPoolUrl, validateProviderTestUrl } from "./providerUrlSafety.js";

const DEFAULT_TEST_URL = "https://google.com/";
const DEFAULT_TIMEOUT_MS = 8000;

// A refused URL must never read as a DEAD POOL. classifyProbeVerdict() maps
// {400, 404, 410} to "dead", and the fleet sweep disables a pool on a dead verdict —
// so returning 400 here would let a refused URL liquidate its own pool: the v0.9.42
// self-liquidation class, with a new trigger. 422 is honest ("unprocessable
// configuration") and falls outside that set, so the pool stays ACTIVE while no
// request ever leaves the process. The SSRF is refused with zero collateral.
const REFUSAL_STATUS = 422;

function refuseGate(gate, field) {
  return { ok: false, status: REFUSAL_STATUS, error: `${field} rejected: ${gate.message}` };
}

// Relay reachability probe — a cheap public GET the relay forwards. httpbin.org
// is what the route already used; it is a third-party dependency, so a failure
// here must classify as INDETERMINATE (see classifyProbeVerdict), never as the
// relay being dead.
const RELAY_PROBE_TARGET = "https://httpbin.org";
const RELAY_PROBE_PATH = "/get";

function getErrorMessage(err) {
  if (!err) return "Unknown error";
  const base = err?.message || String(err);
  const causeCode = err?.cause?.code || err?.code;
  const causeMessage = err?.cause?.message;

  if (causeMessage && causeMessage !== base) {
    return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
  }

  if (causeCode && !base.includes(causeCode)) {
    return `${base} (${causeCode})`;
  }

  return base;
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export async function testProxyUrl({ proxyUrl, testUrl, timeoutMs } = {}) {
  const rawProxyUrl = normalizeString(proxyUrl);
  if (!rawProxyUrl) {
    return { ok: false, status: 400, error: "proxyUrl is required" };
  }

  // §5.5c — the proxy URL is caller-supplied and dialed, so it crosses the same law a
  // pool crosses at create/update. Gated HERE rather than only in the route: this
  // function is the thing that dials, and it has three callers on three trust paths
  // (`/api/settings/proxy-test` from a body, the provider-test path from a stored
  // `connectionProxyUrl`, the fleet sweep from a stored pool row). A per-caller gate
  // would leave the other two unjudged.
  const proxyGate = validateProxyPoolUrl(rawProxyUrl);
  if (!proxyGate.ok) return refuseGate(proxyGate, "proxyUrl");
  const normalizedProxyUrl = proxyGate.url;

  // The TARGET too. This HEAD used to go wherever the body said — the probe was a
  // general-purpose fetch primitive reachable from an authenticated request.
  const targetGate = validateProviderTestUrl(normalizeString(testUrl) || DEFAULT_TEST_URL);
  if (!targetGate.ok) return refuseGate(targetGate, "testUrl");
  const normalizedTestUrl = targetGate.url;

  const timeoutMsRaw = Number(timeoutMs);
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, 30000)
      : DEFAULT_TIMEOUT_MS;

  let dispatcher;

  try {
    // The gate at the top of this function already normalized and judged this URL —
    // the raw body value is never dialed. (The inner re-normalization and its
    // `protocol` local were both dead: nothing read `protocol`, and the emptiness
    // guard repeated the check already made above.)
    const normalized = normalizedProxyUrl;

    try {
      // Bind the dynamic imports to DECLARED locals — destructuring-assigning
      // into the import bindings (`({ ProxyAgent } = await import(...))`)
      // compiles to bare assignments and dies as "ProxyAgent is not defined"
      // once bundled (the dashboard showed exactly that wound).
      const undici = await import("undici");
      if (/^socks5:\/\//i.test(normalized)) {
        // SOCKS5 branch — undici Socks5ProxyAgent
        const Socks5ProxyAgent = undici.Socks5ProxyAgent;
        if (!Socks5ProxyAgent) {
          return { ok: false, status: 400, error: "Invalid proxy URL: this undici build has no Socks5ProxyAgent — use an http(s):// proxy" };
        }
        // ⚠️ POSITIONAL url — NOT `{ uri: normalized }`. Signature is
        // `(proxyUrl, options = {})`; an object reaches the protocol check with
        // `url.protocol === undefined` and throws InvalidArgumentError at
        // CONSTRUCTION. The ProxyAgent sibling below genuinely takes `{ uri }`.
        // (v0.9.44: this throw was caught at :80 as status 400, and 400 IS in
        // DETERMINISTIC_FAILURE_STATUSES below, so classifyProbeVerdict called
        // every socks5 pool "dead" and the sweep disabled them — a
        // per-scheme self-liquidation that Wave 0's indeterminate≠dead law
        // could not catch, because the status looked deterministic.)
        dispatcher = new Socks5ProxyAgent(normalized);
      } else {
        // HTTP(s) proxy
        const ProxyAgent = undici.ProxyAgent;
        if (!ProxyAgent) {
          return { ok: false, status: 400, error: "Invalid proxy URL: this undici build has no ProxyAgent" };
        }
        dispatcher = new ProxyAgent({ uri: normalized });
      }
    } catch (err) {
      return { ok: false, status: 400, error: `Invalid proxy URL: ${err?.message || String(err)}` };
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const res = await undiciFetch(normalizedTestUrl, {
        method: "HEAD",
        dispatcher,
        signal: controller.signal,
        headers: {
          "User-Agent": "Vela",
        },
      });

      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        url: normalizedTestUrl,
        elapsedMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? "Proxy test timed out"
          : getErrorMessage(err);
      return { ok: false, status: 500, error: message };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      await dispatcher?.close?.();
    } catch {
      // ignore
    }
  }
}

/**
 * Relay (vercel|cloudflare|deno) reachability test — a relay's proxyUrl is an
 * HTTPS URL, not a proxy, so it must be probed through its own envelope:
 * x-relay-target + x-relay-path. Running it through testProxyUrl would build a
 * ProxyAgent and issue CONNECT *through* the relay, which 400s on the missing
 * target header — reading a perfectly healthy relay as dead.
 *
 * One home for the verdict: the [id]/test route and the fleet health sweep both
 * come through here, so a single relay is never judged two different ways.
 *
 * §5.2e — A v2 relay authenticates, so this probe must carry the secret or it gets
 * 401 on every sweep and the pool can never be confirmed alive. The secret arrives
 * via relayAuthHeaders, which applies the SAME version gate the request path uses,
 * and that gate is doubly load-bearing on this path:
 *
 *   A v1 relay forwards EVERY header to whatever host it is told. This probe's host
 *   is httpbin.org — a third party — and httpbin's /get echoes request headers back
 *   in its response body. So sending x-relay-auth to a v1 relay would disclose the
 *   secret to a third-party service. The gate here is not only about the relay
 *   accepting or refusing; it is what keeps the secret off the wire to httpbin.
 *
 * @param {object} args
 * @param {string} args.relayUrl the relay's public https url
 * @param {number} [args.timeoutMs]
 * @param {string} [args.relayAuth] the pool's stored relay secret
 * @param {number} [args.relayVersion] 2 sends the secret; anything else sends none
 */
export async function testRelayUrl({ relayUrl, timeoutMs, relayAuth, relayVersion } = {}) {
  const rawRelayUrl = normalizeString(relayUrl);
  if (!rawRelayUrl) {
    return { ok: false, status: 400, error: "relayUrl is required" };
  }

  // §5.5c — a relay URL is a dialed URL from the same request body, so it crosses the
  // same gate. A refusal is 422 → INDETERMINATE: an unjudged relay must never read as
  // a dead one and hand the sweep a reason to disable it.
  const relayGate = validateProxyPoolUrl(rawRelayUrl);
  if (!relayGate.ok) return refuseGate(relayGate, "relayUrl");
  const normalizedRelayUrl = relayGate.url;

  const timeoutMsRaw = Number(timeoutMs);
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, 30000)
      : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

  try {
    const res = await undiciFetch(normalizedRelayUrl, {
      method: "GET",
      headers: {
        // Spread first so the relay's own control headers below can never be
        // shadowed, and so a withheld secret adds nothing at all.
        ...relayAuthHeaders({ relayAuth, relayVersion }),
        "x-relay-target": RELAY_PROBE_TARGET,
        "x-relay-path": RELAY_PROBE_PATH,
      },
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      url: normalizedRelayUrl,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    const message =
      err?.name === "AbortError"
        ? "Relay test timed out"
        : getErrorMessage(err);
    return { ok: false, status: 500, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Relay types that must be probed through the relay envelope, not as a proxy. */
export const RELAY_PROXY_TYPES = new Set(["vercel", "cloudflare", "deno"]);

/**
 * Statuses that PROVE a pool is unusable — a config we can name, or a relay
 * deployment that is gone. Every other failure is INDETERMINATE: a timeout, a
 * 5xx, a rate-limited probe target, or a thrown error may all mean the probe's
 * own path faltered rather than the pool dying.
 *
 * The health sweep disables a pool ONLY on a deterministic verdict. Treating an
 * indeterminate failure as death is what silently liquidated the whole fleet:
 * an unimported symbol threw, the throw read as {ok:false}, and every pool was
 * disabled — then replicated to the mirror twin.
 */
const DETERMINISTIC_FAILURE_STATUSES = new Set([400, 404, 410]);

/**
 * Classify a test verdict into the fleet's three states.
 * @returns {"alive"|"dead"|"indeterminate"}
 */
export function classifyProbeVerdict(result) {
  if (result?.ok) return "alive";
  if (!result) return "indeterminate";
  return DETERMINISTIC_FAILURE_STATUSES.has(result.status) ? "dead" : "indeterminate";
}

/**
 * Probe one pool by type — relays through their envelope, proxies as proxies.
 * The single entry point both the test route and the health sweep use, so a
 * pool can never be judged alive by one and dead by the other (the flicker
 * race: a manual test revived a pool the scheduler re-liquidated five minutes
 * later, because the two paths disagreed about what a failure meant).
 */
export async function testPoolReachability(pool, { timeoutMs } = {}) {
  if (!pool?.proxyUrl) {
    return { ok: false, status: 400, error: "pool has no proxyUrl", verdict: "dead" };
  }
  const result = RELAY_PROXY_TYPES.has(pool.type)
    ? // §5.2e — the whole pool row is threaded, not just its URL: a v2 relay's probe
      // needs the stored secret to authenticate. Both callers already pass a full row
      // (proxy-pools/[id]/test/route.js:28, proxyFleet.js:755), and the row is the
      // raw store shape here — getProxyPoolById is not masked; the masker fires only
      // at HTTP read boundaries. relayVersion defaults to 1 for every pre-§5.2 row,
      // which withholds the secret.
      await testRelayUrl({
        relayUrl: pool.proxyUrl,
        timeoutMs,
        relayAuth: pool.relayToken,
        relayVersion: pool.relayVersion,
      })
    : await testProxyUrl({ proxyUrl: pool.proxyUrl, timeoutMs });
  return { ...result, verdict: classifyProbeVerdict(result) };
}
