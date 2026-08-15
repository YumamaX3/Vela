// Facade — path-stable entry point for the aliasRepo contract.
// Storage Covenant A7: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
import * as sqlite from "./sqlite/aliasRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/aliasRepo.js"));

export const getModelAliases = bound.getModelAliases;
export const setModelAlias = bound.setModelAlias;
export const deleteModelAlias = bound.deleteModelAlias;
export const getCustomModels = bound.getCustomModels;
export const addCustomModel = bound.addCustomModel;
export const deleteCustomModel = bound.deleteCustomModel;
export const getMitmAlias = bound.getMitmAlias;
export const setMitmAliasAll = bound.setMitmAliasAll;
