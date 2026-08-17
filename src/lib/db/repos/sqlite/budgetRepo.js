// Usage Observatory W3-A — quotaRepo, the sqlite harbor.
// Budget definitions ride the kv store (scope "budgets") — the sealed plan
// reserves migration 009 for W4 saved views, so W3's budget engine persists
// its definitions as CONFIG, not a new table. kv is posture-bound, twin-parity,
// and export-covered generically (Storage Covenant A3). The kvStore helper is
// census-exempt (helpers/* sync utility), so raw SQL never touches the gate.
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W3 GOVERNANCE).

import { makeKv } from "../../helpers/kvStore.js";
import { validateBudgetDefinition, budgetId, BudgetValidationError, MAX_BUDGETS } from "../../../budgetDef.js";

const SCOPE = "budgets";
const budgetsKv = makeKv(SCOPE);

// Hot-path TTL: keyGate reads the budget list on every /v1 authorization
// (W3-B). kv reads are cheap but not free; a 5s cache matches the spend
// stage's BUDGET_CACHE_TTL_MS so the gate stays fast under load.
const LIST_CACHE_TTL_MS = 5_000;
let listCache = { value: null, expiresAt: 0 };

function invalidate() {
  listCache = { value: null, expiresAt: 0 };
}
// Exported so updateBudget (id-changing patch) can force a re-read.
export function invalidateCache() {
  invalidate();
}

/** Every stored budget definition, active first. Cached for the hot path. */
export async function listBudgets() {
  const now = Date.now();
  if (listCache.value && listCache.expiresAt > now) return listCache.value;
  const all = await budgetsKv.getAll();
  const list = Object.values(all).filter((b) => b && typeof b === "object");
  // Deterministic order: active first, then scope, then id — stable for the
  // gate's evaluation and the dashboard's table.
  list.sort((a, b) =>
    (a.isActive === false ? 1 : 0) - (b.isActive === false ? 1 : 0)
    || String(a.scope).localeCompare(String(b.scope))
    || String(a.id).localeCompare(String(b.id))
  );
  listCache = { value: list, expiresAt: now + LIST_CACHE_TTL_MS };
  return list;
}

/** One budget by id, or null. */
export async function getBudget(id) {
  if (!id) return null;
  return (await budgetsKv.get(id, null)) || null;
}

/** Upsert a validated budget definition. Throws BudgetValidationError.
 *  The MAX_BUDGETS DoS rail bites only on CREATE — an upsert of an existing
 *  id replaces, never grows the set. */
export async function upsertBudget(input) {
  const verdict = validateBudgetDefinition(input);
  if (!verdict.ok) throw new BudgetValidationError(verdict.errors);
  const existing = await getBudget(verdict.value.id);
  // getAll() returns a key→value OBJECT — count its keys, never .length.
  if (!existing && Object.keys(await budgetsKv.getAll()).length >= MAX_BUDGETS) {
    throw new BudgetValidationError([`budget limit reached — at most ${MAX_BUDGETS} definitions`]);
  }
  await budgetsKv.set(verdict.value.id, verdict.value);
  invalidate();
  return verdict.value;
}

/** Toggle a budget's isActive flag. Returns the updated def or null. */
export async function setBudgetActive(id, isActive) {
  const def = await getBudget(id);
  if (!def) return null;
  def.isActive = !!isActive;
  await budgetsKv.set(id, def);
  invalidate();
  return def;
}

/**
 * Patch an existing budget. Any of scope/subject/window/tokenCap/
 * spendCapCents/isActive may be present; absent fields keep the stored
 * values. Changing scope or subject moves the definition to a new id —
 * the old row is removed atomically with the new one (MAX_BUDGETS is
 * re-checked when the id changes). Returns the updated def or null if the
 * target does not exist. Throws BudgetValidationError on invalid input.
 */
export async function updateBudget(id, patch) {
  const def = await getBudget(id);
  if (!def) return null;
  const merged = {
    scope: "scope" in (patch || {}) ? patch.scope : def.scope,
    subject: "subject" in (patch || {}) ? patch.subject : def.subject,
    window: "window" in (patch || {}) ? patch.window : def.window,
    tokenCap: "tokenCap" in (patch || {}) ? patch.tokenCap : def.tokenCap,
    spendCapCents: "spendCapCents" in (patch || {}) ? patch.spendCapCents : def.spendCapCents,
    isActive: "isActive" in (patch || {}) ? patch.isActive : def.isActive,
  };
  const verdict = validateBudgetDefinition(merged);
  if (!verdict.ok) throw new BudgetValidationError(verdict.errors);
  if (verdict.value.id !== id && Object.keys(await budgetsKv.getAll()).length >= MAX_BUDGETS) {
    throw new BudgetValidationError([`budget limit reached — at most ${MAX_BUDGETS} definitions`]);
  }
  await budgetsKv.set(verdict.value.id, verdict.value);
  if (verdict.value.id !== id) await budgetsKv.remove(id);
  invalidate();
  return verdict.value;
}

/** Remove a budget. Returns true if a row was removed. */
export async function removeBudget(id) {
  if (!id) return false;
  const existed = await getBudget(id);
  if (!existed) return false;
  await budgetsKv.remove(id);
  invalidate();
  return true;
}

/** Convenience constructor id for callers that hold scope+subject. */
export { budgetId };
