// P5 — the ONE period contract for every dashboard usage read.
// Plans/2026-11-01-responsive-tide-performance.md §III ("stream/route passes
// the client's period"): the stats REST route and the SSE stream parsed their
// own periods in two places and already disagreed on the default — REST said
// "7d", the stream had no period at all and always scanned "all". This module
// is the single source: one allow-list, one default, one read-side function
// per transport. Server-only (both transports import it); no React.
export const USAGE_PERIODS = Object.freeze(["today", "24h", "7d", "14d", "30d", "60d", "all"]);

/** The dashboard's default read. */
export const DEFAULT_USAGE_PERIOD = "7d";

const VALID = new Set(USAGE_PERIODS);

/** True when `period` is one of the seven the twin honours. */
export function isValidUsagePeriod(period) {
  return typeof period === "string" && VALID.has(period);
}

/** REST: a missing period means the default; a present-but-unknown one is an
 *  error (null) — the route answers 400, exactly as before. */
export function readUsagePeriodFromUrl(url) {
  let raw;
  try { raw = new URL(url).searchParams.get("period"); } catch { raw = null; }
  if (raw === null || raw === "") return DEFAULT_USAGE_PERIOD;
  return isValidUsagePeriod(raw) ? raw : null;
}

/** SSE: an absent OR unknown period falls OPEN to the default rather than
 *  killing the stream (the SSE posture — a bad query string must not starve
 *  a live tab). The client always sends its own period, and a change of
 *  period re-opens the stream under the new one. */
export function readUsagePeriodFromStreamUrl(url) {
  let raw;
  try { raw = new URL(url).searchParams.get("period"); } catch { raw = null; }
  return isValidUsagePeriod(raw) ? raw : DEFAULT_USAGE_PERIOD;
}
