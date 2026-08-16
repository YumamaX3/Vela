// Usage Observatory W2-D — shared stacked-series pivot.
// The stacked endpoint returns {series:[{key,total,points:[{t,value}]}]}; the
// chart panels need recharts rows keyed by bucket t with one column per series.
// One pivot for ErrorMix + UsageByKey so the shape never drifts between them.
export function bucketLabel(t, granularity) {
  const d = new Date(t);
  if (granularity === "1d") return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function pivotStacked(data, granularity) {
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

export const tooltipStyle = {
  backgroundColor: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "12px",
};
