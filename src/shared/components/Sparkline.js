/**
 * 📈 Sparkline — Simple SVG line/area chart for trends
 */
"use client";

export default function Sparkline({ data, color = "var(--color-brand-500)" }) {
  if (!data || data.length === 0) return null;

  const W = 100;
  const H = 32;
  const max = Math.max(...data);
  const min = Math.min(...data);

  // Normalize points
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * W,
    y: H - 3 - ((v - min) / (max - min || 1)) * (H - 6),
  }));

  // Create area path
  const areaPath = `M 0,${H} L ${points.map(p => `${p.x},${p.y}`).join(" L ")} L ${W},${H} Z`;

  // Create line path
  const linePoints = points.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-20">
      <defs>
        <linearGradient id="spark-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#spark-gradient)" />
      <polyline
        points={linePoints}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
