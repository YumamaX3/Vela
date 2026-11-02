// Facade — path-stable entry point for the trustEventsRepo contract.
// Storage Covenant: bindFacade dispatches by posture (see securityLogRepo.js
// for the mirror-classification note — the same law applies here: an unread
// notice is the PRIMARY's own, so it is never arg-replayed onto the twin).
import * as sqlite from "./sqlite/trustEventsRepo.js";
import { bindFacade } from "./bind.js";

const bound = bindFacade(sqlite, () => import("./mysql/trustEventsRepo.js"));

export const TRUST_EVENTS_MAX_LIMIT = bound.TRUST_EVENTS_MAX_LIMIT;
export const appendTrustEvent = bound.appendTrustEvent;
export const listTrustEvents = bound.listTrustEvents;
export const countUnreadTrustEvents = bound.countUnreadTrustEvents;
export const markTrustEventRead = bound.markTrustEventRead;
export const markAllTrustEventsRead = bound.markAllTrustEventsRead;
