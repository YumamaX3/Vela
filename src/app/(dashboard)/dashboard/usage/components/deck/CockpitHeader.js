// Usage Observatory W2-B — the cockpit header (sealed plan W2(b)).
// Title + live dot + CSV export honoring the Needle filters. The export
// hits the ALWAYS_PROTECTED streaming endpoint; the browser handles the
// attachment download natively.
"use client";

import { t } from "../../lib/t";

export default function CockpitHeader({ compass }) {
  const exportHref = `/api/usage/metrics/export?${compass.metricsQuery}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-text">{t("Usage Observatory")}</h1>
        <span className="flex items-center gap-1.5 rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[11px] text-text-muted">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          {t("live")}
        </span>
      </div>
      <a
        href={exportHref}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-main transition-colors hover:bg-bg-hover"
      >
        <span className="material-symbols-outlined text-[16px]">download</span>
        {t("Export CSV")}
      </a>
    </div>
  );
}
