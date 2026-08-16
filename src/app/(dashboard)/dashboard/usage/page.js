// Usage Observatory W2-B — the page becomes the Compass Deck.
// The old overview/logs/details tab orchestrator is retired: CompassDeck
// assembles header → tab rail → Needle bar → deck area → honesty strip, and
// its four decks (Overview · Analytics · Requests · Accounts & Limits) ride
// ?tab=… in the URL. The dead logs tab is gone; the live content survives
// inside the decks.
"use client";

import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components";
import CompassDeck from "./components/deck/CompassDeck";

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <CompassDeck />
    </Suspense>
  );
}
