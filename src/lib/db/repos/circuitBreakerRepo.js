// Facade — path-stable entry point for the circuitBreakerRepo contract.
// Storage Covenant A7: bindFacade dispatches by posture — sqlite re-exports
// the harbor verbatim (sync fns stay sync); mysql binds repos/mysql twins.
// W9 of the proxy control-plane rebirth: the breaker's own ledger, so
// model-granular counts round-trip. The breaker flushes HERE; the weighted
// draw reads proxyFitness.
import * as sqlite from "./sqlite/circuitBreakerRepo.js";
import { bindFacade } from "./bind.js";
const bound = bindFacade(sqlite, () => import("./mysql/circuitBreakerRepo.js"));
export const getBreakerRows = bound.getBreakerRows;
export const upsertBreakerBatch = bound.upsertBreakerBatch;
export const deleteBreakerRow = bound.deleteBreakerRow;
export const deleteBreakerRowsByPool = bound.deleteBreakerRowsByPool;
export const clearBreakerRows = bound.clearBreakerRows;
export default bound;
