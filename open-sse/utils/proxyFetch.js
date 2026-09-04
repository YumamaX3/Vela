import { Readable } from "stream";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { dbg } from "./debugLog.js";
// §5.2d — the version gate lives next to RELAY_VERSION so the caller side and the
// relay side cannot drift apart. relayTemplate.js imports nothing of its own, so
// this adds no cycle to the gateway's hot path.
//
// RELATIVE, not `@/` — and that is a correction, not a preference. The first draft of
// this line used "@/lib/network/relayTemplate.js", justified by "open-sse already
// imports @/lib/usageDb six times". That reasoning was WRONG for this file, and
// tests/unit/reasoningContentInjector.test.js proved it: it fails with
// `Cannot find package '@/lib' imported from open-sse/utils/proxyFetch.js`.
// The six existing sites are all db modules reached through vite's transform, where
// the alias is configured. This module is ALSO loadable through Node's native ESM —
// that test graph reparses open-sse/executors/base.js as an ES module and never sees
// vite's alias table at all, so `@/lib` arrives as a bare package specifier and
// resolution fails at import time, before any test body runs.
// proxyFetch.js is the gateway engine's most-mocked module (25 suites), so coupling
// its import shape to a build tool is the wrong trade. Relative matches this file's
// own convention (`../config/runtimeConfig.js`, `./debugLog.js`) and resolves under
// both loaders. The six `@/` db sites are left alone — they are not broken, and
// churning them would be a change with no reason.
import { relayAuthHeaders } from "../../src/lib/network/relayTemplate.js";
// §5.4 — the userinfo masker for error messages. proxyRedaction.js is a PURE module
// (zero imports), so this adds no weight to the gateway's hot path. Masking only the
// MESSAGE interpolation, never `normalized` itself: that value is the dispatcher cache
// key AND the construction argument, both of which need the real credentials.
// Relative for the same dual-loader reason documented above.
import { maskProxyUrlForRead } from "../../src/lib/db/repos/proxyRedaction.js";

const originalFetch = globalThis.fetch;
const proxyDispatchers = new Map();

// ─── TLS fingerprinting via got-scraping (browser-like JA3) ───────────────
// Disabled: not in use. Kept commented for future re-enable.
// Restore the original block to re-enable per-host JA3 spoofing.
/*
let _gotScraping = null;
let _gotScrapingChecked = false;
const _gotScrapingLoggedHosts = new Set();

async function getGotScraping() {
  if (_gotScrapingChecked) return _gotScraping;
  _gotScrapingChecked = true;
  try {
    const mod = await import("got-scraping");
    _gotScraping = typeof mod.gotScraping === "function" ? mod.gotScraping : null;
    if (_gotScraping) dbg("TLS", "got-scraping loaded (browser-like JA3 enabled)");
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping unavailable, falling back to native fetch: ${e.message}`);
    _gotScraping = null;
  }
  return _gotScraping;
}

async function gotScrapingFetch(url, options) {
  const gs = await getGotScraping();
  if (!gs) return null;

  const method = (options.method || "GET").toUpperCase();
  const headersInit = options.headers || {};
  const headers = headersInit instanceof Headers
    ? Object.fromEntries(headersInit.entries())
    : { ...headersInit };

  return new Promise((resolve, reject) => {
    let settled = false;
    const stream = gs.stream({
      url,
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : options.body,
      throwHttpErrors: false,
      retry: { limit: 0 },
      timeout: { request: undefined },
      followRedirect: false,
      decompress: true,
    });

    if (options.signal) {
      const onAbort = () => { try { stream.destroy(new Error("aborted")); } catch { } };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    stream.once("response", (res) => {
      if (settled) return;
      settled = true;
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers || {})) {
        if (Array.isArray(v)) v.forEach((x) => resHeaders.append(k, String(x)));
        else if (v != null) resHeaders.set(k, String(v));
      }
      const body = Readable.toWeb(stream);
      resolve(new Response(body, { status: res.statusCode, statusText: res.statusMessage || "", headers: resHeaders }));
    });

    stream.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function tryGotScrapingFetch(url, options) {
  try {
    const res = await gotScrapingFetch(url, options);
    if (res) {
      try {
        const host = new URL(typeof url === "string" ? url : url.toString()).hostname;
        if (!_gotScrapingLoggedHosts.has(host)) {
          _gotScrapingLoggedHosts.add(host);
          dbg("TLS", `using got-scraping for ${host}`);
        }
      } catch { }
    }
    return res;
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping request failed, fallback to native fetch: ${e.message}`);
    return null;
  }
}
*/

