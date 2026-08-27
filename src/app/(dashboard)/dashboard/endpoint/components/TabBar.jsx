"use client";

import { translate } from "@/i18n/runtime";

const TABS = [
  { key: "overview", icon: "space_dashboard", label: "Overview" },
  { key: "keys", icon: "vpn_key", label: "Keys" },
  { key: "tools", icon: "construction", label: "Tools" },
  { key: "audit", icon: "receipt_long", label: "Audit" },
];

/**
 * The tab bar — reads the `tab` URL facet and switches via setFacets. Pure
 * navigation chrome: each tab is a link to a canonical URL so deep-linking
 * works, and the active pill reflects the validated facet state.
 */
export default function TabBar({ active, onSelect }) {
  return (
    <nav
      className="flex items-center gap-1 p-1 rounded-[12px] bg-surface-2 border border-border-subtle w-fit"
      role="tablist"
      aria-label={translate("Endpoint sections")}
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
