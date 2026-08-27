"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { translate } from "@/i18n/runtime";
import { cn } from "@/shared/utils/cn";

// Deterministic per-name palette — the same category always wears the same
// hue across every surface (drawer, chips, this dropdown).
const HUE_STOPS = [10, 20, 30, 140, 160, 180, 200, 220, 250, 270, 290, 320, 340];
const hueOf = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return HUE_STOPS[h % HUE_STOPS.length];
};

const NONE = "__none__";
const CUSTOM = "__custom__";

/**
 * Fancy category dropdown — a searchable combobox. Lists every existing
 * category (deterministic color dot + key count), supports "none", and
 * unlocks a "create new…" row to type a fresh label. Click-outside and
 * Escape close; arrow keys move the highlight; Enter picks.
 *
 * Pure presentational: value = string|null (null = uncategorized), onChange
 * delivers the chosen category.
 */
export default function CategoryCombo({ value, onChange, categories = [], keyCount = {}, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [panelPos, setPanelPos] = useState(null); // fixed-position anchor
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const list = useMemo(() => Array.isArray(categories) ? categories : [], [categories]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.toLowerCase().includes(q));
  }, [list, query]);

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onScroll = () => setPanelPos(anchorRect());
    document.addEventListener("keydown", onDown);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", onScroll);
    if (typeof document !== "undefined") document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onScroll);
      if (typeof document !== "undefined") document.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Anchor the fixed panel to the trigger on open (escapes the modal's
  // overflow-y-auto scroll container).
  const anchorRect = () => {
    const el = triggerRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const width = Math.min(Math.max(240, r.width), 360);
    return {
      top: r.bottom + 6,
      left: Math.max(8, r.left),
      width,
    };
  };
  const toggle = () => {
    if (!open) setPanelPos(anchorRect());
    setOpen((o) => !o);
  };

  // Keep the highlighted row visible while arrowing.
  useEffect(() => {
    const el = listRef.current?.children?.[highlight];
    el?.scrollIntoView?.({ block: "nearest" });
  }, [highlight, open]);

  const rows = [];
  const addRow = (id, label, tone, meta) => rows.push({ id, label, tone, meta, key: id });
  addRow(NONE, translate("— none — (uncategorized)"), null, null);
  for (const c of filtered) {
    addRow(c, c, hueOf(c), keyCount[c] != null ? `${keyCount[c]} ${translate("keys")}` : null);
  }
  addRow(CUSTOM, translate("Create new…"), "brand", creating ? translate("type to create") : null);

  const activeId = rows[highlight]?.id;
  const isSelected = (id) =>
    id === NONE ? !value : id === value || (id === CUSTOM && creating);

  const select = (id) => {
    if (id === NONE) {
      onChange(null);
      setQuery("");
      setCreating(false);
      setDraft("");
      setOpen(false);
      return;
    }
    if (id === CUSTOM) {
      setCreating(true);
      setQuery("");
      setHighlight(rows.length - 1);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    onChange(id);
    setQuery("");
    setCreating(false);
    setDraft("");
    setOpen(false);
  };

  const commitDraft = () => {
    const label = draft.trim();
    if (!label) return;
    onChange(label);
    setDraft("");
    setCreating(false);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (creating && draft.trim()) commitDraft();
      else if (rows[highlight]) select(rows[highlight].id);
    }
  };

  const shownValue = value || "";

  return (
    <div ref={rootRef} className="relative">
      <div
        ref={triggerRef}
        className="flex items-center gap-2 w-full px-3 py-2.5 text-sm bg-surface-2 border border-border-subtle rounded-[10px] cursor-pointer transition-all hover:border-brand-500/40 focus-within:ring-2 focus-within:ring-brand-500/30 focus-within:border-brand-500/40"
        onClick={toggle}
      >
        {shownValue ? (
          <>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: `hsl(${hueOf(shownValue)} 65% 50%)` }} />
            <span className="text-text-main truncate">{shownValue}</span>
          </>
        ) : (
          <span className="text-text-muted">{placeholder || translate("Pick a category…")}</span>
        )}
        <span className={cn("material-symbols-outlined ml-auto text-[20px] text-text-muted transition-transform duration-200", open && "rotate-180")}>
          expand_more
        </span>
      </div>

      {open && panelPos && (
        <div
          className="fixed z-[60] rounded-[12px] bg-surface border border-border-subtle shadow-[var(--shadow-elev)] overflow-hidden"
          style={{ top: panelPos.top, left: panelPos.left, width: panelPos.width }}
        >
          {/* Search */}
          <div className="p-2 border-b border-border-subtle">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] bg-surface-2">
              <span className="material-symbols-outlined text-[16px] text-text-muted">search</span>
              <input
                ref={inputRef}
                autoFocus
                value={creating ? draft : query}
                onChange={(e) => {
                  if (creating) setDraft(e.target.value);
                  else setQuery(e.target.value);
                }}
                onKeyDown={onKeyDown}
                placeholder={creating ? translate("Type the new category…") : translate("Search categories…")}
                className="flex-1 bg-transparent text-sm text-text-main placeholder:text-text-muted focus:outline-none"
              />
            </div>
          </div>

          {/* Rows */}
          <div ref={listRef} className="max-h-56 overflow-y-auto custom-scrollbar py-1">
            {filtered.length === 0 && !creating && (
              <p className="px-3 py-2 text-xs text-text-muted">{translate("No matching categories")}</p>
            )}
            {rows.map((r, i) => {
              const selected = isSelected(r.id);
              return (
                <button
                  key={r.id}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => (r.id === CUSTOM && creating && draft.trim() ? commitDraft() : select(r.id))}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                    highlight === i ? "bg-brand-500/10" : "bg-transparent",
                    r.id === CUSTOM && creating && "bg-brand-500/5"
                  )}
                >
                  {r.tone === "brand" ? (
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-brand-500/70" />
                  ) : r.tone != null ? (
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: `hsl(${r.tone} 65% 50%)` }} />
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-border-subtle" />
                  )}
                  <span className={cn("flex-1 truncate", r.id === NONE ? "text-text-muted" : "text-text-main")}>
                    {r.label}
                  </span>
                  {r.meta && <span className="text-[11px] text-text-muted shrink-0">{r.meta}</span>}
                  {selected && <span className="material-symbols-outlined text-[16px] text-primary shrink-0">check</span>}
                </button>
              );
            })}
          </div>

          <p className="px-3 py-1.5 text-[10px] text-text-muted border-t border-border-subtle">
            {translate("Arrows to move · Enter to pick · Esc to close")}
          </p>
        </div>
      )}
    </div>
  );
}
