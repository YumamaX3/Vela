// Facade — path-stable entry point for the weekly-digest state (W3-D).
// bindFacade dispatches by posture — sqlite re-exports the harbor verbatim;
// mysql binds repos/mysql twins. The last-sent marker rides the kv store
// (scope "digest"), so the contract is posture-bound with no new table and
// no migration (009 is reserved for W4 saved views). Same precedent as the
// W3-A budgetRepo facade.
import * as sqlite from "./sqlite/digestRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("./mysql/digestRepo.js"));

export const getDigestState = bound.getDigestState;
export const setDigestState = bound.setDigestState;
