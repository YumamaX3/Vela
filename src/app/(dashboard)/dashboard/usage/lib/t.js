// Usage Observatory W2-B — the t() i18n helper (sealed plan W2(b)).
//
// The Observatory's copy rides the proven runtime-i18n machinery
// (src/i18n/runtime.js): English strings ARE the keys, seeded into every
// public/i18n/literals/*.json as placeholders, and translate() falls back to
// the English input when a key is absent. t(key, params) adds ONE thing the
// raw translate() lacks — {param} interpolation for templated literals like
// 'collecting since {date}' — so the i18n budget (≤40 literals) stays a
// shared label set rather than a bespoke copy per locale.
//
// data-i18n-skip: numeric/metric values rendered near translated labels are
// wrapped by callers in <span data-i18n-skip> so the DOM walker never tries
// to translate numbers or provider names (the runtime honours the attribute).
import { translate } from "@/i18n/runtime";

/** Translate `key` (an English literal) and interpolate {params}.
 *  t('collecting since {date}', { date: '2026-08-16' }) → localized string. */
export function t(key, params) {
  const localized = translate(key);
  if (!params) return localized;
  return String(localized).replace(/\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m
  );
}

/** Look up a literal whose KEY is computed at runtime (e.g. a metric label
 *  chosen from a frozen set). Falls back to the computed key itself —
 *  identical to translate()'s miss-behavior, named explicitly for clarity. */
export function lookupLiteral(key) {
  return translate(key);
}

export default t;
