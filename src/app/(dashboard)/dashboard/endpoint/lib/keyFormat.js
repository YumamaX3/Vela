// Pure key-formatting helpers — no React, no fetch. Shared by rows, badges,
// health bars, the drawer, and the bulk bar so every surface renders the same
// numbers. Moved verbatim from the old monolith + the new health label.

/** Compact token counts: 1500 → "1.5K", 2_400_000 → "2.4M". */
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

/** Server record → KeyLimitsEditor shape (tokenBudget→tokenBudgetDaily etc.). */
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

/** Default (all-off) KeyLimitsEditor value. */
export const DEFAULT_LIMITS = Object.freeze({
  rateLimitRpm: null,
  tokenBudget: null,
  budgetScope: "daily",
  spendCapCents: null,
  expiresAt: null,
  ipAllowlist: null,
});

// Sentinel for the "no category" bucket — real categories never contain it.
export const UNCATEGORIZED = "__uncategorized__";

export const categoryOf = (k) => k.category || UNCATEGORIZED;

/**
 * Relative / absolute time for a key's last-used or expiry — the kind of
 * "5m ago · Tue 14:32" that makes an observatory readable at a glance.
 * Returns null when the input is null/invalid (renderers fall back to "Never").
 */
export function formatTime(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;

  const diffMs = Date.now() - t;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);

  let relative;
  if (mins < 1) relative = "just now";
  else if (mins < 60) relative = `${mins}m ago`;
  else if (mins < 60 * 24) relative = `${Math.round(mins / 60)}h ago`;
  else relative = `${Math.round(mins / (60 * 24))}d ago`;

  // Compact absolute stamp for the tooltip / secondary line.
  const absStamp = new Date(t).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { relative, absolute: absStamp, iso };
}

/**
 * Health label for a key — "stale" wins, then low-use, else healthy.
 * Budget usage ratio comes from the health route (usage vs budget); a key
 * with no budget and no traffic in the window reads as low-use.
 */
export function healthLabel(key, usage) {
  if (key?.revoked === true) return "revoked";
  if (key?.health?.stale) return "stale";
  const budgetRatio = key?.health?.budgetRatio ?? usage?.budgetRatio ?? null;
  const totalTokens = usage?.totalTokens ?? 0;
  if (totalTokens === 0 && (key?.health?.hasBudget || usage?.hasBudget)) return "low-use";
  if (budgetRatio != null && budgetRatio >= 0.8) return "near-limit";
  return "healthy";
}