// DNS cache — use Map to avoid prototype pollution via malformed hostnames
const DNS_CACHE = new Map();
const MITM_BYPASS_HOSTS = [
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "codewhisperer.us-east-1.amazonaws.com",
  "api2.cursor.sh",
];
const GOOGLE_DNS_SERVERS = ["8.8.8.8", "8.8.4.4"];
const HTTPS_PORT = 443;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 300;

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// §5.3 — the egress header fence. ONE chokepoint, applied at the top of
// proxyAwareFetch before any of the five outbound spreads (:316 bypass, :357 relay,
// :378/:399 dispatcher, :412 direct), so a seam added later cannot bypass it.
//
// WHY THE x-9r-* FAMILY MUST NOT REACH A PROVIDER
// custom-server.js:120-121 stamps x-9r-real-ip AND x-9r-peer-token (the per-process
// secret proving the stamp) onto INBOUND request headers. modelsList.js:99 forwards
// connection headers outbound. So any route that spreads inbound headers into an
// outbound provider call would hand the peer-token to a third party — OpenAI,
// Anthropic, whoever the node points at. That is credential disclosure, not a
// theoretical concern: the path is live.
//
// WHY A PREFIX RULE AND NOT AN ENUMERATION
// Five members exist in source today (real-ip, peer-token, via-proxy, password,
// internal-models-fetch). The custom server's stamping protocol may grow a sixth,
// and an enumeration of today's five would forward it. A prefix rule cannot be
// outgrown. (The relay's own strip in relayTemplate.js uses the same prefix rule —
// this fence is the belt, the relay strip is the braces.)
//
// WHY AN ALLOW-LIST IS REFUTED, NOT MERELY DISMISSED
// The ADR measured 65+ provider-declared custom headers across 19 registries:
// Anthropic-Beta (a 300-char string), seven X-Stainless-*, copilot-integration-id,
// connect-protocol-version, X-Grpc-Web, x-codebuddy-request, and more. An allow-list
// must enumerate all of them and be edited for every new provider — a silent-breakage
// machine whose failures surface as upstream 400s far from the cause. A deny-list
// touching only the security family never blocks a legitimate provider header.
//
// THE ONE EXEMPTION (Star's decree, 2026-09-04)
// x-9r-internal-models-fetch is NOT a secret — it carries the literal "1" and is the
// cross-instance recursion guard: modelsList.js:99 sets it on a Vela→Vela /models
// fetch, and api/v1/models/route.js:20 reads it to skip the dynamic fetch, preventing
// infinite recursion when one Vela is configured as a node of another. Stripping it
// would break Vela-as-a-node-of-Vela. So the prefix rule exempts exactly this one
// name, and the exemption is safe because the value is a constant marker, never a
// credential. Every other x-9r-* member — including any future one — is stripped.
const X9R_EXEMPT = new Set(["x-9r-internal-models-fetch"]);

/**
 * Strip the x-9r-* security family from outbound headers, returning a NEW value.
 *
 * Handles every header shape undici/fetch accepts, because a fence that only handled
 * plain objects would either CORRUPT or SILENTLY SKIP the others:
 *
 *   • plain object (Record<string,string>) — the shape every caller in this repo
 *     passes today. Snapshot the keys first: deleting during a for..in over the live
 *     object is unsafe once a key has been visited.
 *   • Headers instance — `{...headers}` yields `{}`, so spreading it would have
 *     DELETED EVERY HEADER (Authorization included) and turned a silent security win
 *     into a total request failure. Walked via keys() + delete() instead.
 *   • array of [name, value] pairs — `{...arr}` yields `{0:[...]}`, corrupting valid
 *     headers into nonsense. Filtered instead.
 *   • anything else (string, number, null) — returned UNTOUCHED. undici/Headers
 *     rejects these on its own; it is not this fence's job to repair an invalid caller
 *     argument, and inventing a failure mode here would obscure the caller's bug.
 *
 * Never throws. The caller rebinds options to the returned value, so the original
 * object is never mutated.
 */
