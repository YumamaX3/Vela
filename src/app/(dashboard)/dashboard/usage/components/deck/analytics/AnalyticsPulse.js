// Usage Observatory W2-D — the compact topology pulse + 3 live tiles
// (sealed plan Deck-2 header). The full kame topology lives on Overview Row B;
// here the health question gets a distilled instrument: error rate, p95
// latency, and active-now — each a live tile fed by the SSE perProvider
// frame, the percentiles endpoint, and the active-request gauge.
"use client";

import { useMemo } from "react";
import Card from "@/shared/components/Card";
import { useUsageStream } from "../../../hooks/useUsageStream";
import { useMetrics } from "../../../hooks/useMetrics";
import { t } from "../../../lib/t";

const fmtMs = (ms) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);
const fmtPct = (n) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);

function LiveTile({ icon, label, value, tone = "text-text", title }) {
  return (
    <Card className="flex min-w-0 items-center gap-3 px-4 py-3" padding="none" title={title}>
      <span className="material-symbols-outlined shrink-0 text-[22px] text-text-muted">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
        <span className={`truncate text-xl font-bold tabular-nums ${tone}`} data-i18n-skip="true">{value}</span>
      </span>
    </Card>
  );
}

export default function AnalyticsPulse({ compass }) {
  // SSE frame: perProvider {name: {requests, errors}} + activeRequests gauge.
  const { stats } = useUsageStream(compass.period);
  // Percentiles endpoint: two-tier honest latency p50/p95/p99.
  const { data: pct } = useMetrics("percentiles", compass.metricsQuery);

  // Rolling error rate across the ≤30s perProvider window.
  const errorRate = useMemo(() => {
    const pp = stats?.perProvider || {};
    let req = 0, err = 0;
    for (const f of Object.values(pp)) {
      req += f?.requests || 0;
      err += f?.errors || 0;
    }
    return req > 0 ? err / req : null;
  }, [stats]);

  const activeNow = useMemo(() => (stats?.activeRequests || []).length, [stats]);
  const p95 = pct?.latency?.p95 ?? null;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
      <LiveTile
        icon="warning"
        label={t("Error rate")}
        value={fmtPct(errorRate)}
        tone={errorRate != null && errorRate > 0.1 ? "text-error" : "text-text"}
        title={t("Is it healthy?")}
      />
      <LiveTile
        icon="speed"
        label="p95 latency"
        value={fmtMs(p95)}
        title={pct?.meta?.approximate ? "approximate (rollup histogram)" : "exact nearest-rank"}
      />
      <LiveTile
        icon="monitoring"
        label="Active now"
        value={String(activeNow)}
        tone={activeNow > 0 ? "text-primary" : "text-text"}
      />
    </div>
  );
}
