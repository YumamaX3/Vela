// ── W3 key-limit UI helpers ────────────────────────────────────────────────
// Editor shape: { rateLimitRpm, tokenBudget, budgetScope, spendCapCents,
// expiresAt, ipAllowlist } — maps to repo fields at submit time
// (tokenBudget→tokenBudgetDaily, spendCapCents→spendCapDailyCents).
export const DEFAULT_LIMITS = Object.freeze({
  rateLimitRpm: null,
  tokenBudget: null,
  budgetScope: "daily",
  spendCapCents: null,
  expiresAt: null,
  ipAllowlist: null,
});

export function formatTokens(n) {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

/** Spend formatter for key usage strips — honest about sub-cent dust. */
export function formatCost(c) {
  if (!c || c <= 0) return "$0.00";
  if (c < 0.01) return "<$0.01";
  return `$${c.toFixed(2)}`;
}

/** Limit badges for a key row — only limits actually set render. */
export function limitBadges(key) {
  const badges = [];
  if (key.rateLimitRpm != null) badges.push({ k: "rpm", text: `${key.rateLimitRpm} RPM` });
  if (key.tokenBudgetDaily != null) badges.push({ k: "tok", text: `${formatTokens(key.tokenBudgetDaily)} tok` });
  if (key.spendCapDailyCents != null) badges.push({ k: "spend", text: `$${(key.spendCapDailyCents / 100).toFixed(0)}` });
  if (key.ipAllowlist?.length) badges.push({ k: "ip", text: `${key.ipAllowlist.length} IP` });
  return badges;
}

export function limitsFromRecord(k) {
  return {
    rateLimitRpm: k.rateLimitRpm ?? null,
    tokenBudget: k.tokenBudgetDaily ?? null,
    budgetScope: k.budgetScope || "daily",
    spendCapCents: k.spendCapDailyCents ?? null,
    expiresAt: k.expiresAt ?? null,
    ipAllowlist: Array.isArray(k.ipAllowlist) ? k.ipAllowlist : null,
  };
}

// ── Key categories ──────────────────────────────────────────────────────────
// Free-form labels the user assigns to keys (friend, hermes, others…). The
// server stores the exact trimmed string; the dashboard derives the filter
// chips from whatever categories exist. `__uncategorized__` is a sentinel for
// the "no category" bucket (real categories never contain that token).
export const UNCATEGORIZED = "__uncategorized__";
export const categoryOf = (k) => k.category || UNCATEGORIZED;
