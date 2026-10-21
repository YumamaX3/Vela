// Facade — path-stable entry point for the plansRepo contract.
import * as sqlite from "./sqlite/plansRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/plansRepo.js"));

export const listPlans = bound.listPlans;
export const getPlan = bound.getPlan;
export const createPlan = bound.createPlan;
export const updatePlan = bound.updatePlan;
export const deletePlan = bound.deletePlan;
export const countPlanKeys = bound.countPlanKeys;
