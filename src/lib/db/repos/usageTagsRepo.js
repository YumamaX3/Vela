// Facade — path-stable entry point for request tags (Usage Observatory W4-C).
// bindFacade dispatches by posture — sqlite re-exports the harbor verbatim;
// mysql binds repos/mysql twins. The usageRequestTags table was forged by
// migration 010 (sqlite) / bootstrap.js's additive TABLES diff (mysql).
import * as sqlite from "./sqlite/usageTagsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/usageTagsRepo.js"));

export const getTagsForUsageIds = bound.getTagsForUsageIds;
export const getUsageTags = bound.getUsageTags;
export const setUsageTags = bound.setUsageTags;
