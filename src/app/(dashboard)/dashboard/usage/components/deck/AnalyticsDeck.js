// Usage Observatory W2-D — the Analytics deck, "Is it healthy?"
// Replaces the W2-B collecting-state placeholder with the sealed Deck-2
// composition (phase7): a compact pulse header (3 live tiles — error rate,
// p95 latency, active now) above six ChartPanel panels in a 2-up grid:
// LatencyPanel · ErrorMix · CacheShare · CostPerMtok · UsageByKey ·
// RtkSavings. Every panel is funded from existing metrics endpoints; panels
// the telemetry doesn't yet fund render honest collecting-states, never
// fabricated charts. W4-D landed the HealthTimeline strips — the uptime row
// that leads the deck.
"use client";

import AnalyticsPulse from "./analytics/AnalyticsPulse";
import HealthTimeline from "./analytics/HealthTimeline";
import LatencyPanel from "./analytics/LatencyPanel";
import ErrorMix from "./analytics/ErrorMix";
import CacheShare from "./analytics/CacheShare";
import CostPerMtok from "./analytics/CostPerMtok";
import UsageByKey from "./analytics/UsageByKey";
import RtkSavings from "./analytics/RtkSavings";

export default function AnalyticsDeck({ compass }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* W4-D — the uptime row. Full-width above the pulse: the fastest read
          on "is it healthy?" is one strip per provider, one cell per day. */}
      <HealthTimeline compass={compass} />
      <AnalyticsPulse compass={compass} />
      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <LatencyPanel compass={compass} />
        <ErrorMix compass={compass} />
        <CacheShare compass={compass} />
        <CostPerMtok compass={compass} />
        <UsageByKey compass={compass} />
        <RtkSavings compass={compass} />
      </div>
    </div>
  );
}
