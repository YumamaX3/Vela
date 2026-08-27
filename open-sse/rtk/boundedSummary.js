// Bounded observability (AI Lab W3/S7) — the applied-injector summary.
//
// Caps: first 5 distinct names, each hard-truncated to 24 chars (UTF-8-aware
// slice), joined CSV. Emitted in TWO places: the x-vela-applied-injectors
// response header (≤ ~130 bytes) and per-request usage tags. Retention
// inherits VELA_USAGE_RETENTION_DAYS for free (tags ride usage rows through
// the existing purge-after-backup flow). Never carries prompt content or
// excerpts — names only (Covenant: no secrets, no exfil).

const MAX_NAMES = 5;
const MAX_NAME_CHARS = 24;

/** UTF-8-aware hard truncation: ≤max CODE POINTS, never a split code point. */
export function truncateName(name, max = MAX_NAME_CHARS) {
  const s = String(name ?? "");
  if ([...s].length <= max) return s;
  return [...s].slice(0, max).join("");
}

/**
 * Summarize applied injector names: first 5 distinct, each ≤24 chars, CSV.
 * @param {string[]} names
 * @returns {string} e.g. "Greeter,JsonGuard"
 */
export function summarizeApplied(names) {
  const seen = new Set();
  const out = [];
  for (const n of Array.isArray(names) ? names : []) {
    const key = String(n ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(truncateName(key));
    if (out.length >= MAX_NAMES) break;
  }
  return out.join(",");
}

/** Build the x-vela-applied-injectors header value (names + optional mode + verdict). */
export function buildAppliedHeader({ names = [], mode = null, policyVerdict = null } = {}) {
  const parts = [];
  const summary = summarizeApplied(names);
  if (summary) parts.push(summary);
  if (mode) parts.push(`mode:${truncateName(mode)}`);
  if (policyVerdict) parts.push(`policy:${policyVerdict}`);
  return parts.join(" ");
}

export const __test__ = { MAX_NAMES, MAX_NAME_CHARS, truncateName };
