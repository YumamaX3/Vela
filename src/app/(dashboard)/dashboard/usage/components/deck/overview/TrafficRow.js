// Usage Observatory W2-C — Row C: traffic over time (sealed plan Deck-1 row 3).
// TrafficStackedArea — requests by provider (top-6 + Other) from the stacked
// endpoint, each band click-to-filter into the Needle. Beside it, CostArea —
// the cost curve from the timeseries endpoint, carrying a reserved
// compare-ghost slot that W3 fills with the previous-period overlay.
"use client";

import { useMemo, useCallback } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";
import { useMetrics } from "../../../hooks/useMetrics";
import { t } from "../../../lib/t";

const fmtTokens = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n || 0));
};
const fmtCost = (n) => (n || 0) < 0.01 && n > 0 ? "<$0.01" : `$${(n || 0).toFixed(4)}`;

function bucketLabel(t, granularity) {
  const d = new Date(t);
  if (granularity === "1d") return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// The sealed top-6 palette + a neutral grey for the folded "Other" band.
const STACK_COLORS = ["#6366f1", "#22d3ee", "#4ade80", "#f59e0b", "#f472b6", "#a78bfa"];
const OTHER_COLOR = "#64748b";

const tooltipStyle = {
  backgroundColor: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "12px",
};

/** Pivot stacked series ({series:[{key,points:[{t,value}]}]}) into recharts
 *  rows keyed by bucket t, one column per series. */
function pivotStacked(data, granularity) {
  if (!data?.series?.length) return { rows: [], keys: [] };
  const byBucket = new Map();
  for (const s of data.series) {
    for (const p of s.points || []) {
      if (!byBucket.has(p.t)) byBucket.set(p.t, { t: p.t, label: bucketLabel(p.t, granularity) });
      byBucket.get(p.t)[s.key] = (byBucket.get(p.t)[s.key] || 0) + (p.value || 0);
    }
  }
  const rows = [...byBucket.values()].sort((a, b) => a.t - b.t);
  return { rows, keys: data.series.map((s) => s.key) };
}

function EmptyChart({ height = 220 }) {
  return (
    <div className="flex items-center justify-center text-text-muted text-sm" style={{ height }}>
      {t("No data for this period")}
    </div>
  );
}

function TrafficStackedArea({ compass }) {
  const { data } = useMetrics("stacked", compass.metricsQuery, "dimension=provider&metric=requests");
  const granularity = data?.meta?.granularity || compass.granularity;
  const { rows, keys } = useMemo(() => pivotStacked(data, granularity), [data, granularity]);

  const onBandClick = useCallback((key) => {
    if (!key || key === "Other") return; // Other is a fold, not a provider
    compass.setFacet("provider", compass.provider === key ? "" : key);
  }, [compass]);

  return (
    <Card className="flex min-w-0 flex-col gap-2 p-4" padding="none">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {t("Requests")}
      </span>
      {rows.length === 0 ? (
        <EmptyChart />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={fmtTokens} width={44} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, name) => [fmtTokens(value), name]}
            />
            {keys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="traffic"
                stroke={key === "Other" ? OTHER_COLOR : STACK_COLORS[i % STACK_COLORS.length]}
                fill={key === "Other" ? OTHER_COLOR : STACK_COLORS[i % STACK_COLORS.length]}
                fillOpacity={0.55}
                strokeWidth={1}
                onClick={() => onBandClick(key)}
                className={key !== "Other" ? "cursor-pointer" : undefined}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

function CostArea({ compass }) {
  const { data } = useMetrics("timeseries", compass.metricsQuery, "metric=cost");
  const granularity = data?.meta?.granularity || compass.granularity;

  const rows = useMemo(
    () => (data?.points || []).map((p) => ({ ...p, label: bucketLabel(p.t, granularity) })),
    [data, granularity]
  );

  // W3 compare-ghost slot: the previous-period overlay renders here once the
  // compare-periods current lands. Reserved deliberately empty (sealed plan).

  return (
    <Card className="flex min-w-0 flex-col gap-2 p-4" padding="none">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {t("Est. Cost")}
      </span>
      {rows.length === 0 ? (
        <EmptyChart />
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradOverviewCost" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={fmtCost} width={56} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [fmtCost(value), t("Est. Cost")]} />
            <Area type="monotone" dataKey="value" stroke="#f59e0b" strokeWidth={2} fill="url(#gradOverviewCost)" dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

export default function TrafficRow({ compass }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
      <TrafficStackedArea compass={compass} />
      <CostArea compass={compass} />
    </div>
  );
}
