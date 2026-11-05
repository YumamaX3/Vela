// Facade — path-stable entry point for the proxyHealthHistoryRepo contract.
// Same A7 pattern as proxyFitnessRepo: bindFacade dispatches by posture —
// sqlite re-exports the harbor verbatim (sync fns stay sync); mysql binds
// repos/mysql twins.
import * as sqlite from "./sqlite/proxyHealthHistoryRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/proxyHealthHistoryRepo.js"));

export const appendHealthHistoryRows = bound.appendHealthHistoryRows;
export const pruneHealthHistory = bound.pruneHealthHistory;
