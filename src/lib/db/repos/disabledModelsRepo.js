// Facade — path-stable entry point for the disabledModelsRepo contract.
// Storage Covenant A8: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
import * as sqlite from "./sqlite/disabledModelsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/disabledModelsRepo.js"));

export const getDisabledModels = bound.getDisabledModels;
export const getDisabledByProvider = bound.getDisabledByProvider;
export const disableModels = bound.disableModels;
export const enableModels = bound.enableModels;
