"use client";

import { translate } from "@/i18n/runtime";
import { healthLabel } from "../lib/keyFormat";

const STYLES = {
  healthy: { text: "text-green-600 dark:text-green-400", chip: "bg-green-500/10 border-green-500/30", icon: "check_circle", label: "Healthy" },
  revoked: { text: "text-red-600 dark:text-red-400", chip: "bg-red-500/10 border-red-500/30", icon: "block", label: "Revoked (legacy)" },
  "near-limit": { text: "text-amber-600 dark:text-amber-400", chip: "bg-amber-500/10 border-amber-500/30", icon: "warning", label: "Near limit" },
  "low-use": { text: "text-text-muted", chip: "bg-surface-2 border-border-subtle", icon: "snooze", label: "Low use" },
  stale: { text: "text-red-600 dark:text-red-400", chip: "bg-red-500/10 border-red-500/30", icon: "schedule", label: "Stale" },
};

/**
 * Health bar + label for a key — shared by the row and the drawer. The bar
 * shows budget usage when a budget exists; the label comes from healthLabel
 * (stale wins, then low-use, then near-limit, else healthy).
 */
export default function KeyHealth({ healthKey: k, usage, health, size = "sm" }) {
  const labeledKey = health ? { ...k, health } : k;
  const label = healthLabel(labeledKey, usage);
  const style = STYLES[label] || STYLES.healthy;
  const budgetRatio = labeledKey?.health?.budgetRatio ?? usage?.budgetRatio ?? null;
  const pct = budgetRatio != null ? Math.max(0, Math.min(100, Math.round(budgetRatio * 100))) : null;

  return (
    <div className="flex items-center gap-2">
      {pct != null ? (
        <div className="w-16 h-1.5 rounded-full bg-surface-3 overflow-hidden" title={translate("Budget used")}>
          <div
            className={`h-full rounded-full transition-all ${pct >= 80 ? "bg-red-500" : pct >= 50 ? "bg-amber-500" : "bg-green-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : (
        <span className="w-16 h-1.5 rounded-full bg-surface-3 block" title={translate("No budget set")} />
      )}
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${style.chip} ${style.text}`}
        title={translate("Health")}
      >
        <span className="material-symbols-outlined text-[11px]">{style.icon}</span>
        {translate(style.label)}
      </span>
    </div>
  );
}
