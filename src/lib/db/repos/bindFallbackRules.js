/**
 * bindFallbackRules — Seam 2 binding helper (Resilience Covenant v0.9.16)
 *
 * The fallbackRulesRepo facade exposes (db, ...) signatures. The combo engine
 * (open-sse/services/combo.js) expects a repo object whose methods take only
 * the model string. This helper binds the current adapter into a repo-shaped
 * closure — and caches the bound repo across calls so the hot chat path never
 * re-resolves the adapter on every request.
 *
 * Fail-open: any adapter failure returns a null repo — the combo engine treats
 * null as "no rules" and proceeds byte-identical to hardcoded behavior.
 */
import { getAdapter } from "@/lib/db/driver.js";
import * as fallbackRulesRepo from "@/lib/db/repos/fallbackRulesRepo.js";

let repoCache = null;

export function getFallbackRulesRepo() {
  if (repoCache) return repoCache;

  try {
    const db = getAdapter();
    if (!db) return null;

    repoCache = {
      getRulesForSourceModel: (sourceModel) => fallbackRulesRepo.getRulesForSourceModel(db, sourceModel),
      getFallbackRules: (options = {}) => fallbackRulesRepo.getFallbackRules(db, options),
    };
  } catch (err) {
    console.warn("[bindFallbackRules] adapter unavailable, fallback rules disabled:", err.message);
    return null;
  }

  return repoCache;
}

/** Test seam — drop the cached binding (e.g. after the adapter swaps). */
export function resetFallbackRulesRepo() {
  repoCache = null;
}

export default getFallbackRulesRepo;
