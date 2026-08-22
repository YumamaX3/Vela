// Facade — path-stable entry point for the fallbackRulesRepo contract.
// Storage Covenant A7: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
import * as sqlite from "./sqlite/fallbackRulesRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/fallbackRulesRepo.js"));

export const getFallbackRules = bound.getFallbackRules;
export const getFallbackRuleById = bound.getFallbackRuleById;
export const getRulesForSourceModel = bound.getRulesForSourceModel;
export const createFallbackRule = bound.createFallbackRule;
export const updateFallbackRule = bound.updateFallbackRule;
export const deleteFallbackRule = bound.deleteFallbackRule;
