// Usage Observatory W2-B — the Compass Deck (sealed plan W2(b)).
// The page chrome that assembles the cockpit: header (title + live dot +
// CSV export) → tab rail (four question bearings, ?tab=…) → Needle bar
// (sticky global filters, URL single source) → the active deck → the
// honesty strip. Tab switches never clear filters — one URL state object
// rides across decks (dormant-facet round-trip).
//
// The old /dashboard/usage page (overview/logs/details tabs over UsageStats)
// is retired by this composition: its content survives — OverviewDeck drives
// UsageStats with the Needle's period, RequestsDeck reuses RequestDetailsTab,
// LimitsDeck reuses ProviderLimits — while the dead logs tab is gone.
"use client";

import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import { useCompassFilters } from "../../hooks/useCompassFilters";
import TabRail from "./TabRail";
import NeedleBar from "./NeedleBar";
import HonestyStrip from "./HonestyStrip";
import CockpitHeader from "./CockpitHeader";
import OverviewDeck from "./OverviewDeck";
import AnalyticsDeck from "./AnalyticsDeck";
import RequestsDeck from "./RequestsDeck";
import LimitsDeck from "./LimitsDeck";

function DeckArea({ compass }) {
  switch (compass.tab) {
    case "analytics": return <AnalyticsDeck compass={compass} />;
    case "requests": return <RequestsDeck compass={compass} />;
    case "limits": return <LimitsDeck compass={compass} />;
    case "overview":
    default: return <OverviewDeck compass={compass} />;
  }
}

function CompassDeckInner() {
  const compass = useCompassFilters();

  return (
    <div className="flex min-w-0 flex-col gap-4 px-1 sm:px-0">
      <CockpitHeader compass={compass} />

      {/* Tab rail — the four bearings */}
      <TabRail tab={compass.tab} setTab={compass.setTab} />

      {/* Needle bar — sticky global filters (URL is the single source) */}
      <div className="sticky top-0 z-20 -mx-1 bg-bg px-1 py-1 sm:-mx-0 sm:px-0">
        <NeedleBar compass={compass} />
      </div>

      {/* Deck area — lazy per tab */}
      <Suspense fallback={<CardSkeleton />}>
        <DeckArea compass={compass} />
      </Suspense>

      <HonestyStrip />
    </div>
  );
}

export default function CompassDeck() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <CompassDeckInner />
    </Suspense>
  );
}
