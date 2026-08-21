// Usage Observatory W2-B — the tab rail (sealed plan W2(b)).
// The four question-shaped decks as bearings, URL-driven (?tab=…), with
// arrow-key navigation (the Manifest graft). Each bearing carries its anchor
// question-string — the four seeded i18n anchors.
"use client";

import { useRef } from "react";
import { t } from "../../lib/t";
import { DECKS } from "../../hooks/useCompassFilters";

const BEARINGS = [
  { value: "overview", icon: "paid", label: "Overview", question: "Where did the money go?" },
  { value: "analytics", icon: "monitor_heart", label: "Analytics", question: "Is it healthy?" },
  { value: "requests", icon: "receipt_long", label: "Requests", question: "What happened?" },
  { value: "quota", icon: "data_usage", label: "Quota", question: "What are my quotas?" },
  { value: "providers", icon: "cloud", label: "Providers", question: "How do providers perform?" },
  { value: "logs", icon: "table_chart", label: "Logs", question: "What does the traffic look like?" },
];

export default function TabRail({ tab, setTab }) {
  const railRef = useRef(null);

  const onKeyDown = (e) => {
    const idx = DECKS.indexOf(tab);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      setTab(DECKS[(idx + 1) % DECKS.length]);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      setTab(DECKS[(idx - 1 + DECKS.length) % DECKS.length]);
    }
  };

  return (
    <div
      ref={railRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-1 sm:flex-row sm:items-stretch"
    >
      {BEARINGS.map((b) => {
        const active = tab === b.value;
        return (
          <button
            key={b.value}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => setTab(b.value)}
            className={`flex flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
              active
                ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                : "text-text-muted hover:bg-bg-hover hover:text-text"
            }`}
          >
            <span className="material-symbols-outlined text-[22px]" aria-hidden="true">{b.icon}</span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-semibold leading-tight">{t(b.label)}</span>
              <span className={`truncate text-xs leading-tight ${active ? "text-primary/80" : "text-text-muted/70"}`}>
                {t(b.question)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
