// zcode-plan WAF strikes — G2/G11 (Wave B).
//
// zcode-plan's upstream risk-control answers a challenged account with
// `405 {code: 3012}` (WAF / "risk control"). One answer is a fluke — a proxy
// egress point can be probed, a single request can trip a heuristic. Two in a
// row, with NO clean answer in between, is a pattern: the account is being
// challenged because of where its traffic comes from, and hammering it only
// deepens the challenge. So the second consecutive strike benches the whole
// account for six hours (account-wide: every model rides the same egress).
//
// A clean answer between two strikes (clearZcodeStrikes, fired on the 200
// path) resets the count to zero — the challenge was answered.
//
// Everything here is PURE over `providerSpecificData`: no DB, no clock of its
// own (the caller passes nowMs), no imports. The caller persists the returned
// patch; that keeps the strike logic testable in isolation and keeps the
// fail-open discipline where it belongs (the persistence seam).
//
// Strike history decays after seven days — an account that struck once last
// week and once today is not "consecutive" by any useful reading.

/** Six hours — the bench the second consecutive WAF strike earns. */
export const WAF_BENCH_MS = 6 * 60 * 60 * 1000;

/** Seven days — the window in which two strikes still count as consecutive. */
export const STRIKE_DECAY_MS = 7 * 24 * 60 * 60 * 1000;

function toFiniteMs(value) {
  const n = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Record a WAF strike and return the patch the caller should persist.
 *
 * @param {object|null|undefined} existingData - providerSpecificData as read
 *   from the connection (or from the credential object)
 * @param {number} nowMs - the strike instant (caller's clock)
 * @returns {{
 *   patch: { waf: number[], benchUntilMs: number|null, lastCleanMs: number|null },
 *   benchUntilMs: number|null,
 *   consecutiveWaf: number
 * }}
 *   `patch` is the FULL zcodeStrikes object — spread-safe into a
 *   providerSpecificData write.
 */
export function recordZcodeWafStrike(existingData, nowMs) {
  const now = toFiniteMs(nowMs);
  if (now == null) throw new TypeError("recordZcodeWafStrike: nowMs must be a finite epoch-ms number");

  const prev = existingData?.zcodeStrikes;
  const prevWaf = Array.isArray(prev?.waf) ? prev.waf : [];
  const lastCleanMs = toFiniteMs(prev?.lastCleanMs);

  // Decay: keep only strikes inside the window AND after the last clean answer.
  // A clean answer is the same thing as "no clean answer between" failing — so
  // it truncates history exactly as decay does.
  const waf = prevWaf
    .map(toFiniteMs)
    .filter(t => t != null && now - t <= STRIKE_DECAY_MS && (lastCleanMs == null || t > lastCleanMs));
  waf.push(now);

  const consecutiveWaf = waf.length;
  const benchUntilMs = consecutiveWaf >= 2 ? now + WAF_BENCH_MS : null;

  return {
    patch: { waf, benchUntilMs, lastCleanMs },
    benchUntilMs,
    consecutiveWaf,
  };
}

/**
 * The clean-200 path: reset the strike history.
 *
 * @param {object|null|undefined} existingData
 * @param {number} [nowMs] - the clean instant; stale strikes keep a clean
 *   answer BEFORE them from erasing the history (they are filtered, not wiped)
 * @returns {{ waf: number[], benchUntilMs: number|null, lastCleanMs: number|null } | null}
 *   The full zcodeStrikes patch, or null when the connection carries no
 *   strike state at all (nothing to clear, nothing to write).
 */
export function clearZcodeStrikes(existingData, nowMs) {
  const prev = existingData?.zcodeStrikes;
  if (!prev || typeof prev !== "object") return null;

  const now = toFiniteMs(nowMs);
  const prevWaf = Array.isArray(prev.waf) ? prev.waf : [];

  // If the caller gave a clock, a strike stamped AFTER it is newer than this
  // clean answer (a concurrent failure). Keep those; a clean answer older than
  // a failure must not forgive it. Without a clock, this is a plain reset.
  const waf = now == null
    ? []
    : prevWaf.map(toFiniteMs).filter(t => t != null && t > now);

  return {
    waf,
    benchUntilMs: null,
    lastCleanMs: now == null ? toFiniteMs(prev.lastCleanMs) : now,
  };
}
