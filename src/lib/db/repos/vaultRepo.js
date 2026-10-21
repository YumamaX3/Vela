// Facade — path-stable entry point for the vaultRepo contract.
import * as sqlite from "./sqlite/vaultRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("./mysql/vaultRepo.js"));

export const getVaultCounts = bound.getVaultCounts;
export const listConnectionsNeedingSeal = bound.listConnectionsNeedingSeal;
export const migratePlaintextCredentials = bound.migratePlaintextCredentials;
export const rewrapConnectionDEKs = bound.rewrapConnectionDEKs;
