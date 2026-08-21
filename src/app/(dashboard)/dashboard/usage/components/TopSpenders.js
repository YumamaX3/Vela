// Top Spenders Component — per-key rows with spend breakdown.
// Reads /api/usage/metrics/breakdown?dimension=keyId&metric=cost which
// returns { items: [{ keyId, value }], meta } — never a plain array.
"use client";

import { useMetrics } from "../hooks/useMetrics";
import Card from "@/shared/components/Card";

export default function TopSpenders({ period }) {
  if (!period) return null; // Will be populated by parent

  const { data, loading } = useMetrics(
    "breakdown",
    `period=${period}&dimension=keyId&metric=cost`,
    ""
  );

  const items = Array.isArray(data?.items) ? data.items : [];

  if (loading) {
    return (
      <Card className="h-80 flex items-center justify-center bg-surface-2 rounded-xl p-4 border border-border-subtle">
        <div className="animate-pulse text-text-muted">Loading...</div>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="h-80 flex items-center justify-center bg-white rounded-xl p-4 border border-border-subtle">
        <p className="text-text-muted text-sm">No spending data available</p>
      </Card>
    );
  }

  const maxSpend = Math.max(...items.map((d) => d.value || 0));

  return (
    <Card header="Top Spenders" className="flex flex-col">
      <div className="flex flex-col gap-3">
        {items.slice(0, 5).map((item, i) => {
          const percent = maxSpend > 0 ? ((item.value / maxSpend) * 100) : 0;
          return (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-text-main truncate" title={item.keyId}>
                  {item.keyId}
                </span>
                <span className="text-text-muted tabular-nums">{formatCost(item.value)}</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-brand-500 to-orange-400 rounded-full transition-all duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function formatCost(v) {
  const n = Number(v) || 0;
  if (n <= 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}
