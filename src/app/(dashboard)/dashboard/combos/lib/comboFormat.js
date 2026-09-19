// Formatting + tone laws for the combos deck. One number reads the same on a
// card, in the table, in the drawer and in the pulse tiles — because there is
// exactly one implementation of each.

export function fmt(n) {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat().format(n);
}

export function fmtCost(c) {
  if (!c) return "$0";
  if (c < 0.001) return "<$0.001";
  if (c >= 100) return `$${c.toFixed(0)}`;
  return `$${c.toFixed(3)}`;
}

export function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function usageTokens(usage) {
  return (usage?.promptTokens || 0) + (usage?.completionTokens || 0);
}

export function okRatioOf(usage) {
  if (!usage || !usage.requests) return null;
  return usage.ok / usage.requests;
}

export function seriesOf(usage) {
  return Array.isArray(usage?.series) ? usage.series.map((s) => s.requests || 0) : null;
}

// ─── tones ─────────────────────────────────────────────────────────────────
// Status text rides the DARK step of each hue on a /10 tint (emerald-700 on a
// 10% emerald wash is 5.4:1; emerald-500 was 3.0:1 and failed SC 1.4.3 for
// small text). Dark mode mirrors it with the light step on the same wash.
export const TONES = {
  brand: "bg-primary/10 text-primary",
  emerald: "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
  amber: "bg-amber-500/10 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
  red: "bg-red-500/10 text-red-700 dark:bg-red-400/10 dark:text-red-300",
  violet: "bg-violet-500/10 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300",
  muted: "bg-black/5 text-text-muted dark:bg-white/5",
};

export function toneForRatio(ratio) {
  if (ratio === null) return "muted";
  if (ratio >= 0.9) return "emerald";
  if (ratio >= 0.6) return "amber";
  return "red";
}

export function toneForHealth(reachable, total) {
  if (!total) return "muted";
  if (reachable === total) return "emerald";
  if (reachable > 0) return "amber";
  return "red";
}

export function healthIcon(reachable, total) {
  if (!total) return "help";
  if (reachable === total) return "check_circle";
  if (reachable > 0) return "warning";
  return "error";
}

export function healthLabel(reachable, total) {
  return `${reachable}/${total} connected`;
}

export function healthSummary(reachable, total) {
  if (!total) return "No member carries a provider prefix — reachability unknown";
  if (reachable === total) return `${reachable} of ${total} member providers connected`;
  return `${reachable} of ${total} member providers connected — ${total - reachable} offline`;
}
