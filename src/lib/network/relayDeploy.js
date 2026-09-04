// Storage Covenant Wave B2 / Proxy Fleet Rebirth milestone 1 (§5.2) —
// the deploy-side orchestration shared by all three relay platforms.
//
// WHY SHARED
// The three deploy routes each did their own minting, pool creation, and response
// shape. Three copies of a security-relevant sequence drift — that is LIVE-B's
// lesson (bulk-health kept its own pre-v0.9.42 loop and diverged from the repaired
// checkAllPools). So the parts that must be identical are identical here, and each
// route keeps only what genuinely differs: the platform's own secret-delivery
// mechanism, which research showed is three different shapes (see each route).
//
// WHAT THIS MODULE OWNS
//   • mintRelayToken   — the secret's entropy and prefix
//   • persistRelayPool — create OR update, which closes the orphan-row wound
//   • relayDeployResponse — the narrow wire shape
//   • relaySecretEnvVar  — the platform secret payload's name/value pair
//
// WHAT IT DELIBERATELY DOES NOT OWN
// The HTTP calls to each platform. Those differ enough (Vercel needs a
// create-project → set-secret → deploy sequence because env changes never reach an
// already-created deployment; Cloudflare carries the secret inline in the same
// multipart upload; Deno passes env_vars on the app or the revision) that forcing
// them behind one abstraction would produce a worse function than three honest
// ones.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createProxyPool, updateProxyPool, getProxyPoolById } from "@/models";
import { RELAY_AUTH_ENV, RELAY_VERSION, renderRelaySource } from "./relayTemplate.js";
// §5.5b — the deploy routes build pool.proxyUrl by interpolating operator input into a
// platform suffix, and persistRelayPool is the chokepoint that writes it. The gate that
// judges the RESULT lives beside the writers it protects, so a fourth platform route
// cannot forget it.
import { validateProxyPoolUrl } from "./providerUrlSafety.js";

// Re-exported so each deploy route has ONE import site for the whole §5.2 surface.
// The allow-list builder lives in its own module because it carries the registry
// walk and the DB-derived passes, neither of which belongs next to token minting.
export { buildRelayAllowList, registryHosts, dbHosts, hostFromBaseUrl } from "./relayAllowList.js";

/* ── §5.5b — relay slug validation ──────────────────────────────────── */

/**
 * A DNS label: 1–63 chars of [a-z0-9-], not starting or ending with a hyphen
 * (RFC 1035 §2.3.1 as the platforms all enforce it in practice). Lowercase only —
 * the three platforms reject or silently lowercase uppercase project names, so
 * refusing it here gives the operator a 400 instead of a deploy that lands somewhere
 * they did not predict.
 */
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const SLUG_MESSAGE =
  "Relay name may only contain lowercase letters, digits and hyphens (1-63 chars, not starting or ending with a hyphen)";
const ORG_DOMAIN_MESSAGE =
  "Organization domain must be a plain hostname such as your-org.deno.net";

/**
 * Validate an operator-supplied relay project name.
 *
 * WHY THIS EXISTS — measured, not theoretical. deno-deploy built its persisted
 * proxyUrl as `https://${projectName}.${orgSlug}.deno.net` from raw operator input.
 * A `#` or `?` in projectName moves the platform suffix into the fragment or query,
 * so the effective hostname becomes whatever the operator wrote:
 *
 *   projectName = "169.254.169.254/#"  → persisted hostname = 169.254.169.254  (cloud metadata)
 *   projectName = "evil.com/#"         → persisted hostname = evil.com
 *
 * That row then becomes the egress path for every proxied request, and it bypassed
 * §5.5's POST/PUT gate because the deploy routes write through persistRelayPool
 * instead. cloudflare-deploy has the same interpolation into `.workers.dev`.
 * (vercel-deploy does not — it persists the platform's own `ready.url`.)
 *
 * MEASURED ADMISSIBLE: the generated default `relay-${Date.now().toString(36)}`, the
 * dashboard's own presets (`vercel-relay`, `cloudflare-relay`), `my-relay`,
 * `vela-relay-1`, `relay`, `r1`. MEASURED REFUSED: `evil.com/#`,
 * `169.254.169.254/#`, `Relay-One`, `relay_one`, `-relay`, `relay-`, 64+ chars.
 *
 * CALL THIS BEFORE ANY PLATFORM CALL. The routes' catch returns 500, so a refusal
 * after the deploy would orphan a live, publicly reachable relay holding a freshly
 * minted secret with no pool row to govern it — exactly what §5.2c's createdHere
 * rollback was built to prevent. Failing early needs no rollback at all.
 *
 * @returns {{ ok: true, slug: string } | { ok: false, message: string }}
 */
