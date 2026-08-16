// Usage Observatory W2-C — the Overview deck, "Where did the money go?"
// W2-B seeded it with the pre-existing UsageStats content driven by the
// Needle bar's period facet; W2-C refines it into the sealed rows:
// KPI row (6 cards, deltas) → ProviderTopology Row B + Live Feed rail →
// TrafficStackedArea + CostArea → TopProviders/TopModels/StatusDonut →
// Top Spenders table.
"use client";

import { UsageStats, CardSkeleton } from "@/shared/components";
import { Suspense } from "react";

export default function OverviewDeck({ compass }) {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageStats
        period={compass.period}
        setPeriod={(v) => compass.setFacet("period", v)}
        hidePeriodSelector
      />
    </Suspense>
  );
}
