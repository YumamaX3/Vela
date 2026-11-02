// Facade — path-stable entry point for the securityLogRepo contract.
// Storage Covenant: bindFacade dispatches by posture. The sqlite harbor is
// re-exported verbatim (async fns stay async); mirror wraps it in the outbox
// decorator; mysql binds the twin.
//
// NOTE on mirror: the appends/prunes/mark-read are deliberately NOT classified
// in mirror/replayRegistry.js. This ledger is evidence OF THE PRIMARY — it
// records the act as the primary performed it. Arg-replaying an append on the
// twin would re-stamp createdAt at replay time (a line claiming a later
// arrival than the act), and the twin records its own acts where they happen.
// Unclassified = never captured by the decorator; it crosses by full resync,
// exactly like a backup artifact.
import * as sqlite from "./sqlite/securityLogRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("./mysql/securityLogRepo.js"));

export const SECURITY_LOG_RETENTION_MS = bound.SECURITY_LOG_RETENTION_MS;
export const SECURITY_LOG_MAX_LIMIT = bound.SECURITY_LOG_MAX_LIMIT;
export const appendSecurityEvent = bound.appendSecurityEvent;
export const listSecurityEvents = bound.listSecurityEvents;
export const pruneSecurityEvents = bound.pruneSecurityEvents;
export const countSecurityEvents = bound.countSecurityEvents;