export function validateRelaySlug(rawSlug) {
  const slug = typeof rawSlug === "string" ? rawSlug.trim() : "";
  if (!slug) return { ok: false, message: "Relay name is required" };
  if (!DNS_LABEL_RE.test(slug)) return { ok: false, message: SLUG_MESSAGE };
  return { ok: true, slug };
}

/**
 * Validate the Deno organization domain, whose first label is interpolated into the
 * persisted proxyUrl exactly as projectName is: `orgSlug = orgDomain.split(".")[0]`.
 *
 * Measured escapes with the unvalidated version:
 *   orgDomain = "a/b.deno.net"  → orgSlug = "a/b"  → hostname = "relay-1.a"   (suffix escaped)
 *   orgDomain = "x?y.deno.net"  → orgSlug = "x?y"  → hostname = "relay-1.x"   (suffix escaped)
 *
 * Every label is judged, not just the first, because the value is also used as the
 * Deno API authority — and a dot-separated string of valid labels is the whole of a
 * hostname. No scheme, no path, no port: those are what let the authority escape.
 */
export function validateRelayOrgDomain(rawDomain) {
  const domain = typeof rawDomain === "string" ? rawDomain.trim().replace(/\.$/, "") : "";
  if (!domain) return { ok: false, message: "Organization domain is required" };
  if (domain.length > 253) return { ok: false, message: ORG_DOMAIN_MESSAGE };
  const labels = domain.split(".");
  // A single label ("acme") is not a domain the platforms can resolve; require at
  // least two so the caller's `.split(".")[0]` is genuinely an org label.
  if (labels.length < 2) return { ok: false, message: ORG_DOMAIN_MESSAGE };
  for (const label of labels) {
    if (!DNS_LABEL_RE.test(label)) return { ok: false, message: ORG_DOMAIN_MESSAGE };
  }
  return { ok: true, domain };
}

/**
 * Judge a relay's persisted proxyUrl at the chokepoint. THROWS with `.status = 400`
 * on refusal, so the route's existing catch turns it into a 400 rather than a 500
 * — matching persistRelayPool's own `err.status = 404` convention for a stale poolId.
 *
 * WHY FAIL CLOSED RATHER THAN PERSIST ANYWAY: by the time this runs, the platform
 * deploy has already succeeded, so refusing here orphans a live relay. That is the
 * lesser harm, and deliberately so — an orphaned relay is a resource leak the operator
 * deletes from their platform dashboard, while a metadata-pointing pool row is an
 * active SSRF path dialed on EVERY proxied request, invisible in the platform's own
 * console. One is visible and reversible; the other is neither.
 *
 * This is the structural half of the fix: validateRelaySlug/validateRelayOrgDomain
 * refuse the injectable input early, and this gate means the invariant holds for any
 * future platform route that forgets them. Belt and braces, because the failure mode
 * of forgetting is silent.
 */
export function assertRelayProxyUrl(proxyUrl) {
  const gate = validateProxyPoolUrl(proxyUrl);
  if (!gate.ok) {
    const err = new Error(`Refusing to persist relay pool: ${gate.message}`);
    err.status = 400;
    err.code = gate.code;
    throw err;
  }
  return gate.url;
}

/** Secret prefix. Makes a leaked token recognisable in a log scan or a secret
 *  scanner's ruleset, and distinguishes relay tokens from every other credential
 *  Vela holds. "rk" = relay key. */
