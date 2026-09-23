"use client";

// The toolbar: the three lenses an operator switches between (which keys are in
// view, in what order, and in which shape) and the one act that reaches across
// all of them (select every row now visible).
//
// Selection is scoped to what is VISIBLE on purpose: "select all" that silently
// swept keys the operator had filtered out would make a bulk revoke a trap.
import { Input, SegmentedControl } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { SORT_OPTIONS, postureMeta } from "../../lib/keyFormat";
import { LENSES } from "../../hooks/useKeyDeck";

export default function KeyToolbar({ deck }) {
  const {
    query,
    setQuery,
    posture,
    setPosture,
    sortKey,
    setSortKey,
    sortDir,
    setSortDir,
    lens,
    setLens,
    visibleKeys,
    selected,
    selectAllVisible,
    clearSelection,
  } = deck;

  const allVisibleSelected = visibleKeys.length > 0 && visibleKeys.every((k) => selected.has(k.id));

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex-1 min-w-[200px]">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={translate("Search name, description, category or prefix")}
        />
      </div>

      <div className="flex items-center gap-1">
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          title={translate("Sort by")}
          className="text-xs rounded-[10px] bg-surface-2 border border-border-subtle px-2 py-2 text-text-main motion-control"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {translate(option.label)}
            </option>
          ))}
        </select>
        <button
          onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
          title={sortDir === "asc" ? translate("Ascending") : translate("Descending")}
          className="p-2 rounded-[10px] bg-surface-2 border border-border-subtle text-text-muted hover:text-primary motion-control"
        >
          <span className="material-symbols-outlined text-[16px]">
            {sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
          </span>
        </button>
      </div>

      <SegmentedControl options={LENSES} value={lens} onChange={setLens} size="sm" ariaLabel={translate("View")} />

      {posture && (
        <button
          onClick={() => setPosture(null)}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-2 rounded-[10px] bg-primary/15 text-primary border border-primary/40 motion-control"
          title={translate("Clear the posture filter")}
        >
          {postureMeta(posture).label}
          <span className="material-symbols-outlined text-[14px]">close</span>
        </button>
      )}

      <button
        onClick={() => (allVisibleSelected ? clearSelection() : selectAllVisible())}
        disabled={visibleKeys.length === 0}
        className="text-xs px-2.5 py-2 rounded-[10px] bg-surface-2 border border-border-subtle text-text-muted hover:text-primary motion-control disabled:opacity-50"
        title={translate("Select every key currently visible")}
      >
        <span className="material-symbols-outlined text-[16px]">check</span>
      </button>
    </div>
  );
}
