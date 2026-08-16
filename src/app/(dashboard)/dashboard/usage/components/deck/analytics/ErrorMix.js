// Usage Observatory W2-D — ErrorMix panel (sealed plan Deck-2).
// Stacked bars of requests by statusClass over time — the error anatomy.
// Funded by the stacked endpoint with dimension=statusClass (requests-only;
// the engine funds it from statusByProvider telemetry). Truly funded → a real
// stacked chart, each band colored by its status class.
"use client";

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import ChartPanel from "./ChartPanel";
import { useMetrics } from "../../../hooks/useMetrics";
import { pivotStacked, tooltipStyle } from "../../../lib/stackedPivot";
import { statusClassOptions } from "../../../lib/statusOptions";

const STATUS_COLORS = {
  ok: "#4ade80",
  client_error: "#f59e0b",
  upstream_error: "#ef4444",
  timeout: "#fb923c",
  rate_limited: "#a78bfa",
};

const fmt = (n) => new Intl.NumberFormat().format(Math.round(n || 0));

export default function ErrorMix({ compass }) {
  const { data } = useMetrics("stacked", compass.metricsQuery, "dimension=statusClass&metric=requests");
  const granularity = data?.meta?.granularity || compass.granularity;
  const { rows, keys } = useMemo(() => pivotStacked(data, granularity), [data, granularity]);

  // Order bands ok first, then the error classes, so healthy traffic anchors
  // the baseline and failures stack above it.
  const orderedKeys = useMemo(() => {
    const order = statusClassOptions.map((o) => o.value);
    return keys.slice().sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [keys]);

  const labelOf = useMemo(() => Object.fromEntries(statusClassOptions.map((o) => [o.value, o.label])), []);

  return (
    <ChartPanel title="Error mix">
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={fmt} width={44} />
            <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [fmt(value), labelOf[name] || name]} />
            {orderedKeys.map((key) => (
              <Bar key={key} dataKey={key} stackId="errmix" fill={STATUS_COLORS[key] || "#64748b"} />
            ))}
          </BarChart>
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
