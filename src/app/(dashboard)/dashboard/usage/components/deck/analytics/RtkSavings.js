// Usage Observatory W2-D — RtkSavings panel (sealed plan Deck-2).
// RTK (token-saver) savings are funded at write time into each request's
// meta.rtkSavedCostUsd. The daily rollup does NOT persist an RTK counter
// (the rollup writer only accumulates requests/tokens/cost + status +
// latency buckets), so there is no honest way to draw savings-over-time —
// an area chart here would be fabricated. Instead this panel shows the
// honest window total and its delta vs the previous period (from the kpis
// envelope), and says plainly that a time-series arrives when the rollup
// carries an RTK counter. Never draw what the data does not fund.
"use client";

import ChartPanel from "./ChartPanel";
import { useMetrics } from "../../../hooks/useMetrics";
import { t } from "../../../lib/t";

const fmtCost = (n) => (!n || n <= 0 ? "$0.00" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

export default function RtkSavings({ compass }) {
  const { data } = useMetrics("kpis", compass.metricsQuery);
  const kpi = data?.rtkSavedCostUsd;

  return (
    <ChartPanel title="RTK savings" subtitle="tokens the RTK saver compressed" estimated collecting>
      {!kpi ? (
        <div className="flex h-full items-center justify-center text-sm text-text-muted">
          No data for this period
        </div>
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <span className="text-3xl font-bold tabular-nums text-success" data-i18n-skip="true">
            ~{fmtCost(kpi.value)}
          </span>
          <span className="text-xs text-text-muted">
            saved this period
            {kpi.delta !== 0 && (
              <span className={kpi.delta > 0 ? " text-success" : " text-error"}> · {kpi.delta > 0 ? "+" : "−"}{fmtCost(Math.abs(kpi.delta))} vs previous</span>
            )}
          </span>
          <span className="max-w-xs text-center text-[11px] text-text-muted/60">
            {t("Cost and savings are estimates computed from pricing at write time")}
          </span>
        </div>
      )}
    </ChartPanel>
  );
}
