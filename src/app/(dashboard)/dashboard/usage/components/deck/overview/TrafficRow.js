// Usage Observatory W2-C — Row C: traffic over time (sealed plan Deck-1 row 3).
// TrafficStackedArea — requests by provider (top-6 + Other) from the stacked
// endpoint, each band click-to-filter into the Needle. Beside it, CostArea —
// the cost curve from the timeseries endpoint. W3-E filled the reserved
// compare-ghost slot: a Compare toggle fetches the previous-window series and
// overlays it as a dashed grey ghost behind the cost curve.
"use client";

import { useMemo, useCallback, useState } from "react";
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

// W3-E — the compare-periods ghost. When the Star arms Compare, the card
// refetches with `previous=1`; the server aligns the previous window onto the
// current axis bucket-for-bucket (an honest null gap where the windows don't
// align) and the ghost renders as a dashed grey line behind the cost curve.
function CostArea({ compass }) {
  const [compare, setCompare] = useState(false);
  const extra = compare ? "metric=cost&previous=1" : "metric=cost";
  const { data } = useMetrics("timeseries", compass.metricsQuery, extra);
  const granularity = data?.meta?.granularity || compass.granularity;

  // The server's `previous` array is aligned onto the current axis (same
  // length, same bucket t) — zip by index. Where the previous window had no
  // data (or doesn't align), prevValue is null → the ghost breaks honestly.
  const rows = useMemo(() => {
    const pts = data?.points || [];
    const prev = data?.previous || [];
    return pts.map((p, i) => ({
      ...p,
      prevValue: prev[i] ? prev[i].value : null,
      label: bucketLabel(p.t, granularity),
    }));
  }, [data, granularity]);

  return (
    <Card className="flex min-w-0 flex-col gap-2 p-4" padding="none">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
          {t("Est. Cost")}
        </span>
        <button
          type="button"
          onClick={() => setCompare((v) => !v)}
          title={t("Compare with previous period")}
          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            compare
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-text-muted hover:bg-bg-hover"
          }`}
        >
          <span className="material-symbols-outlined text-[13px] leading-none">compare</span>
          {t("Compare")}
        </button>
      </div>
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
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value, name) => [
                fmtCost(value),
                name === "prevValue" ? `${t("Est. Cost")} (${t("previous period")})` : t("Est. Cost"),
              ]}
            />
            {compare && (
              <Area
                type="monotone"
                dataKey="prevValue"
                stroke="#64748b"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="transparent"
                dot={false}
                activeDot={{ r: 3 }}
                connectNulls={false}
              />
            )}
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
