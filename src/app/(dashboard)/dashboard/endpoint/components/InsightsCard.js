"use client";

import { Card } from "@/shared/components";
import { translate } from "@/i18n/runtime";

/**
 * Computed nudges fed by real data where available:
 *  - quota near reset (key usage vs budget from the health snapshot)
 *  - free lanes underused (top models this window from usage stats)
 *  - stale credentials (the health sweep's stale list)
 * Each row is presentational — the orchestrator supplies the computed items.
 */
export default function InsightsCard({ items }) {
  if (!items || items.length === 0) {
    return (
      <Card className="p-4">
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
          <span className="material-symbols-outlined text-primary text-[18px]">insights</span>
          {translate("Insights")}
        </h3>
        <p className="text-xs text-text-muted">{translate("Nothing unusual in this window")}</p>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-primary text-[18px]">insights</span>
        {translate("Insights")}
      </h3>
      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 text-xs rounded-lg p-2 border ${
              item.tone === "warn"
                ? "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400"
                : item.tone === "danger"
                  ? "bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-400"
                  : "bg-surface-2 border-border-subtle text-text-muted"
            }`}
          >
            <span className="material-symbols-outlined text-[14px] shrink-0 mt-0.5">{item.icon || "info"}</span>
            <span className="min-w-0">{item.text}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
