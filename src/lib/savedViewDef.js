// Usage Observatory W4-A — saved-view validation (the identifier covenant's
// sibling for the Needle's saved views).
//
// A saved view is { name, params } where `params` is the FULL compass query
// string (tab + every facet). The contract this module enforces:
//   • name: trimmed, non-empty, ≤64 chars
//   • params: non-empty, ≤2048 chars, and every key must belong to the known
//     compass vocabulary (useCompassFilters' FACETS params + tab + the two
//     Requests-deck sort params). Unknown keys reject — a saved view can
//     only ever re-shape the compass, never carry foreign state into the URL.
//   • facet VALUES ride through untouched: they are data (provider ids, model
//     ids, free-text q) validated by the census/aggregation layers when used,
//     never identifiers here.
//
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL).

export const MAX_VIEW_NAME_LENGTH = 64;
export const MAX_VIEW_PARAMS_LENGTH = 2048;
export const MAX_SAVED_VIEWS = 50;

/** The known compass URL vocabulary — useCompassFilters' FACETS params
 *  (period, prov, model, key, status, q, gran) + tab + Requests-deck sort. */
export const KNOWN_VIEW_PARAMS = Object.freeze([
  "tab", "period", "prov", "model", "key", "status", "q", "gran", "sort", "order",
]);

export class SavedViewValidationError extends Error {
  constructor(errors) {
    super(errors.join("; "));
    this.name = "SavedViewValidationError";
    this.errors = errors;
  }
}

/** Validate one saved-view candidate { name?, params? }.
 *  @returns {string[]} the list of human-readable problems (empty = valid). */
export function validateSavedView({ name, params } = {}) {
  const errors = [];

  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) errors.push("View name is required");
  else if (trimmed.length > MAX_VIEW_NAME_LENGTH) {
    errors.push(`View name must be at most ${MAX_VIEW_NAME_LENGTH} characters`);
  }

  if (typeof params !== "string" || params.length === 0) {
    errors.push("View params are required");
    return errors;
  }
  if (params.length > MAX_VIEW_PARAMS_LENGTH) {
    errors.push(`View params must be at most ${MAX_VIEW_PARAMS_LENGTH} characters`);
    return errors;
  }

  // Key whitelist — every compass key must be known. Values are data.
  let search;
  try {
    search = new URLSearchParams(params);
  } catch {
    errors.push("View params are not a valid query string");
    return errors;
  }
  for (const key of search.keys()) {
    if (!KNOWN_VIEW_PARAMS.includes(key)) {
      errors.push(`Unknown view param "${key}" — saved views may only carry compass facets`);
    }
  }
  return errors;
}

/** Normalize a VALID candidate: trimmed name, trimmed params (leading "?"
 *  tolerated — a saved view may capture a full search string). */
export function normalizeSavedView({ name, params }) {
  const p = typeof params === "string" ? params.trim() : "";
  return { name: String(name).trim(), params: p.startsWith("?") ? p.slice(1) : p };
}
