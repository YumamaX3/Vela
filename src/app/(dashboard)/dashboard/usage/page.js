// Usage Page — Single Page Design (W2-UsageRedesign)
"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CardSkeleton, Card } from "@/shared/components";
import { useMetrics } from "./hooks/useMetrics";
import TrafficChart from "./components/TrafficChart";
import TopModels from "./components/TopModels";
import TopSpenders from "./components/TopSpenders";

const PERIOD_OPTIONS = [
  { label: "Last 7 days", value: "7d" },
  { label: "Today", value: "today" },
  { label: "24h", value: "24h" },
  { label: "30d", value: "30d" },
];

export default function UsagePage() {
  const router = useRouter();

  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsagePageInner router={router} />
    </Suspense>
  );
}

function UsagePageInner({ router }) {
  const searchParams = useSearchParams();
  const initialPeriod = searchParams?.get("period") || "7d";

  const handlePeriodChange = (value) => {
    router.push({ query: { period: value } });
  };

  return (
    <UsageContent initialPeriod={initialPeriod} onPeriodChange={handlePeriodChange} />
  );
}

function UsageContent({ initialPeriod, onPeriodChange }) {
  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-main">Usage</h1>
          <p className="text-sm text-text-muted mt-1">Track your gateway metrics and spend across time periods</p>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-2 bg-surface-2 rounded-lg p-1 inline-flex">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onPeriodChange(opt.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              initialPeriod === opt.value ? "bg-brand-500 text-white" : "text-text-muted hover:text-text-main"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* KPI Hero Band */}
      <KpiBand period={initialPeriod} />

      {/* Traffic Chart */}
      <TrafficChart />

      {/* Two-col Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        <TopModels period={initialPeriod} />
        <TopSpenders period={initialPeriod} />
      </div>
    </div>
  );
}

function KpiBand({ period }) {
  const { data: kpis, loading } = useMetrics("kpis", `period=${period}`);

  if (loading) {
    return (
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 bg-gradient-to-r from-orange-500/5 to-amber-500/5 rounded-xl p-4 border border-border-subtle">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg p-4 animate-pulse">
            <div className="h-4 w-20 bg-gray-200 rounded mb-3"></div>
            <div className="h-8 w-24 bg-gray-200 rounded mb-2"></div>
            <div className="h-3 w-16 bg-gray-200 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 bg-gradient-to-r from-orange-500/8 to-amber-500/8 rounded-xl p-4 shadow-sm">
      <KpiCard
        icon="bolt"
        title="Requests"
        value={kpis?.requests ?? "--"}
        subtitle={`${formatNumber(kpis?.requestsPrev ?? 0)} previous`}
        delta={{ value: kpis?.requests, previous: kpis?.requestsPrev, type: kpis?.requestsDeltaType ?? "neutral" }}
        colorClass="text-white"
      />
      <KpiCard
        icon="input"
        title="Input Tokens"
        value={kpis?.inputTokens ?? "--"}
        subtitle={`${formatNumber(kpis?.inputTokensPrev ?? 0)} previous`}
        delta={{ value: kpis?.inputTokens, previous: kpis?.inputTokensPrev, type: kpis?.inputTokensDeltaType ?? "neutral" }}
        colorClass="text-indigo-200"
      />
      <KpiCard
        icon="output"
        title="Output Tokens"
        value={kpis?.outputTokens ?? "--"}
        subtitle={`${formatNumber(kpis?.outputTokensPrev ?? 0)} previous`}
        delta={{ value: kpis?.outputTokens, previous: kpis?.outputTokensPrev, type: kpis?.outputTokensDeltaType ?? "neutral" }}
        colorClass="text-green-200"
      />
      <KpiCard
        icon="payments"
        title="Est. Cost"
        value={kpis?.estCost ?? "--"}
        subtitle={`~ $${(kpis?.costPerMtok ?? 0).toFixed(2)}/Mtok`}
        delta={{ value: kpis?.estCost, previous: kpis?.estCostPrev, type: kpis?.estCostDeltaType ?? "neutral" }}
        colorClass="text-amber-200"
      />
    </div>
  );
}

function KpiCard({ icon, title, value, subtitle, delta, colorClass }) {
  return (
    <Card className="relative overflow-hidden">
      <div className="flex items-start justify-between mb-2">
        <span className={`material-symbols-outlined text-[28px] ${colorClass}`}>{icon}</span>
        {delta && delta.value !== undefined && delta.value !== null && delta.previous !== undefined && delta.previous !== null && <DeltaBadge delta={delta} />}
      </div>
      <div className="mt-2">
        <h3 className="text-3xl font-bold text-white tabular-nums tracking-tight">{value}</h3>
        <p className="text-xs text-white/70 mt-1">{title}</p>
        <p className="text-xs text-white/50 mt-1">{subtitle}</p>
      </div>
    </Card>
  );
}

function DeltaBadge({ delta }) {
  const isPositive = delta.type === "up";
  const isNegative = delta.type === "down";
  const percent = delta.percent ?? 0;

  return (
    <div className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${isPositive ? "bg-green-500/30 text-green-100" : isNegative ? "bg-red-500/30 text-red-100" : "bg-gray-500/30 text-gray-200"}`}>
      <span className="material-symbols-outlined text-[14px]">{isPositive ? "trending_up" : isNegative ? "trending_down" : "remove"}</span>
      <span>{Math.abs(percent)}%</span>
    </div>
  );
}

function formatNumber(n) {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}
