// Usage Observatory W2-C — Row B: the live pulse (sealed plan Deck-1 row 2).
// ProviderTopology (Observatory graft: error halos from the perProvider ≤30s
// frame, click-to-filter into the Needle) flanked by the Live Feed rail —
// last-8 requests via SSE with pause-on-hover so a reading eye never loses
// its place. The stats stream is owned by the Overview deck (shared with
// Row E); the topology lazy-loads @xyflow/react out of the main bundle,
// same as the old orchestrator.
"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import { useProviders } from "../../../hooks/useProviders";
import RecentRequests from "../../RecentRequests";

const ProviderTopology = dynamic(
  () => import("../../ProviderTopology"),
  { ssr: false }
);

export default function LiveRow({ compass, stats }) {
  const providers = useProviders();
  // Pause-on-hover: when the pointer rests on the feed we freeze the array we
  // hand to RecentRequests (a state snapshot), so a reading eye never loses
  // its place while SSE keeps flowing underneath. RecentRequests itself stays
  // verbatim — the freeze lives here, where the pause state already does.
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState(null);

  // Click-to-filter: a provider node click sets the shared provider facet.
  // Clicking the already-selected provider clears it (toggle semantics).
  const onProviderClick = useCallback(
    (provider) => {
      compass.setFacet("provider", compass.provider === provider ? "" : provider);
    },
    [compass]
  );

  const recent = useMemo(() => (stats?.recentRequests || []).slice(0, 8), [stats]);
  const shown = paused && held ? held : recent;

  return (
    <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <ProviderTopology
        providers={providers}
        activeRequests={stats?.activeRequests || []}
        lastProvider={stats?.recentRequests?.[0]?.provider || ""}
        errorProvider={stats?.errorProvider || ""}
        perProvider={stats?.perProvider || {}}
        onProviderClick={onProviderClick}
      />
      <div
        onMouseEnter={() => { setHeld(recent); setPaused(true); }}
        onMouseLeave={() => setPaused(false)}
      >
        <RecentRequests requests={shown} />
      </div>
    </div>
  );
}
