import { getProxyPoolById } from "@/models";

// Safely normalize any value into a trimmed string.
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// ─── Proxy pool rotation state (in-memory) ─────────────────────────
const rotateState = new Map(); // providerId → { index }

/**
 * Pick one proxy pool ID from a list based on strategy.
 * round-robin: cycle sequentially (in-memory, resets on restart)
 * random:      uniform random pick
 * none/single: return first entry
 */
export function pickProxyPoolId(poolIds, strategy, providerId) {
  if (!poolIds || poolIds.length === 0) return null;
  if (poolIds.length === 1) return poolIds[0];

  if (strategy === "round-robin") {
    const state = rotateState.get(providerId) || { index: -1 };
    state.index = (state.index + 1) % poolIds.length;
    rotateState.set(providerId, state);
    return poolIds[state.index];
  }

  if (strategy === "random") {
    return poolIds[Math.floor(Math.random() * poolIds.length)];
  }

  return poolIds[0]; // "none" or unknown
}

/**
 * The unified proxyOptions payload, built in ONE place.
 *
 * WHY THIS EXISTS. Ten call sites each hand-built a near-identical five-key literal
 * from a resolved proxy config, and quotaAutoPing.js:96 had already grown its own
 * local copy of exactly that builder — the LIVE-B drift shape (bulk-health kept its
 * own pre-v0.9.42 loop and diverged from the repaired checkAllPools). Adding a
 * sixth key to ten literals is how one of them gets missed, and the key being added
 * here is a security-relevant one.
 *
 * THE ONE THING THIS FUNCTION MUST NEVER DO: read the secret out of
 * `providerSpecificData`. That blob is persisted wholesale into the connections row
 * by updateProviderCredentials (tokenRefresh.js:177-182), so a relay secret living
 * there would be written plaintext to a second table. `relayAuth` therefore rides the
 * TOP LEVEL of a resolved config and of a synthesized credential, and
 * maskConnectionForRead deletes it at the HTTP read boundary. The single read below
 * is `cfg.relayAuth` and nothing else — there is deliberately no psd fallthrough, so
 * a secret that somehow did land in psd would be withheld rather than forwarded.
 * Withholding is the safe failure direction; leaking is not.
 *
 * @param {object|null} cfg a resolved proxy config from resolveConnectionProxyConfig
 *   (relayAuth/relayVersion top-level), or a synthesized credential (same two names,
 *   stamped top-level by auth.js). Every one of the call sites passes one of these
 *   two shapes; the four proxy fields are read by name from whichever it is.
 * @param {{strictProxy?: boolean}} [opts] strictProxy override — the usage/quota
 *   paths force false so quota reads degrade to direct rather than fail hard.
 * @returns {object} the unified proxyOptions payload for proxyAwareFetch
 */
