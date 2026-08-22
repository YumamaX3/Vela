// Quota Tracker Page — standalone quota monitoring (restored from 9router heritage)
"use client";

// The real per-provider quota engine — quota tables, progress bars,
// per-account gauges, auto-refresh, pagination (the 9router heritage).
import ProviderLimits from "../usage/components/ProviderLimits";

export default function QuotaPage() {
  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-main">Quota Management</h1>
        <p className="text-sm text-text-muted mt-1">Monitor per-account quotas and budget limits</p>
      </div>

      {/* Per-provider quota gauges */}
      <ProviderLimits />
    </div>
  );
}
