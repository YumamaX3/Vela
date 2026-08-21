// Traffic Chart Component — SVG area+line chart for time-series data.
// Reads /api/usage/metrics/timeseries which returns { points: [{ t, value }], meta }
// — never a plain array. Falls back honestly when the series is empty.
"use client";

import { useMetrics } from "../hooks/useMetrics";

export default function TrafficChart({ period }) {
  if (!period) return null;

  const { data, loading } = useMetrics(
    "timeseries",
    `period=${period}`,
    ""
  );

  const points = Array.isArray(data?.points) ? data.points : [];

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center bg-surface-2 rounded-xl p-4 border border-border-subtle">
        <div className="animate-pulse text-text-muted">Loading...</div>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center bg-white rounded-xl p-4 border border-border-subtle">
        <p className="text-text-muted text-sm">No data available for this period</p>
      </div>
    );
  }

  const maxV = Math.max(...points.map((d) => d.value || 0), 1);
  const minV = Math.min(...points.map((d) => d.value || 0), 0);
  const range = Math.max(maxV - minV, 1);
  const stepX = points.length > 1 ? 100 / (points.length - 1) : 0;
  const coords = points.map((d, i) => `${(i * stepX).toFixed(2)},${(92 - ((d.value - minV) / range) * 80).toFixed(2)}`);
  const line = coords.join(" ");
  const areaPath = `0,100 ${line} 100,100`;

  return (
    <div className="h-64 relative overflow-hidden bg-white rounded-xl p-4 border border-border-subtle">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
        {/* Area fill */}
        <polygon points={areaPath} fill="url(#gradient)" opacity="0.3" />

        {/* Line */}
        <polyline
          points={line}
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
    </div>
  );
}
