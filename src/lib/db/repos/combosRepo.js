// Facade — path-stable entry point for the combosRepo contract.
// Storage Covenant A7: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
import * as sqlite from "./sqlite/combosRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/combosRepo.js"));

export const getCombos = bound.getCombos;
export const getComboById = bound.getComboById;
export const getComboByName = bound.getComboByName;
export const createCombo = bound.createCombo;
export const updateCombo = bound.updateCombo;
export const deleteCombo = bound.deleteCombo;
