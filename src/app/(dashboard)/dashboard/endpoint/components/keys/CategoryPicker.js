"use client";
// CategoryPicker — the Prism redesign of the free-text category field.
// WAS: a bare Input with a hidden <datalist> (discoverable only by typing;
// mobile keyboards buried the suggestions). NOW: the page's own chip motif —
// every existing category renders as a one-tap chip, "Uncategorized" is the
// clear-selection chip, and a compact input below still coins brand-new
// categories (the server contract is free-form; sanitizeCategory accepts
// any shape-valid string, and empty clears back to uncategorized).
// R-22: chips here are semantic (they ARE the value set), not decoration.
import { useState } from "react";
import { Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { translate } from "@/i18n/runtime";

export default function CategoryPicker({ value, existing, onChange, idPrefix }) {
  const [draft, setDraft] = useState("");
  const commitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange(trimmed);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-1.5">
        {/* "Uncategorized" = the clear selection. Rendered first, always. */}
        <button
          type="button"
          onClick={() => onChange("")}
          aria-pressed={!value}
          className={cn(
            "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium",
            "border motion-control",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            !value
              ? "bg-primary text-white border-primary"
              : "bg-surface border-border-subtle text-text-muted hover:border-primary/50 hover:text-text-main"
          )}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "12px" }} aria-hidden="true">block</span>
          Uncategorized
        </button>
        {existing.map((cat) => {
          const selected = value === cat;
          return (
            <button
              key={cat}
              type="button"
              onClick={() => onChange(selected ? "" : cat)}
              aria-pressed={selected}
              className={cn(
                "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium font-mono",
                "border motion-control",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                selected
                  ? "bg-primary text-white border-primary"
                  : "bg-surface border-border-subtle text-text-main hover:border-primary/50 hover:bg-primary/5"
              )}
            >
              {selected && (
                <span className="material-symbols-outlined" style={{ fontSize: "12px" }} aria-hidden="true">check</span>
              )}
              {cat}
            </button>
          );
        })}
      </div>
      {/* The free-form escape hatch — the contract promises new categories. */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[14px]" aria-hidden="true">
            label
          </span>
          <input
            id={`${idPrefix}-new-category`}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitDraft(); } }}
            placeholder="New category…"
            aria-label="New category name"
            maxLength={32}
            className={cn(
              "w-full pl-8 pr-2 py-1.5 bg-surface border border-border rounded-md text-xs font-mono",
              "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50",
              "placeholder:text-text-subtle"
            )}
          />
        </div>
        <Button size="sm" variant="outline" onClick={commitDraft} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}
