// Quota Tracker Page — standalone quota monitoring (restored from Vela heritage)
"use client";

// The real per-provider quota engine — quota tables, progress bars,
// per-account gauges, auto-refresh, pagination (the Vela heritage).
import ProviderLimits from "../usage/components/ProviderLimits";
import PageShell from "@/shared/components/layouts/PageShell";

export default function QuotaPage() {
  return (
    // The masthead is the deck's, not this room's (v0.9.99). The former shape
    // here was a bare <div><h1/><p/></div> at gap-6; PageShell's header carries
    // mb-6, which is the same 24px, so the body spacing is unchanged. `min-w-0`
    // is kept deliberately — it is the flex-overflow guard, not decoration.
    <PageShell
      title="Quota Management"
      subtitle="Monitor per-account quotas and budget limits"
      icon="bar_chart"
      reveal
      className="min-w-0 px-1 sm:px-0"
    >
      {/* Per-provider quota gauges */}
      <ProviderLimits />
    </PageShell>
  );
}
