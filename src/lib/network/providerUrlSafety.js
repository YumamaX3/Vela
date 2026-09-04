/**
 * Provider-Test URL Safety — M0 TAG 4 (SSRF gate for the provider-test surface)
 * =============================================================================
 *
 * The provider-test routes fetch URLs that an OPERATOR typed into a
 * connection's `providerSpecificData.baseUrl` (or azureEndpoint / node
 * baseUrl). An operator-controlled fetch target is a classic SSRF entry
 * point: a hostile or careless value can point the server at cloud metadata
 * (169.254.169.254), loopback services, or other reserved ranges. This
 * module validates those targets BEFORE any fetch leaves the process.
 *
 * THE RULES
 * ---------
 * ALLOWED schemes: http, https ONLY. Everything else (file:, gopher:, ftp:,
 * data:, javascript:, …) is refused, scheme match is case-insensitive (the
 * URL parser lowercases protocols, so FILE:// is caught too).
 *
 * BLOCKED ranges:
 *   - Loopback        127.0.0.0/8, ::1, the name "localhost"
 *   - Link-local      169.254.0.0/16 (incl. the 169.254.169.254 metadata IP),
 *                     fe80::/10 (incl. zone-id forms like fe80::1%eth0)
 *   - Unspecified     0.0.0.0/8 and ::
 *   - Documentation   2001:db8::/32 (never legitimately routable)
 *
 * DELIBERATELY NOT BLOCKED (sealed plan — documented on purpose):
 *   - RFC1918 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 *   - CGNAT: 100.64.0.0/10 — the block Tailscale assigns its subnet addresses
 *     from. Legitimate homelab gateways test their providers
 *     through LAN/Tailscale proxies; blocking these would break the
 *     primary self-hosted workflow for zero security gain.
 *   - IPv6 unique-local fc00::/7 (same homelab rationale as RFC1918).
 *
 * HOSTILE LITERALS
 * ----------------
 * Loopback/metadata IPs can be spelled many ways: IPv6 bracket forms,
 * decimal (http://2130706433/), hex (http://0x7f000001/), octal
 * (http://017700000001/), shortened dotted forms (http://127.1/), and mixed
 * bases (http://0x7f.1/). We therefore normalize through the URL parser AND
 * a numeric IP parser (dotted forms with 1–4 parts, each part decimal, hex,
 * or octal — the same grammar classic resolvers accept) before judging.
 * Anything we cannot parse is REFUSED, never allowed through.
 *
 * REDIRECTS
 * ---------
 * undici/fetch follows redirects automatically, which would let an allowed
 * external URL bounce the fetch into a blocked range after validation.
 * The chosen option (the simplest correct one): probe with
 * `redirect: "manual"` and re-validate EACH hop via probeWithHopValidation()
 * — allowed hops are followed (up to 3), blocked/unparseable hops throw.
 *
 * DNS REBINDING — documented residual
 * -----------------------------------
 * A hostname that passes validation could resolve to a blocked IP at connect
 * time (TOCTOU between validation and fetch). We accept this residual for
 * the provider-test surface: the threat actor is the operator themselves
 * (dashboard-authenticated), the blocked ranges are still refused when they
 * appear as literals, and the cloud-metadata vector (the high-value target)
 * is covered by the literal blocks above. If a future tag needs stronger
 * guarantees, the mitigation is resolve-and-pin (dns.lookup the host, judge
 * the IP, connect to the resolved address with the original Host/SNI) —
 * cheap to add here because all judging is centralized in this module.
 *
 * INTERNAL CALLERS
 * ----------------
 * The internal model-ping path (src/app/api/models/test/ping.js) fetches
 * loopback BY DESIGN and does not use this module. Any internal caller that
 * ever needs to pass through validation sets { allowLocalLoopback: true }.
 * Operator routes NEVER set it. Separately, { allowLocal: true } — sourced
 * only from allowLocalTestingFor() (env VELa_ALLOW_LOCAL_TESTING=1 or a
 * connection's providerSpecificData.vela_allow_local === true) — loosens the
 * LOOPBACK block only (for genuinely-local test targets like ollama-local,
 * whose default host is http://localhost:11434); link-local/metadata stay
 * blocked even then.
 *
 * ERROR HONESTY
 * -------------
 * Refusals name their CLASS (scheme / blocked-range / unparseable) and carry
 * a short operator-safe message — never the internal reason chain.
 */

