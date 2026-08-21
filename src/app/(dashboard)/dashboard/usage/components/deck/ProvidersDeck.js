// Usage Observatory W3 — Providers Deck (new bearing).
// Shows per-provider card aggregates: requests, tokens, spend for the
// selected period. Fetches /api/usage/providers and renders cards with
// CountUp animations + SpotlightCard hover.
"use client";

import { useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import CountUp from "@/shared/components/ui/CountUp";
import SpotlightCard from "@/shared/components/ui/SpotlightCard";
import { CardSkeleton } from "@/shared/components/Loading";
import { t } from "../../lib/t";

export default function ProvidersDeck({ compass }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/usage/providers?${compass.metricsQuery}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => { alive = false; };
  }, [compass.metricsQuery]);

  if (loading) {
    return <CardSkeleton />;
  }

  if (!data || !Array.isArray(data.providers) || !data.providers.length) {
    return (
      <Card padding="md">
        <p className="text-sm text-text-muted">{t("No providers yet")}</p>
      </Card>
    );
  }

  const fmtCost = (cents) => {
    if (!cents || cents <= 0) return "$0.00";
    if (cents < 0.01) return "<$0.01";
    return `$${(cents / 100).toFixed(2)}`;
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {data.providers.map((p) => (
        <SpotlightCard key={p.provider} bordered={true}>
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-text-main">{p.provider}</h3>
              <p className="text-xs text-text-muted mt-0.5">{t("Provider usage")}</p>
            </div>
            <span className="material-symbols-outlined text-[20px] text-primary">cloud</span>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">{t("Requests")}</span>
              <span className="text-sm font-medium tabular-nums text-text-main" data-i18n-skip="true">
                <CountUp start={0} end={p.requests || 0} duration={1.2} />
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">{t("Tokens")}</span>
              <span className="text-sm font-medium tabular-nums text-text-main" data-i18n-skip="true">
                <CountUp start={0} end={p.tokens || 0} duration={1.2} />
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">{t("Spend")}</span>
              <span className="text-sm font-medium tabular-nums text-success" data-i18n-skip="true">
                {fmtCost(p.spend || 0)}
              </span>
            </div>
          </div>
        </SpotlightCard>
      ))}
    </div>
  );
}
