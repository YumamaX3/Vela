// Facade — path-stable entry point for the deprecationsRepo contract.
import * as sqlite from "./sqlite/deprecationsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("./mysql/deprecationsRepo.js"));

export const deprecationKey = bound.deprecationKey;
export const listModelDeprecations = bound.listModelDeprecations;
export const getModelDeprecation = bound.getModelDeprecation;
export const recordModelDeprecation = bound.recordModelDeprecation;
export const clearModelDeprecation = bound.clearModelDeprecation;
export const retainLiveModels = bound.retainLiveModels;
