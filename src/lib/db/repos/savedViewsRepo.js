// Facade — path-stable entry point for saved views (Usage Observatory W4-A).
// bindFacade dispatches by posture — sqlite re-exports the harbor verbatim;
// mysql binds repos/mysql twins. The usageViews table was forged by migration
// 009 (sqlite) / bootstrap.js's additive TABLES diff (mysql), so saved views
// are posture-bound like every W3+ surface.
import * as sqlite from "./sqlite/savedViewsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/savedViewsRepo.js"));

export const listSavedViews = bound.listSavedViews;
export const getSavedView = bound.getSavedView;
export const saveSavedView = bound.saveSavedView;
export const deleteSavedView = bound.deleteSavedView;
