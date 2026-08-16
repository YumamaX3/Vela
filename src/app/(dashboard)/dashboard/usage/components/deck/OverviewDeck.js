// Usage Observatory W2-C — the Overview deck, "Where did the money go?"
// W2-B seeded it with the pre-existing UsageStats content; W2-C replaces it
// with the five sealed rows (phase7 Deck-1):
//   Row A — KpiRow (6 cards, deltas vs previous period)      [kpis]
//   Row B — LiveRow (topology halos + Live Feed rail)        [useUsageStream]
//   Row C — TrafficRow (stacked provider + CostArea ghost)   [stacked+timeseries]
//   Row D — BreakdownRow (cost bars + StatusMix donut)       [breakdown]
//   Row E — SpendersRow (UsageTable reuse, localStorage kept) [useUsageStream]
// One useUsageStream subscription feeds Rows B and E together; the REST
// metrics rows refetch off compass.metricsQuery (URL single source).
"use client";

import { useUsageStream } from "../../hooks/useUsageStream";
import KpiRow from "./overview/KpiRow";
import LiveRow from "./overview/LiveRow";
import TrafficRow from "./overview/TrafficRow";
import BreakdownRow from "./overview/BreakdownRow";
import SpendersRow from "./overview/SpendersRow";

export default function OverviewDeck({ compass }) {
  // The live stream — period rides the Needle facet; Rows B and E share it.
  const { stats } = useUsageStream(compass.period);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <KpiRow compass={compass} />
      <LiveRow compass={compass} stats={stats} />
      <TrafficRow compass={compass} />
      <BreakdownRow compass={compass} />
      <SpendersRow stats={stats} />
    </div>
  );
}
