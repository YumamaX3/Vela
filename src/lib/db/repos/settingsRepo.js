// Facade — path-stable entry point for the settingsRepo contract.
// Storage Covenant A7: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
import * as sqlite from "./sqlite/settingsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/settingsRepo.js"));

export const mergeWithDefaults = bound.mergeWithDefaults;
export const getSettings = bound.getSettings;
export const updateSettings = bound.updateSettings;
export const isCloudEnabled = bound.isCloudEnabled;
export const getCloudUrl = bound.getCloudUrl;
export const exportSettings = bound.exportSettings;
