// Facade — path-stable entry point for the proxyFitnessRepo contract.
// Storage Covenant A7: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
import * as sqlite from "./sqlite/proxyFitnessRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/proxyFitnessRepo.js"));

export const getFitnessRows = bound.getFitnessRows;
export const upsertFitnessBatch = bound.upsertFitnessBatch;
export const resetFitness = bound.resetFitness;
