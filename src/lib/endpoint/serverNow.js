/**
 * serverNow — the clock-pinning seam (Endpoint Observatory W1d, Covenant P11).
 *
 * The server stamps ONE now per request/frame; every lifecycle computation
 * consumes that stamp. Date.now() is banned from lifecycle paths — the frame
 * response carries serverNow and the client feeds it into lifecycleOf.
 */

/** ISO string of the current server time. */
export function serverNow() {
  return new Date().toISOString();
}

/** Epoch-ms form (for pure computations that prefer numbers). */
export function serverNowMs() {
  return Date.now();
}

/** Parse ISO → ms, null-safe (shared with lifecycleOf via tsOf importers). */
export function toEpoch(v) {
  if (v == null) return null;
  const t = typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}