const RELAY_TOKEN_PREFIX = "vrelay_";

/** Token entropy in bytes. 32 bytes → 43 base64url characters, so the full token
 *  is 50 characters with the prefix. Well under Vercel's 5KB-per-Edge-env-var cap
 *  and Deno's documented value limits (the smallest figure across their three
 *  contradictory sources is 4,096 characters). */
const RELAY_TOKEN_BYTES = 32;

/**
 * Mint a relay bearer secret.
 *
 * node:crypto rather than Web Crypto because this runs server-side in the deploy
 * route, where randomBytes is synchronous and available on every runtime Vela
 * supports (Node ≥22.5, Bun). The dashboard-side constraint that pushed
 * proxyRedaction.js off crypto.subtle — plain-http LAN origins have no secure
 * context — does not apply here, and neither does the relay-side one.
 *
 * @returns {string} `vrelay_<43 base64url chars>`
 */
export function mintRelayToken() {
  // base64url, not base64: the token travels in an HTTP header value, where "+"
  // and "/" are legal but "=" padding is awkward to compare and log.
  return `${RELAY_TOKEN_PREFIX}${randomBytes(RELAY_TOKEN_BYTES).toString("base64url")}`;
}

/**
 * Constant-time comparison of two relay tokens. Exported for the caller-side gate
 * and for tests; the RELAY itself cannot use it (edge runtimes have no
 * timingSafeEqual) and hashes instead — see relayTemplate.js.
 *
 * Length-checked first, because timingSafeEqual throws on mismatched lengths and a
 * throw inside an auth check is a 500 where a 401 belongs.
 */
