// Provider strategy merge — one law for every writer of providerStrategies.
//
// The per-provider override carries THREE families of setting and they are
// written by different cards: fallbackStrategy/stickyRoundRobinLimit by the
// Connections card, proxyPoolId/rotateStrategy by the keyless-lane proxy card.
// Replacing the whole object (the old behaviour) meant toggling Round Robin
// erased the proxy pool, and choosing a pool erased the strategy — each card
// silently undoing the other. This helper merges one patch into the existing
// override and deletes a provider entry only when nothing is left in it.
//
// `null`, `undefined`, and "" all mean "remove this field" — that is how the
// UI spells "back to global/none". An absent field is never written.

export function mergeProviderStrategy(strategies, providerId, patch = {}) {
  const next = { ...(strategies || {}) };
  const override = { ...(next[providerId] || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") delete override[key];
    else override[key] = value;
  }
  if (Object.keys(override).length) next[providerId] = override;
  else delete next[providerId];
  return next;
}
