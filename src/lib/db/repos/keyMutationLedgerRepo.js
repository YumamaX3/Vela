// Facade — path-stable entry point for keyMutationLedgerRepo (Governance
// Center, W1b). bindFacade dispatches by posture: sqlite re-exports the
// harbor verbatim; mysql binds repos/mysql/keyMutationLedgerRepo.js.
import * as sqlite from "./sqlite/keyMutationLedgerRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("../repos/mysql/keyMutationLedgerRepo.js"));

export const appendLedger = bound.appendLedger;
export const getKeyLedgerRows = bound.getKeyLedgerRows;
