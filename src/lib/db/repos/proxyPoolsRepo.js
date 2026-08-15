// Facade — path-stable entry point for the proxyPoolsRepo contract.
// Storage Covenant A7: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
import * as sqlite from "./sqlite/proxyPoolsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/proxyPoolsRepo.js"));

export const getProxyPools = bound.getProxyPools;
export const getProxyPoolById = bound.getProxyPoolById;
export const createProxyPool = bound.createProxyPool;
export const updateProxyPool = bound.updateProxyPool;
export const deleteProxyPool = bound.deleteProxyPool;
