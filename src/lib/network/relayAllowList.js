// Storage Covenant Wave B2 / Proxy Fleet Rebirth milestone 1 (§5.2) —
// the deploy-time target allow-list for a relay.
//
// WHY DERIVED AT DEPLOY TIME AND BAKED INTO THE SOURCE
// The relay runs on a third-party edge with no database and no callback into Vela,
// so it cannot ask "is this host allowed?" at request time. The list has to travel
// with the code. Changing it therefore requires a re-deploy — which is why the
// dashboard surfaces the count, so an operator who adds a provider knows a relay
// re-deploy is owed.
//
// WHY THE WALK IS DEPTH-FIRST AND NOT `transport.baseUrl`
// Measured, not assumed. A first pass read only `transport.baseUrl` and reported 38
// registry entries as host-less. That was wrong: `baseUrl` lives in SEVEN places
// across the 127 entries — transport (104), imageConfig (17), ttsConfig (16),
// searchConfig (9), sttConfig (4), videoConfig (1), plus top-level/other (30).
// Reading one path measured my assumption instead of the registry. So this walks
// every nested object for any `baseUrl` string key.
//
// WHY DB-DERIVED HOSTS ARE FOLDED IN
// Registry hosts alone deny real traffic. Five classes have no derivable host:
//   • azure            — baseUrl is "" because the operator supplies the endpoint
//   • aws-polly        — https://polly.{region}.amazonaws.com, region unknown at deploy
//   • antigravity, topaz — no baseUrl key at all
//   • edge-tts, google-tts, local-device — not URLs; in-process/local executors
//   • EVERY custom node and EVERY operator-overridden baseUrl — open-sse/executors/
//     default.js:111/:117/:163 read providerSpecificData.baseUrl, a DB row
// providerNodes.baseUrl is a real column (nodesRepo.js) and per-connection
// providerSpecificData.baseUrl carries the overrides, so both tables are folded in.
//
// WHY A DB FAILURE MUST NOT FAIL THE DEPLOY
// These reads are best-effort. An empty or unreachable database yields the registry
// list, not an exception — a relay deploy should not be blocked by a cold DB, and
// the alternative (failing closed to an EMPTY allow-list) would brick the relay.
import { getProviderConnections, getProviderNodes } from "@/models";
import { PROBE_HOST } from "./relayTemplate.js";

// Lazy require of the registry: it is 127 pure-data modules (only shared.js, which
// imports just `os`), but no API route imported it before this, so it is resolved at
// call time rather than at module eval — a registry problem must not take the whole
// deploy route's module graph down at boot.
let registryCache = null;

async function loadRegistry() {
  if (registryCache) return registryCache;
  const mod = await import("../../../open-sse/providers/registry/index.js");
  const list = mod?.default ?? mod?.ALL_PROVIDERS ?? [];
  registryCache = Array.isArray(list) ? list : Object.values(list);
  return registryCache;
}

/** Collect every `baseUrl` string in an object tree, at any depth. Bounded so a
 *  cyclic or absurdly nested entry cannot hang a deploy. */
function collectBaseUrls(node, out, depth = 0) {
  if (depth > 8 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) collectBaseUrls(v, out, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "baseUrl" && typeof v === "string") out.push(v);
    else if (v && typeof v === "object") collectBaseUrls(v, out, depth + 1);
  }
}

/**
 * Turn a baseUrl-ish string into a hostname, or null.
 *
 * Rejects empties and template URLs (`{region}`, `${...}`) — a template's host is
 * not known until runtime, and baking the literal `polly.{region}.amazonaws.com`
 * would be an entry that can never match. Those providers are covered by the
 * DB-derived pass instead, where the operator's actual value lives.
 */
export function hostFromBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string") return null;
  const trimmed = baseUrl.trim();
  if (!trimmed || trimmed.includes("${") || trimmed.includes("{")) return null;

  // Two shapes must be told apart, and `new URL` alone cannot do it — both of the
  // traps below were measured, not predicted:
  //
  //   • A SCHEMELESS "host:port" needs a scheme prepended. But it does NOT reliably
  //     throw without one: `new URL("api.example.com:8443")` parses `api.example.com:`
  //     as a SCHEME and `8443` as the pathname, returning a valid URL with an EMPTY
  //     hostname, while `new URL("203.0.113.7:3128")` does throw (an IPv4 host is not
  //     a legal scheme). So a retry keyed on `catch` silently dropped the dotted
  //     hostname — the more common self-hosted shape.
  //   • An EXPLICIT non-HTTP scheme must be refused, and must NOT be retried. Retrying
  //     `file:///etc/passwd` as `http://file:///etc/passwd` yields hostname `"file"` —
  //     a fabricated entry that can never match a real relay target and pollutes the
  //     baked allow-list.
  //
  //   • A BARE WORD that is not a host at all must not be retried either. The
  //     registry carries three provider protocol markers as baseUrl — `edge-tts`,
  //     `google-tts`, `local-device` — which are how an executor selects a code path,
  //     not addresses. Retrying `edge-tts` as `http://edge-tts` yields hostname
  //     "edge-tts", so all three would be baked as entries that can never match.
  //     Measured across all 127 registry entries: a rule requiring a dot or a colon
  //     on this branch drops exactly those three and NO real host, because every
  //     genuine bare target carries a port (`host:port`) or a dotted name.
  //
  // The discriminator for the first trap is the presence of "://". A URL that states
  // its scheme has it; a bare host:port does not. That splits the two cleanly without
  // guessing from digit shapes.
  if (trimmed.includes("://")) {
    try {
      const u = new URL(trimmed);
      // Only http(s) is a relay target. The relay's own isAllowedTarget refuses every
      // other scheme, so baking a host from one would be an entry that can never match.
      // This also drops the registry's `devin-cli://` and `devin-cli-pro://` entries,
      // which are ACP transports rather than HTTP endpoints.
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      return u.hostname || null;
    } catch {
      return null;
    }
  }

  // Schemeless: require the shape of an address before synthesising one.
  if (!trimmed.includes(".") && !trimmed.includes(":")) return null;

  try {
    const host = new URL(`http://${trimmed}`).hostname;
    return host || null;
  } catch {
    return null;
  }
}

