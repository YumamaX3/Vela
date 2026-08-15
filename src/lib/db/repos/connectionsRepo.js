// Facade — path-stable entry point for the connectionsRepo contract.
// Storage Covenant A7: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
import * as sqlite from "./sqlite/connectionsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/connectionsRepo.js"));

export const getProviderConnections = bound.getProviderConnections;
export const getProviderConnectionById = bound.getProviderConnectionById;
export const createProviderConnection = bound.createProviderConnection;
export const updateProviderConnection = bound.updateProviderConnection;
export const deleteProviderConnection = bound.deleteProviderConnection;
export const deleteProviderConnectionsByProvider = bound.deleteProviderConnectionsByProvider;
export const reorderProviderConnections = bound.reorderProviderConnections;
export const cleanupProviderConnections = bound.cleanupProviderConnections;
