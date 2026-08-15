// Facade — path-stable entry point for the pricingRepo contract.
// Storage Covenant A8: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
import * as sqlite from "./sqlite/pricingRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/pricingRepo.js"));

export const getPricing = bound.getPricing;
export const getPricingForModel = bound.getPricingForModel;
export const updatePricing = bound.updatePricing;
export const resetPricing = bound.resetPricing;
export const resetAllPricing = bound.resetAllPricing;
export const replaceSyncedPricing = bound.replaceSyncedPricing;
export const clearSyncedPricing = bound.clearSyncedPricing;
export const getSyncedPricing = bound.getSyncedPricing;
