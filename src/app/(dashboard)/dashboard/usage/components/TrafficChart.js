// Traffic Chart Component — SVG area+line chart for time-series data
"use client";

import { useMetrics } from "../hooks/useMetrics";

export default function TrafficChart({ period }) {
  if (!period) return null;

  const { data, loading } = useMetrics(
    "timeseries",
    `period=${period}`,
    ""
  );

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center bg-surface-2 rounded-xl p-4 border border-border-subtle">
        <div className="animate-pulse text-text-muted">Loading...</div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center bg-white rounded-xl p-4 border border-border-subtle">
        <p className="text-text-muted text-sm">No data available for this period</p>
      </div>
    );
  }

  const points = data.map((d, i) => `${i * (100 / (data.length - 1))},${d.y}`).join(" ");
  const areaPath = `${points} 100,100 0,100`;

  return (
    <div className="h-64 relative overflow-hidden bg-white rounded-xl p-4 border border-border-subtle">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        {/* Area fill */}
        <polygon points={areaPath} fill="url(#gradient)" opacity="0.3" />

        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke="#E56A4A"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Gradient definition */}
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#E56A4A" />
            <stop offset="100%" stopColor="#E56A4A" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {/* X-axis labels */}
      <div className="flex justify-between px-2 pb-2 mt-2 text-xs text-text-muted/60">
        {data.filter((_, i) => i % Math.ceil(data.length / 6) === 0).map((d, i) => (
          <span key={i}>{d.x}</span>
        ))}
      </div>
    </div>
  );
}
