"use client";

// Search, filters, sort, lens switch. The search field owns the "/" shortcut
// and reports it inline, so the accelerator is discoverable rather than lore.
import { useEffect, useRef } from "react";
import { Select } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { HEALTH_FILTERS, SORTS, STRATEGY_FILTERS, VIEWS } from "../lib/comboMeta";

export default function ComboToolbar({
  query,
  onQuery,
  strategyFilter,
  onStrategy,
  healthFilter,
  onHealth,
  sortKey,
  onSort,
  view,
  onView,
  onReload,
  filtersActive,
  onReset,
  resultCount,
  totalCount,
  onCollapseAll,
  onExpandAll,
}) {
  const inputRef = useRef(null);

  // "/" focuses the search field; ignored while typing anywhere else or with a
  // modifier held, so the shortcut never steals a keystroke.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
      <div className="relative min-w-0 flex-1">
        <span
          className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-muted"
          aria-hidden="true"
        >
          search
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onQuery("");
          }}
          placeholder="Search by combo name or member model…"
          aria-label="Search combos"
          className="w-full rounded-lg border border-border-subtle bg-surface py-2 pl-8 pr-12 text-sm outline-none placeholder:text-text-muted/60 focus:border-primary/50 focus:ring-2 focus:ring-[var(--color-brand-500)]/25"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border-subtle bg-bg px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
          /
        </kbd>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          options={STRATEGY_FILTERS}
          value={strategyFilter}
          onChange={(e) => onStrategy(e.target.value)}
          selectClassName="py-1.5 text-xs"
        />
        <Select
          options={HEALTH_FILTERS}
          value={healthFilter}
          onChange={(e) => onHealth(e.target.value)}
          selectClassName="py-1.5 text-xs"
        />
        <Select options={SORTS} value={sortKey} onChange={(e) => onSort(e.target.value)} selectClassName="py-1.5 text-xs" />

        <div role="group" aria-label="Lens" className="inline-flex items-center gap-0.5 rounded-lg border border-border-subtle bg-bg p-0.5">
          {VIEWS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={view === option.value}
              onClick={() => onView(option.value)}
              title={option.label}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium motion-control",
                view === option.value ? "bg-surface text-text-main shadow-[var(--shadow-soft)]" : "text-text-muted hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                {option.icon}
              </span>
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCollapseAll}
            title="Collapse all harbors"
            aria-label="Collapse all harbors"
            className="rounded-lg border border-border-subtle p-1.5 text-text-muted motion-control hover:text-text-main"
          >
            <span className="material-symbols-outlined text-[16px]">unfold_less</span>
          </button>
          <button
            type="button"
            onClick={onExpandAll}
            title="Expand all harbors"
            aria-label="Expand all harbors"
            className="rounded-lg border border-border-subtle p-1.5 text-text-muted motion-control hover:text-text-main"
          >
            <span className="material-symbols-outlined text-[16px]">unfold_more</span>
          </button>
          <button
            type="button"
            onClick={onReload}
            title="Reload the fleet"
            aria-label="Reload the fleet"
            className="rounded-lg border border-border-subtle p-1.5 text-text-muted motion-control hover:text-text-main"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
          </button>
        </div>
      </div>

      <p className="shrink-0 text-[11px] text-text-muted lg:pl-1">
        {resultCount === totalCount ? `${totalCount} combos` : `${resultCount} of ${totalCount} combos`}
        {filtersActive && (
          <button type="button" onClick={onReset} className="ml-2 text-primary hover:underline">
            Clear filters
          </button>
        )}
      </p>
    </div>
  );
}
