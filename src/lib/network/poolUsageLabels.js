/**
 * The pool LABEL projection — the only pool-derived shape a telemetry read may
 * put on the wire.
 *
 * Proxy Console Separation W2b · §3.4 — the posture law. The Usage lens buckets
 * usageHistory rows by `poolId`, but a bare uuid is not a name an operator can
 * read. So the analytics route joins a label map: { id, name, type } and NOTHING
 * else. No proxyUrl, no host, no credential — the row never crosses the boundary,
 * only its three identifying fields, all of which the console already renders in
 * plain sight. Safe BY CONSTRUCTION (same argument as the stats census), so the
 * route needs no masker; the structural test walks the wire for `proxyUrl` and
 * any `scheme://` string and finds neither.
 *
 * THE LAW'S EDGE: the masker (proxyRedaction.js) exists for reads that DO emit a
 * pool object; this helper exists so this read never needs one. Two different
 * mechanisms for two different claims — "mask the credential" versus "never carry
 * it". The second is strictly stronger and it is the one a posture read earns.
 *
 * An UNKNOWN poolId (a bucket whose pool row was deleted, or a row written before
 * the pool existed) resolves to `{ id, name: null, type: null }` — the bucket is
 * real usage and stays visible; only its label is honestly absent.
 */

const IDENTIFYING_FIELDS = ["id", "name", "type"];

/** Project one pool row to its wire-safe label. `p` is a repo row (flat fields
 *  from rowToPool); a null/malformed row yields null (never thrown). */
export function poolLabel(row) {
  if (!row || typeof row !== "object") return null;
  const out = {};
  for (const f of IDENTIFYING_FIELDS) out[f] = row[f] ?? null;
  return out;
}

/** Build the { poolId → label } map the analytics route attaches. Input is the
 *  full pool list from getProxyPools() — this function is the boundary that
 *  drops everything the label does not need. */
export function buildPoolLabels(pools = []) {
  const map = new Map();
  for (const p of pools || []) {
    const label = poolLabel(p);
    if (label && label.id) map.set(label.id, label);
  }
  return map;
}

/** Resolve a bucket's label, or the honest unknown shape. */
export function resolvePoolLabel(map, poolId) {
  return (map && map.get && map.get(poolId)) || { id: poolId, name: null, type: null };
}

export const __test__ = { IDENTIFYING_FIELDS };
