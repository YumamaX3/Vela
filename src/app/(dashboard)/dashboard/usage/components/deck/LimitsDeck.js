// Usage Observatory W2-F — the Accounts & Limits deck, "What are my limits?"
//
// Absorbs the old /dashboard/quota body (QuotaTable rides verbatim) and adds
// the per-key usage bars the sealed plan called for. Two truths ride this
// deck honestly:
//   • The period facet is DROPPED here — limits don't respect time (NeedleBar
//     already hides period+granularity on this bearing).
//   • Budget bars ride W3 (the hierarchy gateway→key→model, multi-window,
//     50/80/100 thresholds) — this deck shows what the telemetry funds today.
//
// KeyUsagePanel fetches /api/keys + /api/keys/usage over a fixed honest
// window, merges on keyId, and renders a bar per key normalized to the busiest
// one. Clicking a bar crosses to the Requests deck pre-filtered to that key —
// the same "facet then cross" gesture the StatusMix donut uses.
"use client";

import { Suspense } from "react";
import { CardSkeleton } from "@/shared/components/Loading";
import ProviderLimits from "../ProviderLimits";
import KeyUsagePanel from "./limits/KeyUsagePanel";
import AlertConfigCard from "./limits/AlertConfigCard";

export default function LimitsDeck({ compass }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* W3-C — where the alert channels are armed */}
      <AlertConfigCard />

      {/* Per-key usage bars — who is calling, and how much */}
      <KeyUsagePanel compass={compass} />

      {/* The quota body, absorbed verbatim */}
      <Suspense fallback={<CardSkeleton />}>
        <ProviderLimits />
      </Suspense>
    </div>
  );
}
