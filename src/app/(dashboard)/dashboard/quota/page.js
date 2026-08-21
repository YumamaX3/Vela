// Quota Tracker Page — standalone quota monitoring (restored from 9router heritage)
"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { CardSkeleton, Card } from "@/shared/components";
import ProviderLimits from "./components/ProviderLimits";

export default function QuotaPage() {
  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-text-main">Quota Management</h1>
        <p className="text-sm text-text-muted mt-1">Monitor per-account quotas and budget limits</p>
      </div>

      {/* Plan Status Card */}
      <PlanStatusCard />

      {/* Per-account quota gauges */}
      <ProviderLimits />
    </div>
  );
}

function PlanStatusCard() {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setPlan(data.billingPlan || "Free");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <Card className="bg-surface-2 rounded-xl p-4 border border-border-subtle">
        <div className="animate-pulse flex items-center justify-between">
          <div className="h-4 w-32 bg-gray-200 rounded"></div>
          <div className="h-8 w-24 bg-gray-200 rounded"></div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl p-4 bg-white border border-border-subtle">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-text-muted uppercase tracking-wide">Current Plan</p>
          <p className="text-lg font-semibold text-text-main mt-1">{plan}</p>
          <p className="text-xs text-text-muted mt-2">Next reset in: Unknown</p>
        </div>
        <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-success/10 text-success text-xs font-semibold">
          <span className="material-symbols-outlined text-[14px]">check_circle</span>
          Active
        </span>
      </div>
    </Card>
  );
}

PlanStatusCard.propTypes = {};
