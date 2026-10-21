// Plan defaults — the inheritance law at the gate.
//
// A key that names a plan inherits that plan's unset limits. The key's own
// columns always win where set, so an operator can tighten one key without
// forking the template. Reads are cached for 5s (same TTL as the gate's other
// caches): plan edits are rare, but a cached template must never outlive a
// revocation by long.
//
// FAIL-OPEN on storage errors, deliberately: a template is governance, not
// identity. An unreadable plan must not deny every request on that key — the
// key's own limits still apply, and the gate says nothing it cannot prove.
import { getPlan } from "@/lib/db/repos/plansRepo.js";

const TTL_MS = 5_000;
const cache = new Map();

function cachedPlan(planId, now) {
  const hit = cache.get(planId);
  if (hit && now - hit.ts <= TTL_MS) return hit.plan;
  return null;
}

async function loadPlan(planId) {
  const now = Date.now();
  const hit = cachedPlan(planId, now);
  if (hit !== null) return hit;
  try {
    const plan = await getPlan(planId);
    cache.set(planId, { plan, ts: now });
    if (cache.size > 500) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return plan;
  } catch {
    return null;
  }
}

/** Apply a plan's defaults to a resolved key. Returns the same object when the
 *  key has no plan or the plan cannot be read. */
export async function applyPlanDefaults(key) {
  if (!key?.planId) return key;
  const plan = await loadPlan(key.planId);
  if (!plan) return key;

  const out = { ...key };
  if (out.tokenBudgetDaily == null && plan.limitTokens != null) out.tokenBudgetDaily = plan.limitTokens;
  if (out.spendCapDailyCents == null && plan.spendCapCents != null) out.spendCapDailyCents = plan.spendCapCents;
  if (out.rateLimitRpm == null && plan.rpmLimit != null) out.rateLimitRpm = plan.rpmLimit;
  if (!out.budgetScope && plan.period) out.budgetScope = plan.period;
  if (out.allowedModels == null && Array.isArray(plan.allowedModels) && plan.allowedModels.length) {
    out.allowedModels = plan.allowedModels;
  }
  out.plan = { id: plan.id, name: plan.name };
  return out;
}

/** Test seam — forget every cached template. */
export function clearPlanCache() {
  cache.clear();
}
