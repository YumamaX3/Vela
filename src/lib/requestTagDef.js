// Usage Observatory W4-C — request-tag validation (the identifier covenant's
// sibling for ledger tags).
//
// The sealed plan's four obligations, honored here + at the route:
//   • ≤64 chars            — MAX_TAG_LENGTH
//   • charset allow-list   — TAG_NAME_RE (letters/digits + space _ - . / :,
//                            starting alphanumeric; no commas/quotes/HTML —
//                            CSV-safe and render-safe by construction)
//   • parameterized endpoint — the API never interpolates a tag into SQL
//   • escape-on-render + CSV — React escapes by construction; the CSV cell
//                            rides the export's formula-guarded csvCell
//
// A tag is operator-authored free text, never an identifier — it is stored
// verbatim and rendered through the escape-safe channels above.
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL).

export const MAX_TAG_LENGTH = 64;
export const MAX_TAGS_PER_REQUEST = 8;

/** Charset allow-list: starts alphanumeric; then letters, digits, space,
 *  and _ - . / : — deliberately excluding commas, quotes, and angle
 *  brackets so a tag can never break a CSV cell or an HTML context. */
export const TAG_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _\-./:]{0,63}$/;

export class RequestTagValidationError extends Error {
  constructor(errors) {
    super(errors.join("; "));
    this.name = "RequestTagValidationError";
    this.errors = errors;
  }
}

/** Validate one tag name. @returns {string|null} the problem, or null. */
export function validateTagName(name) {
  if (typeof name !== "string") return "Tag must be a string";
  const trimmed = name.trim();
  if (!trimmed) return "Tag must not be empty";
  if (trimmed.length > MAX_TAG_LENGTH) {
    return `Tag must be at most ${MAX_TAG_LENGTH} characters`;
  }
  if (!TAG_NAME_RE.test(trimmed)) {
    return "Tag may contain only letters, digits, spaces and _ - . / :";
  }
  return null;
}

/** Validate a full tag SET for one request (deduped, capped).
 *  @returns {{tags?: string[], errors: string[]}} */
export function validateTagSet(tags) {
  if (!Array.isArray(tags)) return { errors: ["tags must be an array"] };
  if (tags.length > MAX_TAGS_PER_REQUEST) {
    return { errors: [`A request may carry at most ${MAX_TAGS_PER_REQUEST} tags`] };
  }
  const errors = [];
  const seen = new Set();
  const out = [];
  for (const tag of tags) {
    const problem = validateTagName(tag);
    if (problem) { errors.push(problem); continue; }
    const trimmed = String(tag).trim();
    if (seen.has(trimmed.toLowerCase())) continue; // case-insensitive dedupe
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return errors.length ? { errors } : { tags: out, errors: [] };
}
