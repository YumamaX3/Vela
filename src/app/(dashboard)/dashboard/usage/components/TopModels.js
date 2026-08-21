// Top Models Component — horizontal orange bars showing top models by usage.
// Reads /api/usage/metrics/breakdown?dimension=model&metric=requests which
// returns { items: [{ model, value }], meta } — never a plain array.
"use client";

import { useMetrics } from "../hooks/useMetrics";
import Card from "@/shared/components/Card";

export default function TopModels({ period }) {
  if (!period) return null; // Will be populated by parent

  const { data, loading } = useMetrics(
    "breakdown",
    `period=${period}&dimension=model&metric=requests`,
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
        <p className="text-text-muted text-sm">No model data available</p>
      </Card>
    );
  }

  const maxCount = Math.max(...items.map((d) => d.value || 0));

  return (
    <Card header="Top Models" className="flex flex-col">
      <div className="flex flex-col gap-3">
        {items.slice(0, 5).map((model, i) => {
          const percent = maxCount > 0 ? ((model.value / maxCount) * 100) : 0;
          return (
            <div key={i} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-text-main truncate">{model.model}</span>
                <span className="text-text-muted tabular-nums">{formatNumber(model.value)}</span>
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

function formatNumber(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return Math.round(v).toString();
}
