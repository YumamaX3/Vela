// Storage Covenant Wave B2 / Proxy Fleet Rebirth milestone 1 (§5.4) —
// the READ-side proxy credential masker.
//
// WHY THIS IS NOT backupSecurity.js
// `redactSecretConnectionData` whole-redacts a userinfo URL to "[REDACTED]", and
// that behaviour is PINNED by export-redaction-m0.test.js:243 — a restored pool
// must fail LOUD on its sentinel rather than silently connect unauthenticated. A
// dashboard read wants the opposite trade: keep the identifying part (host:port)
// so an operator can tell pools apart, drop only the credential. Two different
// laws, so two functions. The export sentinel is unchanged and remains the single
// source of truth for artifacts.
//
// WHERE MASKING MAY LIVE — AND WHERE IT MUST NOT
//
// THE LAW: mask at the edge, never at the well.
//
// This masker belongs at HTTP read boundaries ONLY. It must never be applied in the
// repo layer, because internal readers need the PLAINTEXT url to build a dispatcher —
// masking the repo would silently break every proxied request, or worse, fall back to
// direct egress. The repo is the source of truth; the HTTP layer is the untrusted edge.
// The internal readers live in proxyFleet.js, connectionProxy.js, poolEgressProbe.js,
// auth.js and relayDeploy.js — files, no total, because the total moves (see below).
//
// THE CENSUS IS DELIBERATELY NOT ENUMERATED HERE. Six drafts of this comment tried to
// list the sites and every one was wrong — the first cited a COMMENT line
// (connectionProxy.js:86) instead of its read site; a fix listed four internal readers
// instead of ten-plus; the next called "the three providers routes" pool maskers when
// those routes mask the CONNECTION's providerSpecificData and client/route.js reads no
// pool at all; the fourth said ten boundary reads "need a masker" when only five
// emissions carry pool data; the fifth counted four emissions instead of five because
// the list GET has two branches; the sixth put a TOTAL on the internal readers, and a
// total cannot be reproduced mid-release — relayDeploy.js lands in a later commit than
// this file, so the grep below returns fewer readers against this commit's tree than
// against the shipped v0.9.45. An enumeration drifts on the next edit AND on the next
// commit; either way it reads as authority while pointing at nothing. So re-derive it:
//
//   grep -rnE "getProxyPools\(|getProxyPoolById\(" src open-sse --include=*.js
//
// and ask each hit the only question that matters: does this read put proxyUrl ON THE
// WIRE? Most do not — they are existence checks (returning a 404 or just a poolId),
// internal duplicate comparisons, or dispatcher construction.
//
// WHAT THE SHIPPED v0.9.45 LOOKS LIKE, stated as a SHAPE and not a count, because
// every count this comment tried was tree-dependent: each masked emission goes through
// maskProxyPool(s)ForRead, and the list GET has TWO branches (plain and
// usage-enriched) so counting routes instead of branches is what made an earlier draft
// wrong. To verify the shape at whatever tree you are reading, the grep above gives you
// the reads; then for each one ask whether the value reaches a NextResponse. The claim
// worth holding is the invariant — no pool proxyUrl crosses an HTTP boundary unmasked —
// not how many places currently do it.
//
// TWO were checked rather than assumed, because "reads the pool row" and "leaks the
// pool row" are different claims and only the second matters:
//   • proxy-pools/export/route.js projects an explicit allow-list (id, name, type,
//     isActive) and never emits proxyUrl at all.
//   • proxy-pools/[id]/test/route.js hands the raw row to testPoolReachability and
//     returns verdict/status/error/elapsedMs. Its `error` was probed EMPIRICALLY at
//     every shape undici produces here — ProxyAgent constructor throw, ECONNREFUSED,
//     ENOTFOUND, socks5, timeout: undici reports host:port for diagnosis but never the
//     userinfo. So proxyFetch.js, not this probe, was the right home for the §5.4-err
//     masker, and this route needed none.
//
// NOTE the two credential classes are masked by different functions on purpose:
// `maskProxyPoolForRead` covers a POOL's proxyUrl; `maskConnectionForRead` /
// `maskConnectionProxyForRead` cover a CONNECTION's providerSpecificData
// .connectionProxyUrl. The three providers routes are in the second group.
//
// WHY THERE IS NO DEDUPE TOKEN ON THE WIRE
// The first cut of this module emitted `proxyUrlDedupeToken` so the dashboard's
// batch-import could detect an existing pool without holding plaintext. It was
// dropped before it shipped, because both available mechanisms fail:
//   • A BARE sha256(proxyUrl) is an offline brute-force oracle. §5.1 keeps
//     GET /api/proxy-pools posture-consistent, so a REMOTE UNAUTHENTICATED caller
//     still reaches it under requireLogin===false (measured, probe row B). Proxy
//     password spaces are short; a salt-free digest of the url is cheap to crack,
//     which would partly defeat this module's own purpose.
//   • A KEYED HMAC is safe but the client cannot compute it — the secret stays
//     server-side — so it cannot compare against what the operator just typed.
// Dedupe therefore moved SERVER-SIDE (see findDuplicateProxyPool), where the
// plaintext already lives. That is strictly more exact than a hash comparison and
// it closes a real gap: before this change there was NO server-side duplicate
// check at all, so two operators, or one operator in two tabs, could create the
// same pool. It also removes any dependence on `crypto.subtle`, which does not
// exist outside a secure context — and docker-compose.example.yml:73/:94 bind
// 32060 on all interfaces with BASE_URL http://localhost:32060, so plain-http
// LAN access is the documented norm (the house already guards this shape at
// BasicChatPageClient.js:16).
/** Credentials ride a proxy url as userinfo: scheme://user:pass@host:port.
 *  Same shape backupSecurity.js's URL_USERINFO_RE names. */
