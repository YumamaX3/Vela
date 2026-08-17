// Usage Observatory W4-D — provider health timeline strips (sealed plan W4-D).
// The Analytics deck's uptime row: one strip per provider, one cell per day.
// Green = a clean day; a colored cell names its dominant trouble (the shared
// status palette, one copy with the rest of the deck); a hollow cell saw no
// traffic — the strip says "no data", never a fabricated clean. The data
// rides the two-tier engine: ≤3d an exact local-day scan, 7d+ the
// usageDaily.statusByProvider rollup. Pre-telemetry days render hollow too —
// collecting, never guessed. Fail-open like every panel: a failed fetch
// leaves the honest quiet state, never a broken deck.
"use client";

import ChartPanel from "./ChartPanel";
import { useMetrics } from "../../../hooks/useMetrics";
import { STATUS_COLORS, statusClassLabel } from "../../../lib/statusColors";
import { t } from "../../../lib/t";

function cellTitle(date, cell) {
  const base = `${date} · ${t("{n} requests", { n: cell.requests })}`;
  if (!cell.errors) return base;
  const kind = cell.dominant ? ` (${statusClassLabel(cell.dominant)})` : "";
  return `${base} · ${t("{n} errors", { n: cell.errors })}${kind}`;
}

function cellColor(cell) {
  if (!cell.requests) return null; // hollow — no traffic that day
  if (!cell.errors) return STATUS_COLORS.ok;
  return STATUS_COLORS[cell.dominant] || STATUS_COLORS.upstream_error;
}

function Strip({ strip }) {
  const uptime = strip.totalRequests
    ? Math.round((1 - strip.totalErrors / strip.totalRequests) * 1000) / 10
    : null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-32 shrink-0 truncate text-[11px] font-medium text-text" title={strip.providerDisplayName}>
        {strip.providerDisplayName}
      </span>
      <div className="flex min-w-0 flex-1 items-stretch gap-px">
        {strip.cells.map((cell) => {
          const color = cellColor(cell);
          return (
            <span
              key={cell.date}
              title={cell.requests ? cellTitle(cell.date, cell) : `${cell.date} · ${t("No traffic in this window")}`}
              className={`h-4 min-w-0 flex-1 rounded-[2px] ${color ? "" : "border border-border/60"}`}
              style={color ? { backgroundColor: color } : undefined}
            />
          );
        })}
      </div>
      <span
        className="w-14 shrink-0 text-right text-[11px] tabular-nums text-text-muted"
        data-i18n-skip="true"
        title={`${strip.totalRequests} requests · ${strip.totalErrors} errors`}
      >
        {uptime == null ? "—" : `${uptime}%`}
      </span>
    </div>
  );
}

export default function HealthTimeline({ compass }) {
  const { metricsQuery } = compass;
  const { data, loading } = useMetrics("health-timeline", metricsQuery);
  const strips = data?.strips || [];
  const truncated = Boolean(data?.truncated);

  return (
    <ChartPanel
      title={t("Provider health")}
      subtitle={t("Daily strips per provider — green is clean, colored cells name the dominant trouble, hollow days saw no traffic.")}
      height={Math.max(64, strips.length * 24 + 24)}
    >
      {loading ? (
        <div className="flex h-full flex-col justify-center gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-bg-subtle" />
          ))}
        </div>
      ) : strips.length === 0 ? (
        <div className="flex h-full items-center justify-center text-xs text-text-muted">
          {t("No traffic in this window")}
        </div>
      ) : (
        <div className="flex h-full flex-col justify-center gap-2 overflow-y-auto">
          {strips.map((strip) => (
            <Strip key={strip.provider || "(unknown)"} strip={strip} />
          ))}
          {truncated && (
            <span className="text-[11px] text-text-muted/70" data-i18n-skip="true">
              {t("Showing the top {n} providers by traffic", { n: strips.length })}
            </span>
          )}
        </div>
      )}
    </ChartPanel>
  );
}
