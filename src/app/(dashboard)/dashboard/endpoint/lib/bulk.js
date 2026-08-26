// Bulk-selection reducer + helpers for the keys table. Pure functions — the
// hook owns the state; these own the shape changes and the batch summaries.

export function toggleIdInList(list, id) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function allKeyIds(keys) {
  return keys.map((k) => k.id);
}

export function setAll(list, ids) {
  return [...new Set(ids)];
}

export function clearAll() {
  return [];
}

/** Count of selected keys matching a predicate (e.g. paused/resumed). */
export function selectedMatching(keys, selected, predicate) {
  return selected.filter((id) => keys.find((k) => k.id === id) && predicate(keys.find((k) => k.id === id))).length;
}

/** Distinct categories among the selected keys (for the bulk "set category" prompt). */
export function selectedCategories(keys, selected) {
  const set = new Set();
  for (const id of selected) {
    const k = keys.find((x) => x.id === id);
    if (k?.category) set.add(k.category);
  }
  return [...set];
}
