// Budget-definition primitives shared by the gate (enforcement, W3-B), the
// quotaRepo (validation + persistence, W3-A), and the dashboard (config UI).
// Kept here — never importing the adapter — so repos/sqlite and repos/mysql
// twins share one frozen vocabulary. The keyLimits.js precedent.
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W3 GOVERNANCE):
// "scopes gateway|key|model, windows day|week|month, 50/80/100 soft + hard
// cap distinct 429".

// ── The frozen vocabulary ──────────────────────────────────────────────────
// A budget binds ONE scope to ONE subject:
//   gateway → subject null   — the whole gateway's traffic
//   key     → subject keyId  — one API key's traffic
//   model   → subject model  — one model's traffic (provider/model form,
//                              alias-resolved, same shape keyGate's
//                              modelScopeStage matches)
export const QUOTA_SCOPES = ["gateway", "key", "model"];

// Reset cadence. keyGate's per-key budgetScope already speaks
// daily|weekly|monthly|yearly (W3 key governance) — the Observatory budget
// hierarchy is a SEPARATE instrument with its own vocabulary, so the two
// never collide in one table/scope.
export const QUOTA_WINDOWS = ["day", "week", "month"];

// Soft thresholds — alerts fire when usage crosses these percentages of the
// cap (W3-C channels: banner, Discord webhook, n8n webhook, with hysteresis).
// Frozen by the sealed plan; validation rejects other shapes.
export const QUOTA_THRESHOLDS = [50, 80, 100];

// Hard-cap denial codes — one per scope so a caller can tell WHICH ceiling
// it hit (the "distinct 429" obligation). The legacy per-key spend stage
// keeps its own budget_exceeded code (keyGate.GATE_CODES.BUDGET_EXCEEDED).
export const QUOTA_CODES = {
  gateway: "gateway_budget_exceeded",
  key: "key_budget_exceeded",
  model: "model_budget_exceeded",
};

/** Build the budget id — the kv key and the stable cross-reference. */
export function budgetId(scope, subject) {
  if (scope === "gateway") return "gateway:*";
  return `${scope}:${subject}`;
}

// ── Write-side validation ──────────────────────────────────────────────────

export class BudgetValidationError extends Error {
  constructor(errors) {
    super(errors.join("; "));
    this.name = "BudgetValidationError";
    this.errors = errors;
  }
}

const INT_CAP_FIELDS = ["tokenCap", "spendCapCents"];

// DoS rails: a subject is a keyId or provider/model — both short. Capping
// keeps a hostile writer from bloating the kv scope (the gate reads the whole
// list on every authorization). The repo enforces MAX_BUDGETS definitions.
export const MAX_SUBJECT_LENGTH = 256;
export const MAX_BUDGETS = 200;

/**
 * Validate + normalize a budget definition. Returns { ok: true, value } or
 * { ok: false, errors }. Every rule is honest in its message — a 400 from the
 * API route repeats these verbatim.
 */
export function validateBudgetDefinition(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return { ok: false, errors: ["budget definition must be an object"] };
  }

  const scope = input.scope;
  if (!QUOTA_SCOPES.includes(scope)) {
    errors.push(`scope must be one of: ${QUOTA_SCOPES.join(", ")}`);
  }

  let subject = null;
  if (scope === "key") {
    if (!input.subject || typeof input.subject !== "string" || !input.subject.trim()) {
      errors.push("a key budget requires subject = the keyId it governs");
    } else if (input.subject.trim().length > MAX_SUBJECT_LENGTH) {
      errors.push(`key budget subject must be ≤ ${MAX_SUBJECT_LENGTH} characters`);
    } else subject = input.subject.trim();
  } else if (scope === "model") {
    if (!input.subject || typeof input.subject !== "string" || !input.subject.trim()) {
      errors.push("a model budget requires subject = the model it governs (provider/model form)");
    } else if (input.subject.trim().length > MAX_SUBJECT_LENGTH) {
      errors.push(`model budget subject must be ≤ ${MAX_SUBJECT_LENGTH} characters`);
    } else subject = input.subject.trim();
  } else if (scope === "gateway" && input.subject != null) {
    errors.push("the gateway budget takes no subject — it governs all traffic");
  }

  const window = input.window;
  if (!QUOTA_WINDOWS.includes(window)) {
    errors.push(`window must be one of: ${QUOTA_WINDOWS.join(", ")}`);
  }

  const caps = {};
  for (const f of INT_CAP_FIELDS) {
    const v = input[f];
    if (v == null) { caps[f] = null; continue; }
    if (!Number.isInteger(v) || v <= 0) {
      errors.push(`${f} must be a positive integer or null (unlimited)`);
      continue;
    }
    caps[f] = v;
  }
  if (caps.tokenCap == null && caps.spendCapCents == null && errors.length === 0) {
    errors.push("a budget needs at least one cap — tokenCap or spendCapCents");
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      id: budgetId(scope, subject),
      scope,
      subject,
      window,
      tokenCap: caps.tokenCap,
      spendCapCents: caps.spendCapCents,
      thresholds: QUOTA_THRESHOLDS,
      isActive: input.isActive === false ? false : true,
    },
  };
}