const USERINFO_RE = /^[a-z][a-z0-9+.-]*:\/\/[^@/?#]+@/i;

/**
 * Drop the userinfo credential from a proxy url, keeping scheme://host:port and
 * any path/query. Returns a NEW string; never mutates.
 *
 *   http://u:p@203.0.113.7:1080      →  http://203.0.113.7:1080/
 *   socks5://u:p@203.0.113.8:1080    →  socks5://203.0.113.8:1080
 *   http://203.0.113.9:3128          →  unchanged (no credential to drop)
 *
 * The trailing slash on the first case is WHATWG canonicalisation
 * (`new URL("http://h:1").toString() === "http://h:1/"`), not a bug. Do not
 * "tidy" it with string surgery — parsing is what guarantees no credential
 * fragment survives, and hand-editing the output is how one leaks back in.
 *
 * Unparseable input is the one case where "keep what I can identify" cannot
 * apply: if the platform cannot parse it I cannot tell where the credential
 * ends, so a value carrying userinfo redacts WHOLE rather than risk leaking a
 * fragment. A value with no userinfo passes through — there was never a secret
 * in it (the proxy stack tolerates a bare "host:port", which proxyFleet's
 * probeEgress prefixes itself).
 */
export function maskProxyUrlForRead(url) {
  if (typeof url !== "string") return url;
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    // A parsed URL exposes username/password separately, so dropping them is
    // exact — no string surgery, no risk of leaving a fragment behind.
    if (!parsed.username && !parsed.password) return trimmed;
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return USERINFO_RE.test(trimmed) ? "[REDACTED]" : trimmed;
  }
}

/**
 * Mask one proxy-pool object for an HTTP read boundary. Returns a NEW object —
 * the input row is never mutated, because the repo hands out live objects that
 * a caller may still need in plaintext.
 *
 * `noProxy` is deliberately NOT masked: it is a bypass list, not a credential,
 * and the dashboard displays it. `lastError` needs no masking either — measured,
 * not assumed: undici's failure strings carry the host:port only
 * ("Connect Timeout Error (attempted address: 203.0.113.7:1080, ...)") and never
 * userinfo, and proxyTest.js interpolates exactly those into the error it
 * stores.
 *
 * §5.2 — `relayToken` is DELETED, and the deletion is the whole design:
 *   • It is the only readable copy of a secret that all three platform stores are
 *     write-only about (Vercel "sensitive" is never decryptable, Cloudflare's
 *     GET …/secrets omits the value, Deno omits `value` when secret:true).
 *   • It is replaced with NO derived marker. A `relayAuthEnabled: true` flag would
 *     read nicer, but updateProxyPool MERGES ({...rowToPool(row), ...data}), so any
 *     field this masker emits can be round-tripped straight back into the row by a
 *     form that posts what it was given — the same second-order destroy-hazard that
 *     made §5.4's proxyUrl masking need omission instead of substitution. The UI
 *     already has what it needs: relayVersion >= 2 means the relay is protected.
 *   • `relayVersion` is deliberately KEPT. It is a protocol marker, not a secret,
 *     and hiding it would break the one signal that keeps a v1 relay from being
 *     sent a token it would forward upstream.
 */
