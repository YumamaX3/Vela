// Facade — path-stable entry point for the quotaRepo (budget definitions).
// Usage Observatory W3-A: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim; mysql binds repos/mysql twins. Budget definitions ride
// the kv store (scope "budgets"), so the contract is posture-bound with no new
// table and no new migration (009 is reserved for W4 saved views).
import * as sqlite from "./sqlite/budgetRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/budgetRepo.js"));

export const listBudgets = bound.listBudgets;
export const getBudget = bound.getBudget;
export const upsertBudget = bound.upsertBudget;
export const updateBudget = bound.updateBudget;
export const setBudgetActive = bound.setBudgetActive;
export const removeBudget = bound.removeBudget;
// budgetId is a pure constructor — passes through untouched.
export const budgetId = bound.budgetId;
