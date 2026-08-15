// Facade — path-stable entry point for the nodesRepo contract.
// Storage Covenant A7: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
import * as sqlite from "./sqlite/nodesRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/nodesRepo.js"));

export const getProviderNodes = bound.getProviderNodes;
export const getProviderNodeById = bound.getProviderNodeById;
export const createProviderNode = bound.createProviderNode;
export const updateProviderNode = bound.updateProviderNode;
export const deleteProviderNode = bound.deleteProviderNode;
