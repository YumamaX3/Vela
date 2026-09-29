"use client";
// The toolbar: the three lenses an operator switches between (which keys are in
// view, in what order, and in which shape) and the one act that reaches across
// all of them (select every row now visible).
//
// Selection is scoped to what is VISIBLE on purpose: "select all" that silently
// swept keys the operator had filtered out would make a bulk revoke a trap.
//
// ── ONE HEIGHT, ONE FILL (2026-09-29) ─────────────────────────────────────────
// This row used to be five heights deep in a single line of five controls,
// measured live rather than eyeballed: search 42 · sort <select> 35 ·
// sort-direction button 48 · SegmentedControl 36 · select-all button 46. The
// buttons were the TALLEST thing in a row of fields, and each erected rounded to
// live by arithmetic (8px padding + a glyph span whose line box answered to the
// ambient line-height), so no two were alike and none sat on the room's design
// scale.
//
// Every control now stands on the measure the house's own fields already use -
// `.material-symbols-outlined` is `line-height: 1`, so `Input`'s `text-sm` line
// box (20) + `py-2.5` (20) + `border-transparent` (2) = 42px: the same 42 the
// masthead's Window select measures. The buttons take an explicit `h-[42px]`
// rather than an emergent one, and the segmented control reaches 42 through its
// own scale - `size="md"` (h-9 = 36) inside `p-[3px]` - which keeps the pill at
// the house's own pill-to-frame proportion (36:42, against 36:44 at its default
// p-1) instead of shrinking to `sm` and floating in a loose frame.
//
// The resting borders are gone with it. The house identifies a field by its fill,
// not by a boundary: `Input` and `Select` both wear `border-transparent` over
// `bg-surface-2` (a condition recorded against the login gate in v0.9.82). A row
// where one control is outlined and its neighbours are not is the raggedness the
// Star's crop showed, so the fills carry the whole row and nothing is outlined.
//
// The row's depth is declared ONCE, as a pair of custom properties the row hands
// down, because the fields themselves are not one height: below `sm` the house
// raises their font to 16px to stop iOS zooming a focused field, which lifts
// their line box and with it the control (46). Measured at 420px: fields 46,
// buttons 42 - a 4px seam. Rather than repeat a magic height in five places, the
// row publishes `--bar-h` (46 below `sm`, 42 at `sm` and up) and the pill's inset
// with it, `--bar-pad` = (--bar-h - 36) / 2 - the segmented control's own `md`
// inner height. Every control measures the row; none measures itself.
//
// The two values are derived from `Input`'s and `Select`'s own formula -
// `line-height` (24 / 20) + `py-2.5` (20) + `border-transparent` (2) - so
// changing the fields changes the row, without this file being told.
import { Input, SegmentedControl, Select } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { SORT_OPTIONS, postureMeta } from "../../lib/keyFormat";
import { LENSES } from "../../hooks/useKeyDeck";

// The house's toolbar control: a square of the row's own height, filled like the
// fields beside it, carrying its name for the pointer AND for the screen reader.
//
// The aria-label is not decoration. These two were icon-only buttons with a
// `title` and no accessible name, so a screen reader announced them as "check"
// and "arrow_downward" - the ligature text, which is the one part of a Material
// Symbols glyph a user should never hear.
function ToolIconButton({ glyph, label, onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="h-[var(--bar-h)] w-[var(--bar-h)] shrink-0 inline-flex items-center justify-center rounded-[10px] bg-surface-2 border border-transparent text-text-muted hover:bg-surface-3 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 focus-visible:border-brand-500/40 active:scale-[0.97] motion-control disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
    >
      <span className="material-symbols-outlined text-xl" aria-hidden="true">
        {glyph}
      </span>
    </button>
  );
}

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
    <div className="flex items-center gap-2 flex-wrap [--bar-h:46px] sm:[--bar-h:42px] [--bar-pad:5px] sm:[--bar-pad:3px]">
      <div className="flex-1 min-w-[200px]">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={translate("Search name, description, category or prefix")}
        />
      </div>
      {/* The ordering control is one instrument in two parts: which column, and
          which way along it. They sit tighter than the row's own gap so they read
          as a pair rather than as two neighbours. */}
      <div className="flex items-center gap-1">
        <Select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          options={SORT_OPTIONS.map((option) => ({ value: option.value, label: translate(option.label) }))}
          placeholder={translate("Sort by")}
          className="w-[132px]"
        />
        <ToolIconButton
          glyph={sortDir === "asc" ? "arrow_upward" : "arrow_downward"}
          label={sortDir === "asc" ? translate("Ascending") : translate("Descending")}
          onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
        />
      </div>
      <SegmentedControl
        options={LENSES}
        value={lens}
        onChange={setLens}
        size="md"
        className="h-[var(--bar-h)] p-[var(--bar-pad)]"
        ariaLabel={translate("View")}
      />
      {posture && (
        // The live filter, worn as the house's own state pill (brand-700 under
        // white) rather than as a tint of the accent: `primary` on `primary/15`
        // measures ~3.7:1 against the dark shore and ~3.2:1 against the light -
        // both under 4.5 for 12px text. This pair was measured live at 7.87:1
        // (white on rgb(23,75,176)) on BOTH shores on 2026-09-29, since
        // brand-700 carries one value for both.
        <button
          type="button"
          onClick={() => setPosture(null)}
          aria-label={translate("Clear the posture filter")}
          title={translate("Clear the posture filter")}
          className="h-[var(--bar-h)] inline-flex items-center gap-1.5 pl-3 pr-2.5 rounded-[10px] bg-brand-700 text-white text-xs font-medium hover:bg-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 active:scale-[0.97] motion-control"
        >
          {postureMeta(posture).label}
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            close
          </span>
        </button>
      )}
      <ToolIconButton
        glyph="check"
        label={
          allVisibleSelected
            ? translate("Clear the selection")
            : translate("Select every key currently visible")
        }
        onClick={() => (allVisibleSelected ? clearSelection() : selectAllVisible())}
        disabled={visibleKeys.length === 0}
      />
    </div>
  );
}
