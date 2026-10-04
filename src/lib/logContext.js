// The Voyage Key (sealed plan r3 §3 — migration M6 owns its tests; the module
// lands early because M3's consoleLogBuffer funnel stamps reqId from it).
//
// One AsyncLocalStorage store { reqId, provider, upstreamId, closedAt }:
//   reqId       — THE correlation authority (minted here, never from inbound)
//   provider    — low-cardinality provider of the current upstream call
//   upstreamId  — the provider's own id for THAT call (per-call, last-write)
//   closedAt    — set in withVoyage's finally; a closed store yields null so a
//                 detached task that outlived its request can never carry a
//                 STALE reqId (the wallkeeper's forged-attribution finding).
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export const VOYAGE_HEADER = "x-vela-request-id";

export const voyageStorage = new AsyncLocalStorage();

/** req-<t36>-<r36>: time base36 + 96 bits of CSPRNG base36. Minted fresh per
 * request — an inbound VOYAGE_HEADER is client-controlled and is NEVER
 * adopted; the wrapper echoes OUR id back on the response instead. */
export function mintVoyageReqId() {
  const t = Date.now().toString(36);
  const r = crypto.randomBytes(12).toString("base64url").replace(/[-_]/g, "").slice(0, 12);
  return `req-${t}-${r}`;
}

/** The live voyage context, or null. Liveness law: once closedAt is set the
 * context is dead — detached async work reading it gets null and the log line
 * renders unjoinable rather than forging attribution to a finished request. */
export function getVoyage() {
  const store = voyageStorage.getStore();
  if (!store || store.closedAt) return null;
  return store;
}

/** BaseExecutor seam — stamp the CURRENT upstream call into the live store.
 * Per-call precedence: each upstream call overwrites provider/upstreamId; the
 * request-wide reqId never changes. Safe no-op outside a live voyage. */
export function stampUpstreamCall({ provider, upstreamId } = {}) {
  const store = voyageStorage.getStore();
  if (!store || store.closedAt) return;
  if (provider !== undefined) store.provider = provider;
  if (upstreamId !== undefined) store.upstreamId = upstreamId;
}

/** The handler-entry chokepoint (§3 mint-site law): wraps the POST handlers of
 * the chat-adjacent routes. Mints the reqId, runs the handler inside the
 * store, closes the store in finally, and echoes x-vela-request-id on the
 * response. Works under next dev and vitest (plain node ALS, no next-server
 * dependency). */
export function withVoyage(handler) {
  return async function voyageWrapped(request, ...rest) {
    const store = {
      reqId: mintVoyageReqId(),
      provider: undefined,
      upstreamId: undefined,
      closedAt: 0,
    };
    try {
      const result = await voyageStorage.run(store, () => handler(request, ...rest));
      // Echo our id — never trust an inbound one. Headers may be immutable on
      // some response shapes; a failed echo must never fail the response.
      try {
        result?.headers?.set?.(VOYAGE_HEADER, store.reqId);
      } catch {
        /* header echo is best-effort */
      }
      return result;
    } finally {
      // closedAt set AFTER the handler unwinds, BEFORE detached tasks that
      // survive it read the store again — the stale-bleed law.
      store.closedAt = Date.now();
    }
  };
}
