/**
 * Pool egress geo — in-memory registry shared by the dashboard (proxy-pools
 * egress column) and provider region policy. Pattern: MIBP's poolGeo, seam-
 * native into Vela's proxyFleet (which already probes egress on demand).
 *
 * State lives on globalThis (same convention as __velaProxyState__ and the
 * circuit breaker store) so Next dev (Turbopack) never splits one Map into
 * several per-bundle copies — the background probe and the /api reader must
 * share the SAME registry.
 *
 * Fail-open: every getter returns null on missing/stale entries; the probe
 * loop never blocks startup or requests.
 */

const GEO_STATE_KEY = "__velaPoolGeo__";
const geoCache = (globalThis[GEO_STATE_KEY] ??= new Map()); // poolId -> { ip, country, region, city, org, ts, ipHistory }

export const POOL_GEO_TTL_MS = 60 * 60 * 1000;
// How many past egress IPs to remember for flapping detection.
export const POOL_GEO_IP_HISTORY_MAX = 8;

/** Test helper: drop all cached geo. */
export function resetPoolGeo() {
  geoCache.clear();
}

// Attach stability classification: >=2 distinct egress IPs observed = flapping
// (typical for serverless relays — Vercel/Cloudflare egress varies per colo).
function withStability(entry) {
  const ips = new Set([entry?.ip, ...(entry?.ipHistory || []).map((h) => h.ip)]);
  ips.delete("");
  const ipCount = ips.size;
  return { ...entry, ipCount, isUnstable: ipCount >= 2 };
}

export function getPoolGeo(poolId) {
  const entry = geoCache.get(poolId);
  if (!entry) return null;
  if (entry.ts + POOL_GEO_TTL_MS < Date.now()) {
    geoCache.delete(poolId);
    return null;
  }
  return withStability(entry);
}

export function setPoolGeo(poolId, geo) {
  if (!poolId || !geo?.ip) return;
  const prev = geoCache.get(poolId);
  const ipHistory = prev?.ipHistory ? [...prev.ipHistory] : [];
  if (prev?.ip && prev.ip !== geo.ip) {
    // Record the IP we are leaving — the history tracks past egress IPs.
    ipHistory.push({ ip: prev.ip, ts: Date.now() });
    if (ipHistory.length > POOL_GEO_IP_HISTORY_MAX) ipHistory.shift();
  }
  geoCache.set(poolId, { ...geo, ts: Date.now(), ipHistory });
}

export function poolGeoSnapshot(now = Date.now()) {
  const out = {};
  for (const [poolId, entry] of geoCache) {
    if (entry.ts + POOL_GEO_TTL_MS <= now) {
      geoCache.delete(poolId);
      continue;
    }
    out[poolId] = withStability(entry);
  }
  return out;
}

// Sweep geo entries past their TTL (ipHistory rides along with the entry).
// Returns how many entries were removed.
export function pruneStaleGeo(now = Date.now()) {
  let removed = 0;
  for (const [poolId, entry] of geoCache) {
    if (entry.ts + POOL_GEO_TTL_MS <= now) {
      geoCache.delete(poolId);
      removed += 1;
    }
  }
  return removed;
}

export const __test__ = { geoCache };
