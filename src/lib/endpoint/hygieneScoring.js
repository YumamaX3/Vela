/**
 * hygieneScoring — honest per-key hygiene scoring (Endpoint Observatory W1d,
 * Shorekeeper-Sealed Plan §1.8).
 *
 * Truth rules:
 *   • PUBLISHED weights — the scores the UI shows are the sums of named,
 *     published factors; the weight table is exported for tests + docs.
 *   • posture vs urgency separated — posture penalties (ACL breadth,
 *     unrestricted scope) vs urgency signals (unused-for-N-days, near-expiry
 *     of a DIFFERENT kind — expiry itself NEVER contributes, the Expiring
 *     tile owns that signal).
 *   • age-exemption — old-but-active keys are NOT flagged merely for being
 *     old; the unused penalty scales with the key's own expected lifecycle.
 *   • fail-open — any exception → null score (UI renders —), never a crash.
 *
 * Pure module — injected `now` everywhere (clock-pinning rule).
 */

export const HYGIENE_WEIGHTS = Object.freeze({
  // Posture penalties (sum: 100 possible).
  unrestrictedAcl: 25, // allowedModels/Kinds/Providers all null
  broadScope: 15, // budgetScope null on a key with limits set elsewhere
  noIpAllowlist: 10, // no IP allowlist on a non-internal key
  noExpiry: 10, // no expiresAt — but age-exempted once past 90d active
  // Urgency signals.
  unusedLong: 20, // untouched for > 30 days
  expired: 0, // NEVER — the Expiring tile owns this signal
  revoked: 0, // lifecycle handles it
});

const BAND_THRESHOLDS = { good: 80, fair: 55 }; // >= good, >= fair, else poor

export function bandOf(score) {
  if (score == null) return "unknown";
  if (score >= BAND_THRESHOLDS.good) return "good";
  if (score >= BAND_THRESHOLDS.fair) return "fair";
  return "poor";
}

/**
 * Score one key. Pure + deterministic.
 * @param {object} key public key row
 * @param {number|string} now server-stamped clock
 * @returns {{ score, band, factors: [{id,label,penalty}], postureChip, urgencyChip } | null}
 */
export function scoreKey(key, now) {
  try {
    if (!key || typeof key !== "object") return null;
    const nowMs = typeof now === "number" ? now : Date.parse(now);
    if (!Number.isFinite(nowMs)) return null;

    const factors = [];
    let score = 100;

    const deduct = (id, label, penalty) => {
      if (penalty <= 0) return;
      score -= penalty;
      factors.push({ id, label, penalty });
    };

    // ── Posture ─────────────────────────────────────────────────────────
    const aclOpen =
      (key.allowedModels == null || !key.allowedModels.length) &&
      (key.allowedKinds == null || !key.allowedKinds.length) &&
      (key.allowedProviders == null || !key.allowedProviders.length);
    if (aclOpen && key.isInternal !== 1) {
      deduct("unrestrictedAcl", "Unrestricted ACL (all models/kinds/providers)", HYGIENE_WEIGHTS.unrestrictedAcl);
    }
    if (key.budgetScope == null && key.isInternal !== 1) {
      deduct("broadScope", "No budget scope set", HYGIENE_WEIGHTS.broadScope);
    }
    const allow = key.ipAllowlist;
    const hasAllowlist = Array.isArray(allow) ? allow.length > 0 : !!allow;
    if (!hasAllowlist && key.isInternal !== 1) {
      deduct("noIpAllowlist", "No IP allowlist", HYGIENE_WEIGHTS.noIpAllowlist);
    }
    if (key.expiresAt == null && key.isInternal !== 1) {
      // Age-exemption: a long-serving key without expiry is a deliberate
      // choice, not a hygiene miss.
      const created = Date.parse(key.createdAt || "");
      const ageDays = Number.isFinite(created) ? (nowMs - created) / 86400000 : 0;
      if (ageDays < 90) {
        deduct("noExpiry", "No expiry set", HYGIENE_WEIGHTS.noExpiry);
      }
    }

    // ── Urgency ─────────────────────────────────────────────────────────
    const lastUsed = Date.parse(key.lastUsedAt || "");
    if (Number.isFinite(lastUsed)) {
      const unusedDays = (nowMs - lastUsed) / 86400000;
      if (unusedDays > 30 && key.isInternal !== 1) {
        deduct("unusedLong", `Unused for ${Math.floor(unusedDays)}d`, HYGIENE_WEIGHTS.unusedLong);
      }
    }

    // Posture chip (what the key ALLOWS) vs urgency chip (what it DOES).
    const postureChip = score >= 60 ? "clean" : "restricted";
    const urgencyChip = factors.some((f) => f.id === "unusedLong") ? "dormant" : "active";

    factors.sort((a, b) => b.penalty - a.penalty);
    return {
      score: Math.max(score, 0),
      band: bandOf(Math.max(score, 0)),
      factors,
      postureChip,
      urgencyChip,
    };
  } catch {
    return null; // fail-open — the ring renders —
  }
}
