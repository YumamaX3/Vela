// Usage Observatory W2-C — Row A: the KPI row (sealed plan Deck-1 row 1).
// Six cards: Requests · Est. Cost (~ prefix, $/Mtok subtext) · Input Tokens ·
// Output Tokens · Cached Tokens · RTK Savings (~$). Each carries the
// delta-vs-previous-window arrow from the kpis endpoint's {value, previous,
// delta} envelopes. Type scale is the sealed 24/11/12; tabular-nums keep the
// figures steady as they tick.
"use client";

import { useMemo } from "react";
import Card from "@/shared/components/Card";
import { useMetrics } from "../../../hooks/useMetrics";
import { t } from "../../../lib/t";

const fmt = (n) => new Intl.NumberFormat().format(Math.round(n || 0));
const fmtCost = (n) => (!n || n <= 0 ? "$0.00" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const fmtDelta = (n, cost) => {
  const v = Math.abs(n || 0);
  const body = cost ? fmtCost(v) : fmt(v);
  return `${n > 0 ? "+" : "−"}${body}`;
};

function DeltaBadge({ delta, cost = false }) {
  if (!delta) return <span className="text-[12px] text-text-muted/60">–</span>;
  const up = delta > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[12px] font-medium ${up ? "text-success" : "text-error"}`}
      title={`vs previous period: ${fmtDelta(delta, cost)}`}
    >
      <span className="material-symbols-outlined text-[13px] leading-none">{up ? "arrow_upward" : "arrow_downward"}</span>
      <span data-i18n-skip="true">{fmtDelta(delta, cost)}</span>
    </span>
  );
}

export default function KpiRow({ compass }) {
  const { data } = useMetrics("kpis", compass.metricsQuery);

  // $/Mtok subtext for the Est. Cost card — cost per million tokens across
  // the whole window (requests carry tokens, not the other way around).
  const perMtok = useMemo(() => {
    const tokens = (data?.promptTokens?.value || 0) + (data?.completionTokens?.value || 0);
    const cost = data?.cost?.value || 0;
    if (!tokens || !cost) return null;
    const v = (cost / tokens) * 1_000_000;
    return v < 0.01 ? "<$0.01" : `$${v.toFixed(2)}`;
  }, [data]);

  const cards = useMemo(() => {
    if (!data) return [];
    // The third line keeps a uniform 12px rhythm across all six cards; cards
    // with nothing honest to say there hold the space with a non-breaking
    // pad. Only the cost-funded cards carry the "estimated" note — tokens
    // are measured, never ~.
    const pad = " ";
    return [
      { label: "Requests", kpi: data.requests, render: (v) => fmt(v), sub: pad },
      { label: "Est. Cost", kpi: data.cost, render: (v) => `~${fmtCost(v)}`, cost: true, sub: perMtok ? `${perMtok}/Mtok` : pad, subSkip: !!perMtok },
      { label: "Input Tokens", kpi: data.promptTokens, render: (v) => fmt(v), sub: pad },
      { label: "Output Tokens", kpi: data.completionTokens, render: (v) => fmt(v), sub: pad },
      { label: "Cached Tokens", kpi: data.cachedTokens, render: (v) => fmt(v), sub: pad },
      { label: "RTK Savings", kpi: data.rtkSavedCostUsd, render: (v) => `~${fmtCost(v)}`, cost: true, sub: t("estimated") },
    ];
  }, [data, perMtok]);

  if (!data) {
    return (
      <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Card key={i} className="h-[84px] animate-pulse" padding="none" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => (
        <Card key={c.label} className="flex min-w-0 flex-col gap-1 px-4 py-3" padding="none">
          <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            {t(c.label)}
          </span>
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-2xl font-bold tabular-nums" data-i18n-skip="true">
              {c.render(c.kpi.value)}
            </span>
            <DeltaBadge delta={c.kpi.delta} cost={c.cost} />
          </span>
          <span className="text-[12px] text-text-muted" data-i18n-skip={c.subSkip ? "true" : undefined}>
            {c.sub}
          </span>
        </Card>
      ))}
    </div>
  );
}
