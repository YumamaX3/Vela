// Usage Observatory W2-D — UsageByKey panel (sealed plan Deck-2).
// Requests by API key over time — who is calling the gateway. Funded by the
// stacked endpoint with dimension=keyId (top-6 + Other). The key labels stay
// as the engine returns them (keyId or "local-no-key"); a friendly-name join
// would need a new endpoint and rides the backlog (documented debt).
"use client";

import { useMemo } from "react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import ChartPanel from "./ChartPanel";
import { useMetrics } from "../../../hooks/useMetrics";
import { pivotStacked, tooltipStyle } from "../../../lib/stackedPivot";

const fmt = (n) => new Intl.NumberFormat().format(Math.round(n || 0));
const COLORS = ["#6366f1", "#22d3ee", "#4ade80", "#f59e0b", "#f472b6", "#a78bfa"];
const OTHER_COLOR = "#64748b";

export default function UsageByKey({ compass }) {
  const { data } = useMetrics("stacked", compass.metricsQuery, "dimension=keyId&metric=requests");
  const granularity = data?.meta?.granularity || compass.granularity;
  const { rows, keys } = useMemo(() => pivotStacked(data, granularity), [data, granularity]);

  return (
    <ChartPanel title="Usage by key" subtitle="requests by API key">
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={fmt} width={44} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [fmt(value), name]} />
            {keys.map((key, i) => (
              <Area
                key={key}
                type="monotone"
                dataKey={key}
                stackId="bykey"
                stroke={key === "Other" ? OTHER_COLOR : COLORS[i % COLORS.length]}
                fill={key === "Other" ? OTHER_COLOR : COLORS[i % COLORS.length]}
                fillOpacity={0.55}
                strokeWidth={1}
              />
            ))}
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
