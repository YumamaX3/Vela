// Facade — path-stable entry point for the requestDetailsRepo contract.
// Storage Covenant A8: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
// Non-function exports (__test__) pass through untouched.
import * as sqlite from "./sqlite/requestDetailsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/requestDetailsRepo.js"));

export const __test__ = bound.__test__;
export const saveRequestDetail = bound.saveRequestDetail;
export const getRequestDetails = bound.getRequestDetails;
export const getDistinctProviders = bound.getDistinctProviders;
export const getRequestDetailById = bound.getRequestDetailById;
