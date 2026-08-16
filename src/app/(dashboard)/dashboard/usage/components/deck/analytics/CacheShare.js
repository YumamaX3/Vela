// Usage Observatory W2-D — CacheShare panel (sealed plan Deck-2).
// Cached-token share over time + estimated savings. Funded by the timeseries
// endpoint (metric=cachedTokens, real time-series) with the window share from
// the kpis endpoint. Savings are a pricing-at-write-time estimate, marked ~.
"use client";

import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import ChartPanel from "./ChartPanel";
import { useMetrics } from "../../../hooks/useMetrics";
import { bucketLabel, tooltipStyle } from "../../../lib/stackedPivot";

const fmtTokens = (n) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n || 0));
};

export default function CacheShare({ compass }) {
  const { data: ts } = useMetrics("timeseries", compass.metricsQuery, "metric=cachedTokens");
  const { data: kpis } = useMetrics("kpis", compass.metricsQuery);
  const granularity = ts?.meta?.granularity || compass.granularity;

  const rows = useMemo(
    () => (ts?.points || []).map((p) => ({ ...p, label: bucketLabel(p.t, granularity) })),
    [ts, granularity]
  );

  // Window cache share = cached / (prompt+completion) from the kpis envelope.
  const share = useMemo(() => {
    if (!kpis) return null;
    const cached = kpis.cachedTokens?.value || 0;
    const prompt = kpis.promptTokens?.value || 0;
    const completion = kpis.completionTokens?.value || 0;
    const denom = prompt + completion;
    return denom > 0 ? cached / denom : null;
  }, [kpis]);

  return (
    <ChartPanel
      title="Cache share"
      subtitle={share != null ? `${(share * 100).toFixed(1)}% of tokens cached` : ""}
      estimated
    >
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradCache" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={fmtTokens} width={44} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value) => [fmtTokens(value), "Cached tokens"]} />
            <Area type="monotone" dataKey="value" stroke="#22d3ee" strokeWidth={2} fill="url(#gradCache)" dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartPanel>
  );
}

function Empty() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-text-muted">
      No data for this period
    </div>
  );
}
