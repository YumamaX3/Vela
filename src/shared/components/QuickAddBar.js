"use client";

// QuickAddBar — always-visible shortcut bar at the top of the dashboard.
//
// New menu #1 (Prism Build D, 2026-09-07).
//
// The redesigned ModelSelectModal already persists picks to localStorage
// (key: vela:picker:recents, max 8) and emits vela:recents:changed. This
// bar subscribes to that stream, so the same surface lights up everywhere
// the operator has been. One source of truth, three live surfaces.
//
// Self-contained: the bar owns the modal state. The layout just mounts the
// bar; pages that want to react to a pick listen for the
// vela:picker:committed CustomEvent the bar dispatches.
//
// Layout (desktop only — mobile gets the sidebar drawer, which carries
// the recents itself):
//   [ search ⌕  Recent  recent·recent·recent·recent   + add model ]
//
// Anti-slop checks applied:
//   R-22 — pills are not the default. The bar reads as a toolbar with
//          grouped affordances (search / recents / add), not a sea of
//          identical chips.
//   R-08 — keyboard: every affordance is a real button with focus-
//          visible rings; the bar is not a focus trap (operators need
//          to be able to tab past it into the page).
//   R-12 — recents show only if there are any; an empty bar is the
//          first-time-state, not a "0 results" message.
//   R-18 — colors read from --color-* tokens; no hard-coded hex.
//   R-04 — the bar earns its keep because the redesigned picker
//          re-opens with the recents strip + category rail already
//          pointing where the operator just was. One click beats five.

import { useEffect, useState, useRef, useCallback } from "react";
import { cn } from "@/shared/utils/cn";
import ModelSelectModal from "./ModelSelectModal";

const RECENTS_KEY = "vela:picker:recents";
const RECENTS_VISIBLE = 4;

function loadRecents() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function QuickAddBar() {
  const [recents, setRecents] = useState([]);
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  // The recents-pick flow needs to know which model to commit before the
  // modal opens; we stash the value here and let the modal open with
  // an empty selection, then we dispatch the event as if the user had
  // picked it from the modal. (Simpler path: dispatch directly from the
  // recents click — no modal needed for a "pick the same thing again".)
  const inputRef = useRef(null);

  useEffect(() => {
    setRecents(loadRecents());
    const handler = (e) => setRecents(Array.isArray(e.detail) ? e.detail : loadRecents());
    const storageHandler = (e) => {
      if (e.key === RECENTS_KEY) setRecents(loadRecents());
    };
    window.addEventListener("vela:recents:changed", handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener("vela:recents:changed", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);

  // Pick a recent — fire the same event the modal would, so pages can
  // listen uniformly. No modal needed; the operator already saw this
  // pick in the recents strip.
  const pickRecent = useCallback((r) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("vela:picker:committed", {
        detail: {
          value: r.value,
          name: r.name,
          isCombo: !!r.isCombo,
          source: "quickadd-recent",
        },
      })
    );
  }, []);

  // Open the redesigned modal. We prefill the modal's internal search by
  // setting its initialSearch prop; for now we open it fresh — the
  // redesigned modal already opens with recents at the top, so the
  // search-then-pick path is one extra click.
  const openPicker = useCallback((q) => {
    if (q && q.trim()) setQuery(q.trim());
    setPickerOpen(true);
  }, []);

  const handlePickerSelect = useCallback((model) => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("vela:picker:committed", {
          detail: {
            value: model?.value || model?.name,
            name: model?.name || model?.value,
            isCombo: false,
            source: "quickadd-picker",
          },
        })
      );
    }
    setPickerOpen(false);
  }, []);

  const visibleRecents = recents.slice(0, RECENTS_VISIBLE);

  return (
    <>
      <div
        className={cn(
          "hidden lg:flex items-center gap-2 px-6 lg:px-10 py-2.5",
          "border-b border-border-subtle bg-surface-2/30",
          "shrink-0"
        )}
        role="toolbar"
        aria-label="Quick add"
      >
        <div className="relative flex-1 max-w-sm">
          <span
            className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted text-[15px]"
            aria-hidden="true"
          >
            search
          </span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                openPicker(query);
              }
            }}
            placeholder="Search models or combos…"
            aria-label="Search models or combos"
            className={cn(
              "w-full pl-8 pr-3 py-1.5 bg-surface border border-border rounded-md text-xs",
              "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50",
              "placeholder:text-text-subtle"
            )}
          />
        </div>

        {visibleRecents.length > 0 && (
          <>
            <span
              className="text-[10px] font-semibold text-text-muted uppercase tracking-wider px-1"
              aria-hidden="true"
            >
              Recent
            </span>
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {visibleRecents.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => pickRecent(r)}
                  title={r.isCombo ? `Activate combo ${r.name}` : `Pick ${r.name}`}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs",
                    "border border-border-subtle bg-surface text-text-main",
                    "hover:border-primary/50 hover:bg-primary/5 transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                    "max-w-[10rem] truncate"
                  )}
                >
                  <span
                    className={cn(
                      "material-symbols-outlined shrink-0",
                      r.isCombo ? "text-primary" : "text-text-muted"
                    )}
                    style={{ fontSize: "12px" }}
                    aria-hidden="true"
                  >
                    {r.isCombo ? "layers" : "history"}
                  </span>
                  <span className="font-mono truncate">{r.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="shrink-0 ml-auto">
          <button
            type="button"
            onClick={() => openPicker(query)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md",
              "bg-primary text-white text-xs font-medium",
              "hover:bg-primary-hover transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            )}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }} aria-hidden="true">add</span>
            Add model
          </button>
        </div>
      </div>

      <ModelSelectModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePickerSelect}
        title="Quick add — pick a model"
        // activeProviders and modelAliases are loaded inside the modal; we
        // intentionally pass no overrides so the modal falls back to its
        // own fetch path. Active providers come from /api/provider-nodes.
      />
    </>
  );
}
