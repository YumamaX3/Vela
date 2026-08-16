// Usage Observatory W2-F — the Accounts & Limits deck, "What are my limits?"
// W2-B seeds it with the pre-existing ProviderLimits (the old /dashboard/quota
// body); W2-F finishes the absorption (301 redirect from /dashboard/quota,
// sidebar nav update), adds per-key usage bars, and drops the period facet
// here (limits don't respect time).
"use client";

import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import ProviderLimits from "../ProviderLimits";

export default function LimitsDeck() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <ProviderLimits />
    </Suspense>
  );
}