function fenceEgressHeaders(headers) {
  const isMatch = (name) => {
    if (typeof name !== "string") return false;
    const lower = name.toLowerCase();
    return lower.startsWith("x-9r-") && !X9R_EXEMPT.has(lower);
  };

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    // Snapshot first: mutating a Headers while iterating its own keys() is not
    // guaranteed to be safe across implementations.
    for (const key of [...headers.keys()]) {
      if (isMatch(key)) headers.delete(key);
    }
    return headers;
  }

  if (Array.isArray(headers)) {
    // Pair form: [["authorization", "Bearer x"], ["x-9r-peer-token", "..."]]
    return headers.filter((entry) => !(Array.isArray(entry) && isMatch(entry[0])));
  }

  if (!headers || typeof headers !== "object") return headers;

  const out = {};
  for (const key of Object.keys(headers)) {
    if (!isMatch(key)) out[key] = headers[key];
  }
  return out;
}

/**
 * Resolve real IP using Google DNS (bypass system DNS)
 */
async function resolveRealIP(hostname) {
  const cached = DNS_CACHE.get(hostname);
  if (cached && Date.now() < cached.expiry) return cached.ip;

  try {
    const dns = await import("dns");
    const { promisify } = await import("util");
    const resolver = new dns.Resolver();
    resolver.setServers(GOOGLE_DNS_SERVERS);
    const resolve4 = promisify(resolver.resolve4.bind(resolver));
    const addresses = await resolve4(hostname);
    DNS_CACHE.set(hostname, { ip: addresses[0], expiry: Date.now() + MEMORY_CONFIG.dnsCacheTtlMs });
    return addresses[0];
  } catch (error) {
    console.warn(`[ProxyFetch] DNS resolve failed for ${hostname}:`, error.message);
    return null;
  }
}

/**
 * Check if request should bypass MITM DNS redirect
 */
function shouldBypassMitmDns(url) {
  try {
    const hostname = new URL(url).hostname;
    return MITM_BYPASS_HOSTS.some(host => hostname.includes(host));
  } catch { return false; }
}

function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try { hostname = new URL(targetUrl).hostname.toLowerCase(); } catch { return false; }
  const patterns = noProxy.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Get proxy URL from environment
 */
function getEnvProxyUrl(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  let protocol;
  try { protocol = new URL(targetUrl).protocol; } catch { return null; }

  if (protocol === "https:") {
    return process.env.HTTPS_PROXY || process.env.https_proxy ||
      process.env.ALL_PROXY || process.env.all_proxy;
  }

  return process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy;
}

/**
 * Normalize proxy URL (allow host:port)
 */
function normalizeProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {

    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${normalizedInput}`;
  }
}

function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

/**
 * Create proxy dispatcher lazily (undici-compatible)
 * SOCKS5 support via Socks5ProxyAgent (undici 7.29.0)
 */
async function getDispatcher(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  if (!proxyDispatchers.has(normalized)) {
    // Evict oldest entry if max size reached.
    // v0.9.42: CLOSE the evicted dispatcher. An undici dispatcher owns a
    // connection pool and its sockets; deleting the Map entry drops the only
    // reference without releasing them, so every eviction leaked fds for the
    // lifetime of the process. Fire-and-forget and fail-open — a close error
    // must never break the fetch that triggered the eviction.
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      const oldestKey = proxyDispatchers.keys().next().value;
      const evicted = proxyDispatchers.get(oldestKey);
      proxyDispatchers.delete(oldestKey);
      try {
        await evicted?.close?.();
      } catch {
        // ignore — the entry is already gone from the cache
      }
    }

    let protocol;
    try {
      protocol = new URL(normalized).protocol;
    } catch {
      protocol = "http:";
    }

    // Bind the dynamic imports to DECLARED locals — destructuring-assigning
    // into bare names dies as "ProxyAgent is not defined" once bundled.
    const undici = await import("undici");
    // §5.4 — `normalized` carries the operator's proxy userinfo (user:password@). It is
    // the dispatcher cache key AND the construction argument, both of which need it
    // verbatim to authenticate upstream. It must NEVER appear in a message: these two
    // throws propagate through the strictProxy wrappers (:489/:511), through
    // combo.js:480 `lastError = error.message`, and out at combo.js:501-504 as
    // `{ error: { message } }` in the HTTP response body — disclosing the proxy
    // credential to every API client. Masking happens at the ORIGIN, not at each sink,
    // because a generic `catch (error) { msg = error.message }` funnel has N consumers
    // today and will gain more. maskProxyUrlForRead is the existing §5.4 seam (ADR:
    // "extend the existing seam, do not invent one") and proxyRedaction.js is a pure
    // module — zero imports — so it adds nothing to the gateway's weight.
    const safeUrl = maskProxyUrlForRead(normalized);
    // MEASURED, NOT ASSUMED — the dispatcher CONSTRUCTORS below are deliberately left
    // unwrapped. `new Socks5ProxyAgent(url)` and `new ProxyAgent({uri})` were probed
    // against 7 malformed shapes × 2 constructors (bad port, no host, empty userinfo,
    // unknown scheme, embedded @) and ALL 14 leaked nothing: undici throws a generic
    // `TypeError: Invalid URL` or an `InvalidArgumentError` naming the protocol, never
    // echoing the input. (The URL does survive on `err.input`, but no consumer here
    // reads `.input` — `getErrorMessage` reads `.message`/`.cause` only.)
    //
    // So a sanitizing wrapper around construction would guard a hazard that does not
    // exist today, and — decisively — NO TEST COULD PROVE IT WORKS: removing it would
    // leave every suite green. An untestable guard is a false-green wearing armour.
    // If a future undici starts echoing its input into `.message`, the right fix is a
    // test that asserts the absence first (and goes red), then this mask. Do not add
    // the wrapper without the failing test that justifies it.
    let Dispatcher;
    if (/^socks5:\/\//i.test(normalized)) {
      // SOCKS5 branch - undici 7.29.0 exports Socks5ProxyAgent
      const Socks5ProxyAgent = undici.Socks5ProxyAgent;
      if (!Socks5ProxyAgent) {
        throw new Error(`unsupported proxy scheme for ${safeUrl}: Socks5ProxyAgent unavailable in this undici build`);
      }
      // ⚠️ POSITIONAL url — NOT `{ uri: normalized }`. Socks5ProxyAgent's
      // signature is `(proxyUrl, options = {})` and it does
      // `typeof proxyUrl === 'string' ? new URL(proxyUrl) : proxyUrl`, so an
      // object passes through with `url.protocol === undefined` and throws
      // InvalidArgumentError at CONSTRUCTION, before any socket opens. The
      // ProxyAgent sibling below genuinely takes `{ uri }` — do not "match" it
      // here. (v0.9.44: the `{ uri }` shape threw for every socks5 pool, the
      // catch at :380 fell back to DIRECT and silently bypassed the operator's
      // proxy; in proxyTest.js the same throw became status 400, which IS in
      // DETERMINISTIC_FAILURE_STATUSES, so the sweep disabled every socks5
      // pool as "dead".)
      Dispatcher = new Socks5ProxyAgent(normalized);
    } else {
      const ProxyAgent = undici.ProxyAgent;
      if (!ProxyAgent) {
        throw new Error(`unsupported proxy scheme for ${safeUrl}: ProxyAgent unavailable in this undici build`);
      }
      Dispatcher = new ProxyAgent({ uri: normalized });
    }

    proxyDispatchers.set(normalized, Dispatcher);
  }

  return proxyDispatchers.get(normalized);
}

/**
 * Create HTTPS request with manual socket connection (bypass DNS)
 */
async function createBypassRequest(parsedUrl, realIP, options) {
  const httpsModule = await import("https");
  const netModule = await import("net");
  // CJS modules expose exports via .default in ESM dynamic import context
  const https = httpsModule.default ?? httpsModule;
  const net = netModule.default ?? netModule;

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    socket.connect(HTTPS_PORT, realIP, () => {
      const reqOptions = {
        socket,
        // SNI + cert hostname are validated against the hostname the caller
        // asked for, not the IP we connected to. This keeps the DNS-bypass
        // (avoiding /etc/hosts MITM) while still rejecting on-path attackers
        // that present a different cert. The MITM_BYPASS_HOSTS targets are
        // all public-CA-issued (Google / GitHub / AWS / Cursor) so default
        // verification works without any extra trust store.
        servername: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "POST",
        headers: {
          ...options.headers,
          Host: parsedUrl.hostname,
        },
      };

      const req = https.request(reqOptions, (res) => {
        const response = {
          ok: res.statusCode >= HTTP_SUCCESS_MIN && res.statusCode < HTTP_SUCCESS_MAX,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: new Map(Object.entries(res.headers)),
          body: Readable.toWeb(res),
          text: async () => {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            return Buffer.concat(chunks).toString();
          },
          json: async () => JSON.parse(await response.text()),
        };
        resolve(response);
      });

      req.on("error", reject);
      if (options.body) {
        req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });

    socket.on("error", reject);
  });
}

export async function proxyAwareFetch(url, options = {}, proxyOptions = null) {
  const targetUrl = typeof url === "string" ? url : url.toString();

  // §5.3 — fence the x-9r-* security family ONCE, here, before any of the five
  // outbound spreads below read options.headers. fenceEgressHeaders returns a NEW
  // value for every shape it understands, so the caller's own header object is never
  // mutated: a caller that reuses one options object across two fetches would
  // otherwise find its headers silently gone on the second call.
  //
  // The headers are passed DIRECTLY, never pre-spread. An earlier revision wrote
  // `fenceEgressHeaders({ ...options.headers })` and that spread was itself the bug:
  // `{...new Headers(...)}` yields `{}` (every header lost, Authorization included)
  // and `{...[["a","b"]]}` yields `{0:["a","b"]}` (valid headers corrupted into
  // nonsense). Letting the fence see the real shape is what makes handling it possible.
  if (options && typeof options === "object" && options.headers) {
    const fenced = fenceEgressHeaders(
      typeof Headers !== "undefined" && options.headers instanceof Headers
        ? new Headers(options.headers) // clone — never mutate the caller's instance
        : options.headers
    );
    options = { ...options, headers: fenced };
  }

  // Vercel relay: forward request via relay headers
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    const relayHeaders = {
      ...options.headers,
      // Spread FIRST so an operator-supplied header can never impersonate the
      // relay's own control channel — and so the two below can never be shadowed
      // by something already in options.headers.
      ...relayAuthHeaders(proxyOptions),
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    return originalFetch(vercelRelayUrl, { ...options, headers: relayHeaders });
  }

  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;

  // MITM DNS bypass: for known MITM-intercepted hosts, resolve real IP to avoid DNS spoof
  if (shouldBypassMitmDns(targetUrl)) {
    if (proxyUrl) {
      // Proxy resolves DNS externally (not affected by /etc/hosts) — use proxy directly
      try {
        const dispatcher = await getDispatcher(proxyUrl);
        return await originalFetch(url, { ...options, dispatcher });
      } catch (proxyError) {
        if (proxyOptions?.strictProxy === true) {
          throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
        }
        console.warn(`[ProxyFetch] Proxy failed, falling back to direct bypass: ${proxyError.message}`);
      }
    }
    // No proxy — manually resolve real IP to bypass DNS spoof
    try {
      const parsedUrl = new URL(targetUrl);
      const realIP = await resolveRealIP(parsedUrl.hostname);
      if (realIP) return await createBypassRequest(parsedUrl, realIP, options);
    } catch (error) {
      console.warn(`[ProxyFetch] MITM bypass failed: ${error.message}`);
    }
  }

  if (proxyUrl) {
    try {
      const dispatcher = await getDispatcher(proxyUrl);
      return await originalFetch(url, { ...options, dispatcher });
    } catch (proxyError) {
      // If strictProxy is enabled, fail hard instead of falling back to direct
      if (proxyOptions?.strictProxy === true) {
        throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
      }
      console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`);
      return originalFetch(url, options);
    }
  }

  // got-scraping disabled — use native fetch directly
  // (Re-enable per-host by wrapping with tryGotScrapingFetch when needed)
  return originalFetch(url, options);
}

/**
 * Patched global fetch with env-proxy support and MITM DNS bypass
 */
async function patchedFetch(url, options = {}) {
  return proxyAwareFetch(url, options, null);
}

// Idempotency guard — only patch once to avoid wrapping multiple times
if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;