export function maskProxyPoolForRead(pool) {
  if (!pool || typeof pool !== "object") return pool;
  const masked = { ...pool };
  masked.proxyUrl = maskProxyUrlForRead(pool.proxyUrl);
  if ("relayToken" in masked) delete masked.relayToken;
  return masked;
}

/** Mask a list of pools. Non-array input passes through untouched. */
export function maskProxyPoolsForRead(pools) {
  if (!Array.isArray(pools)) return pools;
  return pools.map(maskProxyPoolForRead);
}

/**
 * Mask the per-connection legacy proxy credential inside providerSpecificData.
 * `connectionProxyUrl` carries the SAME credential class as a pool's proxyUrl
 * (proxy-pools/page.js:483 parses host:port:user:pass into that url form for
 * pools, and providers/route.js:167 persists it per connection), so §5.4's scope
 * covers it — the Star's decree 2026-09-03 pulled it into this same commit.
 *
 * Returns a NEW psd object; one without the field is returned untouched, so this
 * never invents a key on a connection that never had a proxy.
 */
export function maskConnectionProxyForRead(psd) {
  if (!psd || typeof psd !== "object") return psd;
  if (!("connectionProxyUrl" in psd)) return psd;
  const out = { ...psd };
  out.connectionProxyUrl = maskProxyUrlForRead(psd.connectionProxyUrl);
  return out;
}

/**
 * Mask a whole connection row for an HTTP read boundary: the top-level secret
 * fields the routes each deleted by hand, PLUS the nested legacy proxy
 * credential.
 *
 * The four provider read surfaces each carried their own copy of
 * `delete result.apiKey; delete result.accessToken; ...` — and providers/route.js
 * set them to `undefined` instead of deleting, a third variant of the same law.
 * One shared function replaces the copies; LIVE-B's lesson is that a duplicated
 * guard drifts.
 */
export function maskConnectionForRead(connection) {
  if (!connection || typeof connection !== "object") return connection;
  const out = { ...connection };
  for (const f of ["apiKey", "accessToken", "refreshToken", "idToken"]) {
    if (f in out) delete out[f];
  }
  // §5.2d — `relayAuth` rides the TOP LEVEL of a synthesized credential, never
  // providerSpecificData (that blob is persisted wholesale by
  // updateProviderCredentials, which would write the secret into a second table).
  // No route returns a synthesized credential today — they return connection rows —
  // so this delete is defence for a route that does not exist yet. It is here
  // because "safe because the field is not there" beats "safe because no caller
  // happens to serialize this object shape".
  if ("relayAuth" in out) delete out.relayAuth;
  if (out.providerSpecificData) {
    out.providerSpecificData = maskConnectionProxyForRead(out.providerSpecificData);
  }
  return out;
}

/**
 * Server-side duplicate detection for proxy pools — the replacement for the
 * dashboard's client-side Set, which masking would have broken.
 *
 * Comparison is on the TRIMMED PLAINTEXT url, exactly the semantics the client
 * key had (`${proxyUrl.trim()}|||${noProxy.trim()}` at page.js:530). It is
 * deliberately a constant-time-free string equality: the candidate comes from
 * an authenticated-or-local caller (POST is gated by §5.1), and this is a
 * duplicate check, not a credential comparison.
 *
 * Returns the FIRST existing pool whose url matches, or null. Callers must not
 * put the returned row on the wire unmasked — it carries the stored credential.
 *
 * @param {Array} existingPools rows already in the store
 * @param {string} candidateUrl the url the caller is trying to create
 */
export function findDuplicateProxyPool(existingPools, candidateUrl) {
  if (!Array.isArray(existingPools)) return null;
  if (typeof candidateUrl !== "string") return null;
  const candidate = candidateUrl.trim();
  if (!candidate) return null;
  return existingPools.find((p) => {
    if (!p || typeof p.proxyUrl !== "string") return false;
    return p.proxyUrl.trim() === candidate;
  }) || null;
}

/**
 * A masked, leak-safe duplicate marker for a 409 body. Never the stored url, and
 * never the stored row — the caller learns that a duplicate exists and which id
 * to look at, nothing else.
 */
export function duplicatePoolMarker(existingPool) {
  return {
    error: "PROXY_POOL_ALREADY_EXISTS",
    message: "A proxy pool with this URL already exists.",
    existingPoolId: existingPool?.id ?? null,
    existingPoolName: existingPool?.name ?? null,
  };
}
