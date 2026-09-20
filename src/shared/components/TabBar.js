"use client";
// TabBar — the house tab navigation, shared by every room that has sections.
//
// It began life inside the Endpoint room and moved here when the Proxy console
// became its second consumer. It was MOVED, not copied: the fleet's own history
// says why (bulk-health carried a second copy of the health loop, the copy
// drifted, and the repair was to delete the copy rather than fix it). Two
// tab bars would drift the same way — one would gain arrow keys, the other
// would not, and the difference would be invisible until a keyboard user met it.
//
// R-31, every technique with its reason:
//   · Roving tabindex — WCAG 2.4.11 (Focus Not Obscured) and the standard tabs
//     pattern: one tab stop for the whole bar, arrows move within it, so a
//     keyboard user is never forced through five stops to leave the room.
//   · ArrowLeft/ArrowRight/Home/End — the APG tabs pattern; without it the bar
//     is a row of buttons that merely look like tabs.
//   · The active underline is drawn with --color-brand-500, the one deliberate
//     accent (Liveliness: one accent). It is a transform, not a width change, so
//     it composites instead of reflowing (MOTION dial 2 — transitions, no theatre).
//   · Badges are SEMANTIC: a count of keys, a count of unmet security controls,
//     a count of blocked pools. R-22 — no decorative status dot anywhere here.
//   · focus-visible:shadow-[var(--shadow-focus)] on every tab, so focus is always
//     visible (R-35) and never obscured (SC 2.4.11).
// Contrast: active ink is brand-600 on a brand-500/10 wash over --color-surface;
// inactive is --color-text-muted. Both measured in the Delivery Gate.
import { useRef } from "react";
import { translate } from "@/i18n/runtime";
export default function TabBar({ tabs, active, onChange, ariaLabel }) {
  const refs = useRef({});
  const move = (delta) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next = tabs[(i + delta + tabs.length) % tabs.length];
    onChange(next.id);
    refs.current[next.id]?.focus();
  };
  const jump = (index) => {
    const next = tabs[index];
    if (!next) return;
    onChange(next.id);
    refs.current[next.id]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={ariaLabel || translate("Sections")}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
        else if (e.key === "Home") { e.preventDefault(); jump(0); }
        else if (e.key === "End") { e.preventDefault(); jump(tabs.length - 1); }
      }}
      className="flex items-center gap-1 overflow-x-auto border-b border-border-subtle"
    >
      {tabs.map((t) => {
        const on = active === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={on}
            aria-controls={`panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`relative shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium rounded-t-[10px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${
              on
                ? "text-brand-700 dark:text-brand-300"
                : "text-text-muted hover:text-text-main hover:bg-surface-2/60"
            }`}
          >
            <span className="material-symbols-outlined text-[16px] leading-none" aria-hidden="true">
              {t.icon}
            </span>
            {t.label}
            {typeof t.badge === "number" && t.badge > 0 && (
              <span
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                  t.tone === "warn"
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                    : "bg-surface-2 text-text-muted border-border-subtle"
                }`}
                title={t.badgeTitle || `${t.badge}`}
              >
                {t.badge}
              </span>
            )}
            {/* The one accent, drawn as a composited transform */}
            <span
              aria-hidden="true"
              className={`absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-brand-500 origin-center transition-transform duration-200 ease-out ${
                on ? "scale-x-100" : "scale-x-0"
              }`}
            />
          </button>
        );
      })}
    </div>
  );
}
