// Usage Observatory W2-E — ledger formatters, one copy.
// Per-request values need finer precision than KPI totals: costs are
// four-decimal (a single request rarely crosses a cent), latencies collapse
// to seconds past 1000ms, timestamps render as clock-time (the day rides the
// Needle period). data-i18n-skip marks every numeric span at the call sites.
export const fmtTokens = (n) => (n == null ? "—" : new Intl.NumberFormat().format(Math.round(n)));

export const fmtRowCost = (n) =>
  n == null || n <= 0 ? "$0.0000" : n < 0.0001 ? "<$0.0001" : `$${n.toFixed(4)}`;

export const fmtMs = (ms) =>
  ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

export const fmtTime = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

export const fmtDateTime = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};