export function buildProxyOptionsPayload(cfg, { strictProxy } = {}) {
  const relayAuth = normalizeString(cfg?.relayAuth);
  return {
    connectionProxyEnabled: cfg?.connectionProxyEnabled === true,
    connectionProxyUrl: normalizeString(cfg?.connectionProxyUrl),
    connectionNoProxy: normalizeString(cfg?.connectionNoProxy),
    vercelRelayUrl: normalizeString(cfg?.vercelRelayUrl),
    // Default true (preserve the source's own value) unless the caller overrides.
    // The five dashboard/quota sites pass false explicitly; the two model-resolver
    // sites preserve `=== true`, which is what the default does here.
    strictProxy: strictProxy === undefined ? cfg?.strictProxy === true : strictProxy === true,
    // The version gate itself lives in relayAuthHeaders (relayTemplate.js), next to
    // RELAY_VERSION, so the caller side and the relay side cannot drift apart. What
    // this builder guarantees is only that BOTH values travel together — a secret
    // without its version would read as v1 and be withheld, and a version without
    // its secret would send nothing. Neither is wrong, but pairing them here means
    // no payload site can disagree about which one it carries.
    //
    // The sites, MEASURED at v0.9.45 rather than remembered: TEN payload sites, of which
    // SIX go through this builder — providers/[id]/models/route.js:400,
    // providers/[id]/test/testUtils.js:465, usage/[connectionId]/codex-reset-credits/route.js:67,
    // usage/[connectionId]/route.js:150, lib/modelsList.js:203,
    // shared/services/quotaAutoPing.js:195 — and FOUR hand-build a literal:
    //   • chatCore.js:377          relay-capable, carries relayAuth/relayVersion (two objects)
    //   • testUtils.js:488         non-relay branch — sets no vercelRelayUrl, cannot reach a relay
    //   • poolEgressProbe.js:70    passes `url:` not `vercelRelayUrl:` — never enters the relay branch
    //   • proxyFleet.js:655/:660   same shape, same reason (probeEgress)
    // The last two are why "ten" was right and an intermediate draft of this comment
    // saying "eight" was wrong: it had only counted the two hand-built sites in files this
    // tide touched, and missed the two egress probes it did not. Count them again before
    // editing this sentence — `grep -rn "buildProxyOptionsPayload(" src open-sse` for the
    // six, and `grep -rnE "(const|let) proxyOptions = \{|proxyAwareFetch\([^;]*, \{ enabled:"`
    // for the literals. Both halves are needed; either one alone undercounts.
    relayAuth,
    relayVersion: Number(cfg?.relayVersion) || 1,
  };
}

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl = normalizeString(
    providerSpecificData?.connectionProxyUrl
  );

  const connectionNoProxy = normalizeString(
    providerSpecificData?.connectionNoProxy
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool
 * 2. Legacy Proxy
 * 3. No Proxy
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData = {}
) {
  try {
    const proxyPoolIdRaw = normalizeString(
      providerSpecificData?.proxyPoolId
    );

    // "__none__" means explicitly disabled
    const proxyPoolId =
      proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (proxyPoolId) {
      const proxyPool = await getProxyPoolById(proxyPoolId);

      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);

      const isValidPool =
        proxyPool &&
        proxyPool.isActive === true &&
        proxyUrl;

      if (isValidPool) {
        /**
         * Vercel/Cloudflare relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
        if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno") {
          return {
            source: proxyPool.type,

            proxyPoolId,
            proxyPool,

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: proxyPool.strictProxy === true,

            vercelRelayUrl: proxyUrl, // Still mapped to vercelRelayUrl in the unified payload since they use the exact same header spec

            // §5.2d — the relay's bearer secret and its protocol version.
            //
            // THE CHANNEL IS LOAD-BEARING. These two fields are emitted at the TOP
            // LEVEL of the resolved config and must never be copied into a
            // credential's `providerSpecificData`. Measured, not assumed:
            // `updateProviderCredentials` (tokenRefresh.js:177-182) spreads
            // `providerSpecificData` wholesale into the connections row, and
            // `mergedCreds` (tokenRefresh.js:244) feeds it the synthesized
            // credential's own psd — so a secret stamped there would be written
            // plaintext into a SECOND table, unredacted, undoing §5.2b's whole
            // design on a different blob. The same function reads only eleven named
            // top-level keys and `relayAuth` is not among them, which is what makes
            // the top level a transient channel.
            //
            // `getProxyPoolById` returns the RAW row (the read masker fires only at
            // HTTP boundaries — proxy-pools/route.js:121, [id]/route.js:73/:115),
            // so the token is genuinely available here.
            //
            // `relayVersion` defaults to 1 for every pool that predates §5.2, and
            // that default is the transition guard: the caller sends x-relay-auth
            // ONLY at >= 2, because a v1 relay forwards all headers and would hand
            // the secret straight to the upstream provider.
            relayAuth: normalizeString(proxyPool?.relayToken),
            relayVersion: Number(proxyPool?.relayVersion) || 1,
          };
        }

        /**
         * Standard proxy pool
         */
        return {
          source: "pool",

          proxyPoolId,
          proxyPool,

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: proxyPool.strictProxy === true,
        };
      }
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (
      legacy.connectionProxyEnabled &&
      legacy.connectionProxyUrl
    ) {
      return {
        source: "legacy",

        proxyPoolId: proxyPoolId || null,
        proxyPool: null,

        ...legacy,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
    return {
      source: "none",

      proxyPoolId: proxyPoolId || null,
      proxyPool: null,

      ...legacy,
    };
  } catch (error) {
    console.error(
      "[resolveConnectionProxyConfig] Failed to resolve proxy config:",
      error
    );

    return {
      source: "error",

      proxyPoolId: null,
      proxyPool: null,

      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",

      strictProxy: false,
    };
  }
}
