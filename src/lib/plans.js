// Plan templates — the shared vocabulary for the plans registry.
//
// A plan is a TEMPLATE of key policy. The key's own columns win wherever they
// are set; a plan only supplies the values a key leaves null. That law is
// enforced in sse/services/planDefaults.js, and it is why these fields mirror
// the key columns exactly instead of inventing a second budget vocabulary.

export const PLAN_PERIODS = ["daily", "weekly", "monthly", "yearly"];

const MAX_NAME = 200;
const MAX_DESCRIPTION = 2000;
const MAX_MODELS = 100;

function intOrNull(value, label, errors) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    errors.push(`${label} must be zero (unlimited) or a positive integer`);
    return null;
  }
  return n;
}

/** Merge a partial write onto a base plan and validate the result.
 *  Returns { ok, plan } or { ok: false, errors }. */
export function validatePlan(input = {}, base = {}) {
  const errors = [];
  const plan = { ...base };

  if (input.name !== undefined) plan.name = String(input.name ?? "").trim();
  if (!plan.name) errors.push("name is required");
  else if (plan.name.length > MAX_NAME) errors.push(`name must be ${MAX_NAME} characters or fewer`);

  if (input.description !== undefined) {
    plan.description = String(input.description ?? "").trim();
    if (plan.description.length > MAX_DESCRIPTION) {
      errors.push(`description must be ${MAX_DESCRIPTION} characters or fewer`);
    }
  }

  if (input.limitTokens !== undefined) plan.limitTokens = intOrNull(input.limitTokens, "limitTokens", errors);
  if (input.spendCapCents !== undefined) plan.spendCapCents = intOrNull(input.spendCapCents, "spendCapCents", errors);
  if (input.rpmLimit !== undefined) plan.rpmLimit = intOrNull(input.rpmLimit, "rpmLimit", errors);

  if (input.period !== undefined) {
    const period = String(input.period ?? "").trim();
    if (!PLAN_PERIODS.includes(period)) {
      errors.push(`period must be one of: ${PLAN_PERIODS.join(", ")}`);
    } else plan.period = period;
  }
  if (!plan.period) plan.period = "monthly";

  if (input.allowedModels !== undefined) {
    const models = Array.isArray(input.allowedModels)
      ? [...new Set(input.allowedModels.map((m) => String(m).trim()).filter(Boolean))]
      : null;
    if (models && models.length > MAX_MODELS) errors.push(`allowedModels may hold at most ${MAX_MODELS} entries`);
    else plan.allowedModels = models && models.length ? models : null;
  }

  return errors.length ? { ok: false, errors } : { ok: true, plan };
}
