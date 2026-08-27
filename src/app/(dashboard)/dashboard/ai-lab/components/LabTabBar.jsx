"use client";

import { translate } from "@/i18n/runtime";

const TABS = [
  { key: "injectors", icon: "science", label: "Injectors" },
  { key: "modes", icon: "dashboard_customize", label: "Modes" },
  { key: "policies", icon: "policy", label: "Policies" },
  { key: "library", icon: "local_library", label: "Library" },
  { key: "simulator", icon: "experiment", label: "Simulator" },
  { key: "observe", icon: "query_stats", label: "Observe" },
];

/**
 * The AI Lab tab bar — reads the `tab` URL facet and switches via
 * setFacets. Pure navigation chrome; deep-linking works per tab.
 */
export default function LabTabBar({ active, onSelect }) {
  return (
    <nav
      className="flex items-center gap-1 p-1 rounded-[12px] bg-surface-2 border border-border-subtle w-fit flex-wrap"
      role="tablist"
      aria-label={translate("AI Lab sections")}
    >
      {TABS.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-sm font-medium transition-all ${
              isActive
                ? "bg-primary text-white shadow-[var(--shadow-soft)]"
                : "text-text-muted hover:text-text-main hover:bg-surface-3"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
            {translate(t.label)}
          </button>
        );
      })}
    </nav>
  );
}
