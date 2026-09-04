/**
 * bindFallbackRules — Seam 2 binding helper (Resilience Covenant v0.9.16)
 *
 * The fallbackRulesRepo facade exposes (db, ...) signatures. The combo engine
 * (open-sse/services/combo.js) expects a repo object whose methods take only
 * the model string. This helper binds the current adapter into a repo-shaped
 * closure — and caches the bound repo across calls so the hot chat path never
 * re-resolves the adapter on every request.
 *
 * ⚠️ THE ASYNC LAW — read before changing this file.
 * `getAdapter()` in src/lib/db/driver.js is declared `async`, so calling it
 * without `await` returns a PROMISE, not an adapter. A Promise is truthy, so a
 * `if (!db) return null` guard cannot catch it; the failure surfaces much later
 * and much further away, as `db.all is not a function` from inside the sqlite
 * twin — swallowed by the combo engine's catch and logged as "fallback-rules
 * lookup failed, using hardcoded defaults". This file shipped that way in
 * v0.9.16 and operator-defined combo fallback rules never once applied until
 * v0.9.46 fixed it. The binder is therefore `async`, and every caller awaits it.
 * Re-derive the call sites with:
 *   grep -rn "getFallbackRulesRepo(" src open-sse --include=*.js
 * Every one must be `await`ed, and every enclosing function must be `async`.
 *
 * Fail-open: any adapter failure returns a null repo — the combo engine treats
 * null as "no rules" and proceeds byte-identical to hardcoded behavior. For that
 * promise to be TRUE rather than decorative, the failure has to be detected
 * HERE, at bind time — hence the shape assertion below. Binding a repo around a
 * non-adapter and letting it throw later is not fail-open; it is fail-late, and
 * it hides the cause behind the combo engine's warning.
 *
 * Only a SUCCESSFUL bind is memoized. Caching a null would permanently disable
 * operator rules for the process lifetime if the very first request happened to
 * arrive before the adapter finished initializing — a race this file cannot
 * control. An unsuccessful bind retries on the next call. The warning is latched
 * so a genuinely broken adapter logs once rather than once per request.
 */
import { getAdapter } from "@/lib/db/driver.js";
import * as fallbackRulesRepo from "@/lib/db/repos/fallbackRulesRepo.js";

let repoCache = null;
let warnLatched = false;

/** One warning per process, no matter how many requests fail to bind. */
function warnOnce(reason) {
  if (warnLatched) return;
  warnLatched = true;
  console.warn("[bindFallbackRules] fallback rules disabled:", reason);
}

/**
 * Bind the current adapter into a repo-shaped closure.
 *
 * @returns {Promise<{getRulesForSourceModel: Function, getFallbackRules: Function}|null>}
 *   The bound repo, or null when the adapter is unavailable or malformed. Null
 *   is the documented fail-open: the combo engine proceeds with hardcoded
 *   rotation, byte-identical to a deployment that has no rules configured.
 */
export async function getFallbackRulesRepo() {
  if (repoCache) return repoCache;

  let db;
  try {
    db = await getAdapter();
  } catch (err) {
    warnOnce(`adapter unavailable (${err?.message || err})`);
    return null;
  }

  // Shape assertion — the guard that makes fail-open real. BOTH bound paths
  // reach exactly one adapter method: db.all (sqlite/fallbackRulesRepo.js —
  // getFallbackRules and getRulesForSourceModel; getFallbackRuleById uses db.get
  // but is NOT bound here, so asserting .get would refuse to bind over a defect
  // that cannot affect these closures). Asserting only what is used keeps the
  // failure surface as narrow as the truth. It still catches a Promise, a null,
  // and any future adapter that stops exposing the portable surface. Never assert
  // on db.prepare — the adapter contract forbids it (the v0.9.19 boot storm).
  // If this binder grows a third method, grow this assertion in the same breath.
  if (!db || typeof db.all !== "function") {
    warnOnce(
      `adapter is malformed (expected .all — got ${
        db ? typeof db : String(db)
      }); check that getAdapter() is awaited`
    );
    return null;
  }

  repoCache = {
    getRulesForSourceModel: (sourceModel) => fallbackRulesRepo.getRulesForSourceModel(db, sourceModel),
    getFallbackRules: (options = {}) => fallbackRulesRepo.getFallbackRules(db, options),
  };

  return repoCache;
}

/** Test seam — drop the cached binding and re-arm the warning (e.g. after the adapter swaps). */
export function resetFallbackRulesRepo() {
  repoCache = null;
  warnLatched = false;
}

export default getFallbackRulesRepo;