/** Hosts derivable from the provider registry. Never throws. */
export async function registryHosts() {
  const hosts = new Set();
  try {
    const entries = await loadRegistry();
    for (const entry of entries) {
      const urls = [];
      collectBaseUrls(entry, urls);
      for (const url of urls) {
        const host = hostFromBaseUrl(url);
        if (host) hosts.add(host);
      }
    }
  } catch (error) {
    // Surfaced, not swallowed: a relay deployed on a silently-empty registry list
    // would 403 everything, and the operator deserves to know why.
    console.warn("[relayAllowList] registry derivation failed:", error?.message || error);
  }
  return hosts;
}

/**
 * Hosts derivable from the database: custom nodes plus per-connection baseUrl
 * overrides. Best-effort — a cold or unreachable DB yields nothing rather than
 * failing the deploy.
 */
export async function dbHosts() {
  const hosts = new Set();
  try {
    const nodes = await getProviderNodes();
    for (const node of nodes ?? []) {
      const host = hostFromBaseUrl(node?.baseUrl);
      if (host) hosts.add(host);
    }
  } catch (error) {
    console.warn("[relayAllowList] providerNodes read failed:", error?.message || error);
  }

  try {
    const connections = await getProviderConnections();
    for (const conn of connections ?? []) {
      const psd = conn?.providerSpecificData;
      if (!psd || typeof psd !== "object") continue;
      const host = hostFromBaseUrl(psd.baseUrl);
      if (host) hosts.add(host);
    }
  } catch (error) {
    console.warn("[relayAllowList] providerConnections read failed:", error?.message || error);
  }

  return hosts;
}

/**
 * Build the allow-list to bake into a relay: registry hosts + DB-derived hosts +
 * the health-probe host, deduped and sorted for a stable, diffable payload.
 *
 * PROBE_HOST is not optional. proxyTest.js:10-11 probes every relay against
 * `https://httpbin.org/get`, so a relay whose baked allow-list omits this host
 * answers the fleet's own health sweep with 403 — permanently, on every sweep.
 *
 * WHAT THAT ACTUALLY COSTS, MEASURED. 403 is NOT in DETERMINISTIC_FAILURE_STATUSES
 * (proxyTest.js:199 = {400,404,410}), so classifyProbeVerdict returns
 * "indeterminate", and checkAllPools auto-disables only on "dead"
 * (proxyFleet.js:796). The pool therefore survives — but it can never be confirmed
 * ALIVE either. The operator watches a healthy relay sit forever unconfirmed with no
 * error explaining why, which is the same permanent-indeterminate symptom §5.2e
 * closes on the auth side. (An earlier version of this comment claimed the pool would
 * self-liquidate as DEAD; that is false and was corrected against the classifier.)
 *
 * THE FOUR GEO-PROBE HOSTS ARE DELIBERATELY ABSENT. poolEgressProbe.js probes each
 * pool's egress IP against ipwho.is / ip-api.com / ipapi.co / ipinfo.io. They are not
 * baked here, and a future reader should NOT add them to "make the allow-list
 * complete" until the egress probe is relay-aware — because it is not, today:
 * poolEgressProbe.js:70 builds `{enabled, url, strictProxy}` with NO vercelRelayUrl,
 * so for a relay pool proxyAwareFetch takes the CONNECT-dispatcher path instead of the
 * relay envelope (the very confusion testRelayUrl's own docblock warns against). Those
 * four hosts therefore never arrive as x-relay-target for a relay, so allowing them
 * would widen the attack surface to buy nothing. That probe is a PRE-EXISTING
 * functional wound (a relay pool's egress geo reads as a failure), not a §5.2 one, and
 * it touches no security path — the sweep never writes isActive, so nothing
 * self-liquidates. Fixing it is its own milestone; adding these hosts is not the fix.
 *
 * Returns { hosts, source } where `source` records which pass contributed what, so
 * the deploy route can surface an honest count and a cold DB is visible rather than
 * silently narrowing the list.
 */
export async function buildRelayAllowList({ includeProbe = true } = {}) {
  const fromRegistry = await registryHosts();
  const fromDb = await dbHosts();

  const all = new Set([...fromRegistry, ...fromDb]);
  if (includeProbe) all.add(PROBE_HOST);

  return {
    hosts: [...all].sort(),
    source: {
      registry: fromRegistry.size,
      database: fromDb.size,
      probe: includeProbe ? 1 : 0,
      total: all.size,
    },
  };
}
