// Usage Observatory W4-B — the Lookout strip, "what should I notice?".
//
// Renders the signal registry's output (/api/usage/metrics/insights) as
// compact pills between the KPI row and the live row. Every insight carries
// an i18n template + attribution params + an evidence deep-link — clicking a
// pill steers the Needle to the facet set that proves the signal. The
// quiet-state is honest: no signals → one muted line saying so. A failed
// fetch renders nothing (fail-open, like every other deck row).
//
// The interpolated values ride data-i18n-skip: t() resolves the template at
// render time, so the DOM walker must not re-process numbers or names.
// Plan: plans/mirror-usage-observatory/SEALED-PLAN.md (W4 EXPERIMENTAL).
"use client";

import { useMetrics } from "../../../hooks/useMetrics";
import { t } from "../../../lib/t";

const SEVERITY_STYLE = {
  high: { icon: "warning", cls: "border-red-500/40 bg-red-500/10 text-red-500" },
  medium: { icon: "info", cls: "border-amber-500/40 bg-amber-500/10 text-amber-500" },
  low: { icon: "visibility", cls: "border-border bg-bg-subtle text-text-muted" },
};

export default function InsightsStrip({ compass }) {
  const { data } = useMetrics("insights", compass.metricsQuery);
  const insights = Array.isArray(data?.insights) ? data.insights : null;

  // Fail-open: no data yet / fetch failed → the strip stays silent.
  if (insights === null) return null;

  // The honest quiet-state — the Lookout looked, and found nothing.
  if (insights.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-bg-subtle/40 px-3 py-2 text-xs text-text-muted">
        <span className="material-symbols-outlined text-[15px] leading-none">task_alt</span>
        {t("Nothing unusual in this window")}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {insights.map((ins) => {
        const sev = SEVERITY_STYLE[ins.severity] || SEVERITY_STYLE.low;
        return (
          <button
            key={ins.kind}
            type="button"
            onClick={() => compass.setFacets(ins.evidence || {})}
            title={t("Insights")}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors hover:opacity-80 ${sev.cls}`}
          >
            <span className="material-symbols-outlined text-[14px] leading-none">{sev.icon}</span>
            <span data-i18n-skip>{t(ins.i18nKey, ins.params)}</span>
            {ins.evidence && (
              <span className="material-symbols-outlined text-[12px] leading-none opacity-60">arrow_forward</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
