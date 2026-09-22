// Formatting and posture laws for the key fleet. One number reads the same on
// a card, in the table, in the rail and in the pulse — because there is exactly
// one implementation of each. The posture verdict is RE-EXPORTED from the API's
// own law, so the route's arithmetic and the dashboard's label cannot disagree:
// the server counts a key "expiring" and the row paints the same word from the
// same function.
// The posture / scope / attention verdicts are DEFINED once, in the API's own
// shared law. Bound locally (so the filters below can call them) AND re-exported
// under the dashboard's reach — so the route's census and the row's badge cannot
// drift into two arithmetics of "expiring". The module is pure ESM with no
// server-only import, which is what makes it safe to bundle into the client.
import { attentionFor, isLimited, isScoped, postureOf } from "@/app/api/keys/_lib/keysApi.js";

export { attentionFor, isLimited, isScoped, postureOf };

// The formatting and ceiling helpers were always the client's own.
export {
  UNCATEGORIZED,
  categoryOf,
  formatTokens,
  formatCost,
  limitBadges,
  limitsFromRecord,
  DEFAULT_LIMITS,
} from "./keyLimits";

import { translate } from "@/i18n/runtime";

/** Tone classes per posture — the identical palette the limits editor and the
 *  fleet pulse use, so "paused" is one colour across the whole room. */
export const TONES = {
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  red: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30",
  muted: "bg-surface-2 text-text-muted border-border-subtle",
  indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30",
  primary: "bg-primary/10 text-primary border-primary/30",
};

/** Every glyph below is in the pruned 240-icon subset
 *  (scripts/icon-ligatures.txt). An icon outside it renders as a bare word
 *  beside the real marks and no test fails — icon-subset.test.js is the guard,
 *  and it was consulted before these names were written. */
const POSTURE_META = {
  active: { label: "Active", tone: "emerald", icon: "check_circle" },
  paused: { label: "Paused", tone: "amber", icon: "block" },
  expiring: { label: "Expiring", tone: "amber", icon: "schedule" },
  expired: { label: "Expired", tone: "red", icon: "error" },
};

export function postureMeta(posture) {
  const meta = POSTURE_META[posture] || POSTURE_META.active;
  return { ...meta, label: translate(meta.label) };
}

/** The four postures in the order the pulse and the rail read them. */
export const POSTURE_ORDER = ["active", "paused", "expiring", "expired"];

/** Tone for the ok-ratio the usage strips carry. Null (no traffic) is muted —
 *  silence is not a failure. */
export function toneForRatio(ok, requests) {
  if (!requests) return "muted";
  const ratio = ok / requests;
  if (ratio >= 0.98) return "emerald";
  if (ratio >= 0.9) return "amber";
  return "red";
}

export function usageRatio(usage) {
  if (!usage?.requests) return null;
  return usage.ok != null ? usage.ok / usage.requests : null;
}

/** "just now" / "12m ago" / "3h ago" / "5d ago" — the same ladder the combos
 *  deck uses, so two rooms do not speak two dialects of "recently". */
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

export function daysUntil(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

// ── filtering ───────────────────────────────────────────────────────────────

/** Keys matching the search text and the rail's category. The needle is
 *  matched against the fields a person would actually type: the name, the
 *  description, the category, and the prefix that is the only part of the key
 *  string the harbor ever shows. */
export function matchesQuery(key, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [key.name, key.description, key.category, key.keyPrefix]
    .some((field) => typeof field === "string" && field.toLowerCase().includes(q));
}

export function filterKeys(keys, { query = "", category = "all", posture = null } = {}) {
  return keys.filter((key) => {
    if (category !== "all" && categoryOf(key) !== category) return false;
    // Posture is derived, never stored — so this filter and the pulse tile that
    // sets it read the same verdict by construction.
    if (posture && postureOf(key) !== posture) return false;
    return matchesQuery(key, query);
  });
}

// ── sorting ─────────────────────────────────────────────────────────────────

export const SORT_OPTIONS = [
  { value: "created", label: "Created" },
  { value: "lastUsed", label: "Last used" },
  { value: "requests", label: "Requests" },
  { value: "tokens", label: "Tokens" },
  { value: "cost", label: "Spend" },
  { value: "name", label: "Name" },
];

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ts = (v) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/** Pure comparator per sort key over (key, usage). Keys with NO traffic sort
 *  last under a descending traffic sort rather than being interleaved as
 *  zeroes — an idle key is not "the quietest busy key", it is a different
 *  thing, and the table says so by grouping it below. */
export function compareKeys(a, b, sortKey, usageA, usageB) {
  switch (sortKey) {
    case "name":
      return String(a.name || "").localeCompare(String(b.name || ""));
    case "requests": {
      const ra = num(usageA?.requests);
      const rb = num(usageB?.requests);
      if (ra === 0 && rb !== 0) return 1;
      if (rb === 0 && ra !== 0) return -1;
      return ra - rb;
    }
    case "tokens": {
      const ta = num(usageA?.promptTokens) + num(usageA?.completionTokens);
      const tb = num(usageB?.promptTokens) + num(usageB?.completionTokens);
      if (ta === 0 && tb !== 0) return 1;
      if (tb === 0 && ta !== 0) return -1;
      return ta - tb;
    }
    case "cost": {
      const ca = num(usageA?.cost);
      const cb = num(usageB?.cost);
      if (ca === 0 && cb !== 0) return 1;
      if (cb === 0 && ca !== 0) return -1;
      return ca - cb;
    }
    case "lastUsed":
      return ts(a.lastUsedAt) - ts(b.lastUsedAt);
    case "created":
    default:
      return ts(a.createdAt) - ts(b.createdAt);
  }
}

export function sortKeys(keys, sortKey, sortDir, usageById = {}) {
  const dir = sortDir === "asc" ? 1 : -1;
  return [...keys].sort((a, b) => {
    // The name sort is the only one where "ascending" is not merely a reversal
    // of "descending" — it carries a stable tiebreak so equal names do not
    // shuffle between renders.
    const verdict = compareKeys(a, b, sortKey, usageById[a.id], usageById[b.id]);
    if (verdict !== 0) return verdict * dir;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

/** The subset of a key's ceilings a row should name — the server's
 *  limitBadges plus nothing invented here. Re-exported for the row components
 *  under one name so they never reach past this file. */
export { limitBadges as keyLimitBadges } from "./keyLimits";
