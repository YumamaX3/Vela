// Usage Observatory W2-D — CostPerMtok panel (sealed plan Deck-2).
// $/Mtok by model. The breakdown endpoint serves one metric per call, so this
// panel merges two breakdown fetches (cost + totalTokens, dimension=model) on
// the model key and computes cost-per-million-tokens client-side. Honest
// estimate (~) — pricing-at-write-time, never billing.
"use client";

import { useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import ChartPanel from "./ChartPanel";
import { useMetrics } from "../../../hooks/useMetrics";
import { tooltipStyle } from "../../../lib/stackedPivot";

const TOP_N = 8;

const fmtPerMtok = (n) => (n == null || !Number.isFinite(n) ? "—" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

export default function CostPerMtok({ compass }) {
  const { data: costData } = useMetrics("breakdown", compass.metricsQuery, "dimension=model&metric=cost");
  const { data: tokenData } = useMetrics("breakdown", compass.metricsQuery, "dimension=model&metric=totalTokens");

  const rows = useMemo(() => {
    const tokensByModel = new Map(
      (tokenData?.items || []).map((r) => [r.model, r.value || 0])
    );
    return (costData?.items || [])
      .map((r) => {
        const cost = r.value || 0;
        const tokens = tokensByModel.get(r.model) || 0;
        const perMtok = tokens > 0 ? (cost / tokens) * 1_000_000 : null;
        return { model: r.model, perMtok, cost, tokens };
      })
      .filter((r) => r.perMtok != null && r.perMtok > 0)
      .sort((a, b) => b.perMtok - a.perMtok)
      .slice(0, TOP_N);
  }, [costData, tokenData]);

  return (
    <ChartPanel title="Cost per Mtok" subtitle="by model" estimated>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }} tickLine={false} axisLine={false} tickFormatter={fmtPerMtok} />
            <YAxis type="category" dataKey="model" tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.6 }} tickLine={false} axisLine={false} width={120} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value) => [fmtPerMtok(value), "$/Mtok"]}
              labelStyle={{ fontSize: "12px" }}
            />
            <Bar dataKey="perMtok" fill="#f59e0b" radius={[0, 4, 4, 0]} />
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
