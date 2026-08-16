// Usage Observatory W2-D — Latency panel (sealed plan Deck-2 "LatencyLines").
// Window latency p50/p95/p99 from the two-tier percentiles endpoint, with a
// latency/TTFT toggle. Honest about its tier: exact nearest-rank ≤3d,
// approximate rollup histogram beyond (meta.approximate + coverage surface
// the truth). When no latency samples exist yet, the panel says so — the
// "collecting since the telemetry upgrade" honesty, never a fabricated zero.
"use client";

import { useState } from "react";
import ChartPanel from "./ChartPanel";
import { useMetrics } from "../../../hooks/useMetrics";

const fmtMs = (ms) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

const TIERS = [
  { key: "p50", label: "p50", color: "#4ade80" },
  { key: "p95", label: "p95", color: "#f59e0b" },
  { key: "p99", label: "p99", color: "#ef4444" },
];

export default function LatencyPanel({ compass }) {
  const [showTtft, setShowTtft] = useState(false);
  const { data } = useMetrics("percentiles", compass.metricsQuery);

  const values = showTtft ? data?.ttft : data?.latency;
  const count = showTtft ? data?.meta?.ttftCount : data?.meta?.count;
  const hasData = data && (count ?? 0) > 0;
  const max = hasData ? Math.max(...TIERS.map((t) => values?.[t.key] ?? 0), 1) : 1;

  const subtitle = !data
    ? ""
    : data.meta?.approximate
      ? `approximate · ${(Math.round((data.meta.coverage ?? 0) * 100))}% days carry latency buckets`
      : `exact nearest-rank · ${count} samples`;

  return (
    <ChartPanel
      title={showTtft ? "TTFT" : "Latency"}
      subtitle={subtitle}
      action={
        <div className="flex items-center gap-1 rounded-lg border border-border bg-bg-subtle p-0.5">
          <button
            type="button"
            onClick={() => setShowTtft(false)}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${!showTtft ? "bg-primary text-white" : "text-text-muted hover:text-text"}`}
          >
            Latency
          </button>
          <button
            type="button"
            onClick={() => setShowTtft(true)}
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${showTtft ? "bg-primary text-white" : "text-text-muted hover:text-text"}`}
          >
            TTFT
          </button>
        </div>
      }
    >
      {!hasData ? (
        <div className="flex h-full items-center justify-center text-center text-sm text-text-muted">
          No {showTtft ? "TTFT" : "latency"} samples yet — collecting since the telemetry upgrade.
        </div>
      ) : (
        <div className="flex h-full flex-col justify-center gap-3">
          {TIERS.map((t) => {
            const v = values?.[t.key];
            const width = v != null && max > 0 ? Math.max(2, (v / max) * 100) : 0;
            return (
              <div key={t.key} className="flex items-center gap-2" title={tooltipTitle(t.label, v)}>
                <span className="w-8 shrink-0 text-[11px] font-semibold text-text-muted">{t.label}</span>
                <span className="block h-3 flex-1 overflow-hidden rounded-full bg-bg-subtle">
                  <span className="block h-full rounded-full" style={{ width: `${width}%`, backgroundColor: t.color }} />
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-text" data-i18n-skip="true">
                  {fmtMs(v)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </ChartPanel>
  );
}

function tooltipTitle(label, v) {
  return `${label}: ${fmtMs(v)}`;
}