const BLOCKED_RANGE_MESSAGE = "That provider test target is in a reserved local range and is not allowed";
const SCHEME_MESSAGE = "Only http:// or https:// URLs are allowed for provider testing";
const UNPARSEABLE_MESSAGE = "Provider test URL could not be parsed";
const MISSING_MESSAGE = "Provider test URL is missing or empty";

const MAX_REDIRECT_HOPS = 3;

export class ProviderUrlSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProviderUrlSafetyError";
    this.code = code;
  }
}

function refusal(code, message) {
  return { ok: false, code, message };
}

/* ── Numeric IP parsing ─────────────────────────────────────────────── */

// One dotted-part: decimal, 0x-hex, or leading-0 octal. Mirrors the grammar
// classic resolvers (and thus undici's getaddrinfo) accept, so every hostile
// literal spelling of loopback/metadata is judged as a number, not a name.
function parseNumericPart(part) {
  if (part === "") return null;
  let n;
  if (/^0[xX][0-9a-fA-F]+$/.test(part)) n = parseInt(part.slice(2), 16);
  else if (/^0[0-7]+$/.test(part)) n = parseInt(part, 8);
  else if (/^[0-9]+$/.test(part)) n = parseInt(part, 10);
  else return null;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * Parse an IPv4 literal in any classic form: 1–4 dotted parts where the LAST
 * part spans the remaining bits (http://127.1/ == 127.0.0.1). Returns the
 * 32-bit value or null when the host is not a numeric IPv4 literal.
 */
function parseIpv4Literal(host) {
  const parts = String(host).split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums = parts.map(parseNumericPart);
  if (nums.some((n) => n === null)) return null;

  let head = 0;
  for (let i = 0; i < nums.length - 1; i += 1) {
    if (nums[i] > 0xff) return null;
    head = head * 256 + nums[i];
  }
  const remainingBits = 32 - 8 * (parts.length - 1);
  const last = nums[nums.length - 1];
  if (last >= 2 ** remainingBits) return null;
  return head * 2 ** remainingBits + last;
}

function classifyIpv4(value) {
  const o1 = (value >>> 24) & 0xff;
  if (o1 === 127) return "loopback"; // 127.0.0.0/8
  if (o1 === 0) return "blocked"; // 0.0.0.0/8 incl. 0.0.0.0
  if (o1 === 169 && ((value >>> 16) & 0xff) === 254) return "blocked"; // 169.254.0.0/16 metadata
  // RFC1918 (10/8, 172.16/12, 192.168/16) and CGNAT (100.64/10) fall through
  // as allowed — deliberate homelab/Tailscale policy, see module header.
  return "allowed";
}

/**
 * Parse an IPv6 literal (brackets and zone ids already stripped). Supports
 * "::" compression and embedded IPv4 tails (::ffff:127.0.0.1). Returns a
 * BigInt value or null.
 */
function parseIpv6(text) {
  let t = String(text);
  if (!t || !/^[0-9a-fA-F:.]+$/.test(t)) return null;

  // Fold an embedded IPv4 tail into two hex groups first.
  const v4Tail = t.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (v4Tail) {
    const v4 = parseIpv4Literal(v4Tail[1]);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    t = t.slice(0, t.length - v4Tail[1].length) + hi + ":" + lo;
  }

  if ((t.match(/::/g) || []).length > 1) return null;
  let groups;
  if (t.includes("::")) {
    const [left, right] = t.split("::");
    const leftGroups = left ? left.split(":") : [];
    const rightGroups = right ? right.split(":") : [];
    if (leftGroups.length + rightGroups.length > 7) return null;
    groups = [...leftGroups, ...Array(8 - leftGroups.length - rightGroups.length).fill("0"), ...rightGroups];
  } else {
    groups = t.split(":");
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

function classifyIpv6(value) {
  if (value === 0n) return "blocked"; // :: unspecified
  if (value === 1n) return "loopback"; // ::1
  // IPv4-mapped (::ffff:x.y.z.w — the URL parser normalizes the dotted tail
  // to hex groups, so judge the embedded IPv4 value; this is a live metadata
  // vector: [::ffff:169.254.169.254] connects to the metadata IP).
  if ((value >> 32n) === 0xffffn) return classifyIpv4(Number(value & 0xffffffffn));
  if ((value >> 118n) === 0x3fan) return "blocked"; // fe80::/10 link-local
  if ((value >> 96n) === 0x20010db8n) return "blocked"; // 2001:db8::/32 documentation
  // ULA (fc00::/7) is deliberately allowed — same homelab rationale as RFC1918.
  return "allowed";
}

/* ── Host judging ───────────────────────────────────────────────────── */

function stripZoneAndBrackets(host) {
  let h = String(host || "");
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    h = end === -1 ? h.slice(1) : h.slice(1, end);
  }
  const zone = h.indexOf("%");
  if (zone !== -1) h = h.slice(0, zone);
  return h;
}

function judgeHost(host, { allowLocal = false } = {}) {
  const h = stripZoneAndBrackets(host);
  if (!h) return refusal("unparseable", UNPARSEABLE_MESSAGE);

  if (h.includes(":")) {
    const v6 = parseIpv6(h);
    if (v6 === null) return refusal("unparseable", UNPARSEABLE_MESSAGE);
    const cls = classifyIpv6(v6);
    if (cls === "loopback") return allowLocal ? { ok: true } : refusal("blocked-range", BLOCKED_RANGE_MESSAGE);
    if (cls !== "allowed") return refusal("blocked-range", BLOCKED_RANGE_MESSAGE);
    return { ok: true };
  }

  const v4 = parseIpv4Literal(h);
  if (v4 !== null) {
    const cls = classifyIpv4(v4);
    if (cls === "loopback") return allowLocal ? { ok: true } : refusal("blocked-range", BLOCKED_RANGE_MESSAGE);
    if (cls !== "allowed") return refusal("blocked-range", BLOCKED_RANGE_MESSAGE);
    return { ok: true };
  }

  const name = h.toLowerCase().replace(/\.$/, "");
  if (name === "localhost") {
    return allowLocal ? { ok: true } : refusal("blocked-range", BLOCKED_RANGE_MESSAGE);
  }
  return { ok: true };
}

// The authority straight from the raw string (URL parsers normalize hostile
// literals like 0x7f000001 — judging the raw spelling too closes any gap
// between parser grammars).
function extractRawHost(rawUrl) {
  const m = String(rawUrl).match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/?#:]*)/);
  return m ? m[1] : null;
}

/* ── §5.5 — the proxy-pool gate ─────────────────────────────────────── */

const POOL_SCHEME_MESSAGE = "Only http://, https:// or socks5:// proxy URLs are allowed";
const POOL_BLOCKED_MESSAGE = "That proxy URL points at a reserved local range and is not allowed";
const POOL_UNPARSEABLE_MESSAGE = "Proxy URL could not be parsed";
const POOL_MISSING_MESSAGE = "Proxy URL is missing or empty";
const POOL_LOOPBACK_NAME_MESSAGE =
  "Use a literal loopback address (127.0.0.1 or ::1) rather than a hostname — a name can resolve to anything";

/**
 * Is this host a LITERAL loopback address — 127.0.0.0/8 or ::1 — judged numerically?
 *
 * Deliberately narrow: it returns false for the NAME "localhost" and for every other
 * hostname. That is the whole of the §5.5 DNS-rebinding defence. A name can be made to
 * resolve to 127.0.0.1 (or to 169.254.169.254) at connect time, and nothing this module
 * can see distinguishes a benign `clash.internal` from a rebinding one — so the exemption
 * is granted only where there is no resolution step to subvert. A literal cannot rebind.
 *
 * Hostile spellings are covered for free because this runs on the same numeric parsers
 * the provider gate uses: `127.1`, `0x7f000001`, `017700000001` and `[::1]` all parse to
 * loopback and are all exempt, exactly as a correctly-typed `127.0.0.1` is.
 */
function isLiteralLoopbackHost(host) {
  const h = stripZoneAndBrackets(host);
  if (!h) return false;

  if (h.includes(":")) {
    const v6 = parseIpv6(h);
    return v6 !== null && classifyIpv6(v6) === "loopback";
  }

  const v4 = parseIpv4Literal(h);
  return v4 !== null && classifyIpv4(v4) === "loopback";
}

/**
 * Validate a proxy-pool `proxyUrl` at create/update.
 *
 * A SEPARATE FUNCTION FROM validateProviderTestUrl ON PURPOSE, though it reuses every
 * internal (parseIpv4Literal / parseIpv6 / classifyIpv4 / classifyIpv6 / judgeHost /
 * extractRawHost) so the hostile-literal armour is written once. Three reasons the two
 * laws cannot share one signature — each measured, not assumed:
 *
 *   1. SCHEME. validateProviderTestUrl refuses everything but http(s). Pools legitimately
 *      dial socks5:// — `VALID_PROXY_TYPES` includes it, proxyFetch has had a
 *      Socks5ProxyAgent branch since v0.9.4, and proxy-pools/route.js:3-9 records that
 *      v0.9.42 specifically FIXED socks5 pools being uncreatable. Gating pools through
 *      the provider function would re-open that wound, and the ADR's own
 *      `127.0.0.1:7890` example fails on scheme before loopback is ever considered.
 *
 *   2. THE LOOPBACK EXEMPTION. `allowLocalLoopback` is NOT a loopback exemption — it is
 *      a total bypass: `if (opts.allowLocalLoopback === true) return { ok: true, url: raw }`
 *      returns before host judging AND before the scheme gate, so with that flag set
 *      `http://169.254.169.254/` and even `file:///etc/passwd` both pass. Measured. It
 *      is set by nobody in live source today, which is why this gate does not become its
 *      first consumer. `allowLocal` is closer but still admits the NAME `localhost`,
 *      which §5.5 excludes for the rebinding reason above. So the exemption is built
 *      here, narrowly, rather than reused.
 *
 *   3. THE RANGE POLICY IS ALREADY RIGHT. RFC1918 / CGNAT / ULA are deliberately allowed
 *      by classifyIpv4/classifyIpv6 (module header :26-30) because a homelab gateway's
 *      proxies live on exactly those ranges. That is inherited unchanged, and it is why
 *      this gate delegates to judgeHost rather than reimplementing ranges.
 *
 * ACCEPTED WITH RATIONALE (ADR §5.5): an authenticated operator may point a pool at any
 * loopback service on their own gateway. The operator is the trust root of their own
 * installation — that is configuration, not SSRF. What is NOT accepted is an operator
 * value reaching cloud metadata or a non-network scheme, which is what the refusals below
 * still prevent.
 *
 * RESIDUAL, DOCUMENTED NOT HIDDEN: the DNS-rebinding TOCTOU the provider surface accepts
 * (header :51-61) applies here too, and is arguably weightier — a pool URL is dialed on
 * every request rather than once for a test. A hostname pool whose DNS later resolves to
 * 169.254.169.254 would connect. Mitigation is unchanged from the provider surface and
 * equally cheap from here: resolve-and-pin. Not done in §5.5.
 *
 * Returns { ok: true, url } or { ok: false, code, message } with code one of
 * "scheme" | "blocked-range" | "loopback-name" | "unparseable".
 */
export function validateProxyPoolUrl(rawUrl) {
  const raw =
    typeof rawUrl === "string" ? rawUrl.trim() : rawUrl == null ? "" : String(rawUrl).trim();
  if (!raw) return refusal("unparseable", POOL_MISSING_MESSAGE);

  // A bare "host:port" is what proxyFetch's normalizeProxyUrl accepts, so it is judged
  // here the same way — prefixed — rather than refused. Two reasons this cannot just be
  // handed to `new URL` directly: `new URL("127.0.0.1:7890")` does NOT throw, it parses
  // "127.0.0.1:" as the SCHEME and yields an EMPTY hostname, so the host would never be
  // judged at all. Prefixing is what makes the value judgeable, and it keeps operators
  // who type the short form working instead of getting a new 400.
  const candidate = raw.includes("://") ? raw : `http://${raw}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return refusal("unparseable", POOL_UNPARSEABLE_MESSAGE);
  }

  // Exactly the three schemes proxyFetch can dial. `socks:` is excluded on purpose:
  // undici's Socks5ProxyAgent accepts socks:// but proxyFetch routes to it only on
  // /^socks5:\/\//i, so a socks:// pool would be handed to ProxyAgent and fail with
  // "Invalid URL protocol" at dispatch time — a pool that saves and then cannot work.
  // Judging the schemes that actually reach a dispatcher keeps the gate honest.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "socks5:") {
    return refusal("scheme", POOL_SCHEME_MESSAGE);
  }

  const hostname = parsed.hostname;

  // The exemption, first and narrowest: a LITERAL loopback address walks through. This
  // is checked before judgeHost because judgeHost refuses loopback unconditionally, and
  // before the name check below because a literal is never a name.
  if (isLiteralLoopbackHost(hostname)) return { ok: true, url: candidate };

  // The name "localhost" is refused WITH ITS OWN CODE rather than lumped into
  // blocked-range. It is almost certainly what the operator meant by a local proxy, and
  // a generic "reserved range" message would send them looking in the wrong place. The
  // fix is one keystroke — 127.0.0.1 — and the message says so.
  const bare = stripZoneAndBrackets(hostname).toLowerCase().replace(/\.$/, "");
  if (bare === "localhost") return refusal("loopback-name", POOL_LOOPBACK_NAME_MESSAGE);

  // Everything else goes through the same hostile-literal path the provider gate uses,
  // with allowLocal FALSE: metadata (169.254/16), unspecified (0.0.0.0/8, ::), link-local
  // (fe80::/10) and documentation (2001:db8::/32) are refused, while RFC1918 / CGNAT /
  // ULA and ordinary hostnames are allowed.
  const gate = judgeHost(hostname, { allowLocal: false });
  if (!gate.ok) {
    return refusal(gate.code, gate.code === "scheme" ? POOL_SCHEME_MESSAGE : POOL_BLOCKED_MESSAGE);
  }

  // Judge the RAW spelling too, as the provider gate does: URL parsers normalize some
  // hostile literals, and the gap between grammars is where a bypass hides. A raw host
  // that is a literal loopback is exempt on the same narrow terms.
  const rawHost = extractRawHost(candidate);
  if (rawHost !== null && rawHost !== hostname) {
    if (isLiteralLoopbackHost(rawHost)) return { ok: true, url: candidate };
    if (stripZoneAndBrackets(rawHost).toLowerCase().replace(/\.$/, "") === "localhost") {
      return refusal("loopback-name", POOL_LOOPBACK_NAME_MESSAGE);
    }
    const rawGate = judgeHost(rawHost, { allowLocal: false });
    if (!rawGate.ok) {
      return refusal(rawGate.code, rawGate.code === "scheme" ? POOL_SCHEME_MESSAGE : POOL_BLOCKED_MESSAGE);
    }
  }

  return { ok: true, url: candidate };
}

/* ── Public API ─────────────────────────────────────────────────────── */

/**
 * Validate a full provider-test URL.
 *
 * Options:
 *   allowLocalLoopback — bypass the range checks entirely. Reserved for
 *     internal callers (model pings). Operator routes never set it.
 *   allowLocal — loosen the LOOPBACK block only (localhost / 127/8 / ::1).
 *     Source it from allowLocalTestingFor(); metadata/link-local stay blocked.
 *
 * Returns { ok: true, url } or { ok: false, code, message } where code is
 * one of "scheme" | "blocked-range" | "unparseable" (the 400-class refusal).
 */
export function validateProviderTestUrl(rawUrl, opts = {}) {
  const raw = typeof rawUrl === "string" ? rawUrl.trim() : rawUrl == null ? "" : String(rawUrl).trim();
  if (!raw) return refusal("unparseable", MISSING_MESSAGE);
  if (opts.allowLocalLoopback === true) return { ok: true, url: raw };

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return refusal("unparseable", UNPARSEABLE_MESSAGE);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return refusal("scheme", SCHEME_MESSAGE);
  }

  const judgeOpts = { allowLocal: opts.allowLocal === true };
  // Judge BOTH the parsed hostname and the raw authority spelling — refuse
  // on either (covers backslash/userinfo/parser-normalization tricks).
  const gate = judgeHost(parsed.hostname, judgeOpts);
  if (!gate.ok) return gate;
  const rawHost = extractRawHost(raw);
  if (rawHost !== null && rawHost !== parsed.hostname) {
    const rawGate = judgeHost(rawHost, judgeOpts);
    if (!rawGate.ok) return rawGate;
  }

  return { ok: true, url: parsed.href };
}

/**
 * Validate an operator baseUrl (no path assumed). Appends a probe path so a
 * bare "http://169.254.169.254" still parses as a URL, judges it, and hands
 * back the normalized base (trailing slashes stripped) for the caller to
 * suffix. Returns { ok, baseUrl, url } or a refusal shape.
 */
export function validateProviderTestBaseUrl(rawBaseUrl, opts = {}) {
  const PROBE = "/__vela_ssrf_probe__";
  const base = typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : rawBaseUrl == null ? "" : String(rawBaseUrl).trim();
  if (!base) return refusal("unparseable", MISSING_MESSAGE);
  const result = validateProviderTestUrl(base.replace(/\/+$/, "") + PROBE, opts);
  if (!result.ok) return result;
  return { ok: true, baseUrl: result.url.slice(0, -PROBE.length), url: result.url };
}

/**
 * Judge a redirect hop: resolve the Location header against the request URL
 * and re-validate the target with the same rules (never loopback-allowed).
 * Returns { ok: true, url } or a refusal shape with hop-phrased messages.
 */
export function extractHopTarget(locationHeader, requestUrl) {
  const loc = String(locationHeader || "").trim();
  if (!loc) return refusal("unparseable", "Redirect target is missing");
  let target;
  try {
    target = new URL(loc, requestUrl);
  } catch {
    return refusal("unparseable", "Redirect target could not be parsed");
  }
  const checked = validateProviderTestUrl(target.href);
  if (!checked.ok) {
    const hopMessage =
      checked.code === "blocked-range"
        ? "Redirect target is in a reserved local range and is not allowed"
        : checked.code === "scheme"
          ? "Redirect target uses a disallowed URL scheme"
          : "Redirect target could not be parsed";
    return refusal(checked.code, hopMessage);
  }
  return { ok: true, url: checked.url };
}

/**
 * Fetch with per-hop redirect validation. Sends redirect:"manual", inspects
 * each 3xx Location through extractHopTarget(), follows allowed hops (max 3),
 * and throws ProviderUrlSafetyError on a blocked/unparseable hop or loop.
 * Extra args after options are passed through to fetchFn (callers use this
 * to forward the connection proxy config).
 */
export async function probeWithHopValidation(url, fetchFn, options = {}, ...rest) {
  const fn = typeof fetchFn === "function" ? fetchFn : globalThis.fetch;
  let current = String(url);
  const seen = new Set();

  for (let hops = 0; ; hops += 1) {
    if (seen.has(current)) {
      throw new ProviderUrlSafetyError("blocked-range", "Provider test fetch was redirected in a loop");
    }
    seen.add(current);

    const res = await fn(current, { ...options, redirect: "manual" }, ...rest);
    const status = res?.status ?? 0;
    const isRedirect = status >= 300 && status < 400;
    if (!isRedirect) return res;

    const location = res?.headers?.get ? res.headers.get("location") : null;
    if (!location) return res; // nothing to judge — caller classifies the 3xx

    try { res?.body?.cancel?.(); } catch { /* best-effort body release */ }

    if (hops >= MAX_REDIRECT_HOPS) {
      throw new ProviderUrlSafetyError("blocked-range", "Provider test fetch followed too many redirects");
    }
    const next = extractHopTarget(location, current);
    if (!next.ok) throw new ProviderUrlSafetyError(next.code, next.message);
    current = next.url;
  }
}

/**
 * The operator opt-in for genuinely-local test targets (ollama-local etc.).
 * True only when the connection's providerSpecificData carries
 * vela_allow_local === true, or VELa_ALLOW_LOCAL_TESTING is "1"/"true".
 * Loosens loopback ONLY — never metadata/link-local.
 */
export function allowLocalTestingFor({ env = process.env, connection = null } = {}) {
  try {
    if (connection?.providerSpecificData?.vela_allow_local === true) return true;
    const flag = env?.VELA_ALLOW_LOCAL_TESTING;
    return flag === "1" || flag === "true";
  } catch {
    return false;
  }
}
