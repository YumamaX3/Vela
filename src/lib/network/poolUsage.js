/**
 * The pool→connection usage census, in one place.
 *
 * This helper began life inside `api/proxy-pools/route.js`. When the census route
 * (`api/proxy-pools/stats`) needed the same count, the first instinct was to
 * export it from that route file — the duplication defect the bulk-health route
 * already paid for is real, and a second copy would drift exactly the same way.
 * But a Next route module may only export HTTP verbs and a small set of config
 * symbols: `next build` type-checks that index signature, and an extra export
 * fails the build with "Property 'buildUsageMap' is incompatible with index
 * signature". The build is right and the export was wrong.
 *
 * So the helper lives here, where every other proxy helper already lives, and
 * both routes import it. One copy, no drift, and the route modules keep the
 * signature Next requires.
 */

/** Count how many provider connections each proxy pool is bound to. */
export function buildUsageMap(connections = []) {
  const usageMap = new Map();
  for (const connection of connections) {
    const proxyPoolId = connection?.providerSpecificData?.proxyPoolId;
    if (!proxyPoolId) continue;
    usageMap.set(proxyPoolId, (usageMap.get(proxyPoolId) || 0) + 1);
  }
  return usageMap;
}