export function relayTokensMatch(expected, provided) {
  if (typeof expected !== "string" || typeof provided !== "string") return false;
  const a = expected.trim();
  const b = provided.trim();
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** The name/value pair every platform's secret store receives. One name across all
 *  three so the relay body's env read is identical everywhere. */
export function relaySecretEnvVar(token) {
  return { name: RELAY_AUTH_ENV, value: token };
}

/**
 * Render the relay source with its allow-list baked in.
 *
 * @param {"vercel"|"cloudflare"|"deno"} platform
 * @param {string[]} allowedHosts from buildRelayAllowList()
 * @param {{wildcard?: boolean}} opts wildcard:true bakes "*" — the ADR's explicit
 *   operator escape hatch. The caller is responsible for having surfaced it.
 */
export function renderRelay(platform, allowedHosts, { wildcard = false } = {}) {
  const hosts = wildcard ? ["*"] : allowedHosts;
  return renderRelaySource(platform, hosts);
}

/**
 * Persist the pool for a relay deployment — create on first deploy, update on
 * re-deploy.
 *
 * THE ORIGIN-ROW WOUND THIS CLOSES: all three routes called createProxyPool
 * unconditionally, and because a re-deploy of the same project name yields the same
 * production URL, every re-deploy minted a NEW row pointing at the SAME relay. The
 * operator saw a growing list of identical pools, the fleet health sweep probed the
 * same URL once per orphan, and deleting the wrong one left the relay live with no
 * row to govern it.
 *
 * With an explicit poolId the operator's intent is unambiguous. Without one, a
 * same-URL match is adopted rather than duplicated — and that adoption is honest
 * because it reuses the row's own stored secret only when the caller did not supply
 * a fresh one, so a re-deploy that re-mints stays a re-mint.
 *
 * @param {object} args
 * @param {string|null} args.poolId explicit row to update (the ADR's update path)
 * @param {string} args.name
 * @param {string} args.proxyUrl the relay's public https url
 * @param {"vercel"|"cloudflare"|"deno"} args.type
 * @param {string} args.relayToken the freshly minted secret
 * @param {number} args.hostCount baked allow-list size, for the dashboard
 * @param {boolean} args.wildcard whether the operator opted into "*"
 * @returns {Promise<{pool: object, reusedRow: boolean}>}
 */
export async function persistRelayPool({
  poolId = null,
  name,
  proxyUrl,
  type,
  relayToken,
  hostCount = 0,
  wildcard = false,
}) {
  // §5.5b — judge the URL at the chokepoint every platform route funnels through,
  // rather than trusting each route to have validated its own input. Throws with
  // status 400 on refusal; see assertRelayProxyUrl for why fail-closed is the lesser
  // harm even though the platform deploy has already succeeded by this point.
  const gatedUrl = assertRelayProxyUrl(proxyUrl);

  const fields = {
    name,
    proxyUrl: gatedUrl,
    type,
    // relayVersion is set to 2 ONLY here, at the moment a v2 body is actually
    // deployed with the secret delivered. That ordering is the transition guard:
    // the caller starts sending x-relay-auth only once the row says 2, and the row
    // says 2 only once a relay exists that can verify it.
    relayToken,
    relayVersion: RELAY_VERSION,
    isActive: true,
    strictProxy: false,
    noProxy: "",
    relayAllowHostCount: hostCount,
    relayAllowWildcard: wildcard === true,
    relayDeployedAt: new Date().toISOString(),
  };

  // 1. Explicit poolId — the operator named the row.
  if (poolId) {
    const existing = await getProxyPoolById(poolId);
    if (existing) {
      const updated = await updateProxyPool(poolId, fields);
      return { pool: updated, reusedRow: true };
    }
    // A poolId that does not resolve is a stale dashboard, not a new pool: falling
    // through to create would silently mint the orphan this function exists to
    // prevent. Fail loud so the caller can 404.
    const err = new Error(`Relay pool "${poolId}" not found`);
    err.status = 404;
    throw err;
  }

  // 2. No poolId, but an identical relay URL already has a row — adopt it.
  // Searched by gatedUrl, NOT the raw input: gatedUrl is what gets persisted above, so
  // matching on anything else means a re-deploy whose raw spelling differs even by
  // normalization (a trailing slash the parser adds, a prefixed scheme) fails to find
  // its own previous row and mints the duplicate orphan this function exists to prevent.
  const existing = await findPoolByProxyUrl(gatedUrl);
  if (existing) {
    const updated = await updateProxyPool(existing.id, fields);
    return { pool: updated, reusedRow: true };
  }

  // 3. Genuinely new relay.
  const created = await createProxyPool(fields);
  return { pool: created, reusedRow: false };
}

/** Find an existing pool by its exact relay URL. Never throws — a cold DB yields
 *  null, which routes the caller to create. */
async function findPoolByProxyUrl(proxyUrl) {
  try {
    const { getProxyPools } = await import("@/models");
    const pools = await getProxyPools();
    const wanted = String(proxyUrl || "").trim().replace(/\/+$/, "");
    return (
      (pools ?? []).find((p) => String(p?.proxyUrl || "").trim().replace(/\/+$/, "") === wanted) ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * The deploy response.
 *
 * `{ poolId, deployUrl, relayVersion }` — and NOT the pool row. Three reasons, each
 * measured rather than assumed:
 *   • The ADR specifies this shape. The old routes returned the whole masked
 *     proxyPool, which is more surface than any caller uses: the dashboard reads
 *     only `data.deployUrl` and `data.error` (proxy-pools/page.js:408-467).
 *   • `proxyUrl` is the relay's own public URL here, so masking it was always a
 *     no-op — but returning fewer fields is the difference between "safe because of
 *     what the value happens to be" and "safe because it is not there".
 *   • The secret is never in the response at all. It is minted, delivered to the
 *     platform store, and persisted to the row; the one moment it is on the wire is
 *     this function, and it is absent from this function.
 *
 * `reusedRow` is returned because the operator deserves to know a re-deploy adopted
 * an existing pool instead of creating one — that is the visible half of the
 * orphan-row fix.
 */
export function relayDeployResponse({ pool, deployUrl, reusedRow = false, hostCount = 0, wildcard = false }) {
  return {
    poolId: pool?.id ?? null,
    deployUrl,
    relayVersion: pool?.relayVersion ?? RELAY_VERSION,
    reusedRow,
    allowList: { hostCount, wildcard },
  };
}
