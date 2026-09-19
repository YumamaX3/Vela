"use client";

// Usage signal — sparkline, totals, ok-ratio, last seen. The empty line is
// deliberately the same sentence everywhere it appears.
import { useId } from "react";
import { cn } from "@/shared/utils/cn";
import { TONES, fmt, fmtCost, okRatioOf, seriesOf, timeAgo, toneForRatio, usageTokens } from "../lib/comboFormat";

// Sparkline: coral line with a gradient wash under it. The gradient id comes
// from useId() so twenty cards on one page cannot share one <defs> entry (the
// pre-upgrade page hardcoded `combo-spark-fill` and every card after the first
// repainted with the first card's gradient).
function Sparkline({ values, width = 72, height = 20 }) {
  if (!values || values.length === 0) return null;
  const gradientId = `combo-spark-${useId().replace(/[:]/g, "")}`;
  const max = Math.max(...values, 1);
  const step = width / Math.max(values.length - 1, 1);
  const points = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(height - (v / max) * (height - 2) - 1).toFixed(1)}`
  );
  const path = `M${points.join(" L")}`;
  const area = `${path} L${width},${height} L0,${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0"
      role="img"
      aria-label={`Requests over the window: ${values.join(", ")}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke="var(--color-brand-500)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function UsageCell({ usage, size = "sm", className }) {
  if (!usage || !usage.requests) {
    return <span className={cn("text-[11px] italic text-text-muted/70", className)}>No usage in the last 24h</span>;
  }

  const ratio = okRatioOf(usage);
  const tone = toneForRatio(ratio);
  const large = size === "lg";

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <Sparkline values={seriesOf(usage)} width={large ? 160 : 72} height={large ? 40 : 20} />
      <span className={cn("text-text-muted", large ? "text-xs" : "text-[11px]")}>
        {fmt(usage.requests)} req · {fmt(usageTokens(usage))} tok · {fmtCost(usage.cost)}
      </span>
      {ratio !== null && (
        <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", TONES[tone])}>
          <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
            monitoring
          </span>
          {Math.round(ratio * 100)}% ok
        </span>
      )}
      <span className="text-[10px] text-text-muted" title={usage.lastAt || ""}>
        {timeAgo(usage.lastAt)}
      </span>
    </div>
  );
}
