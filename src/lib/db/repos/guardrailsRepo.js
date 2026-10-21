// Facade — path-stable entry point for the guardrailsRepo contract.
// Storage Covenant A7: bindFacade dispatches by posture. The sqlite harbor is
// re-exported verbatim (async fns stay async); mirror wraps it in the outbox
// decorator; mysql binds the twin.
import * as sqlite from "./sqlite/guardrailsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("./mysql/guardrailsRepo.js"));

export const listGuardrailPolicies = bound.listGuardrailPolicies;
export const getGuardrailPolicy = bound.getGuardrailPolicy;
export const upsertGuardrailPolicy = bound.upsertGuardrailPolicy;
export const deleteGuardrailPolicy = bound.deleteGuardrailPolicy;
export const insertGuardrailLog = bound.insertGuardrailLog;
export const listGuardrailLogs = bound.listGuardrailLogs;
export const deleteGuardrailLogs = bound.deleteGuardrailLogs;
