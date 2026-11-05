// Facade — path-stable entry point for the proxyEgressHistoryRepo contract.
// Same A7 pattern as proxyFitnessRepo / proxyHealthHistoryRepo.
import * as sqlite from "./sqlite/proxyEgressHistoryRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/proxyEgressHistoryRepo.js"));

export const appendEgressHistoryRow = bound.appendEgressHistoryRow;
export const pruneEgressHistory = bound.pruneEgressHistory;
