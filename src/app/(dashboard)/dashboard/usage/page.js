// Usage Page — Live Observatory (single page, no tabs).
//
// What this fixes over v0.9.10-v0.9.14:
//   1. Dead period buttons — the old page used `router.push({ query })`, a
//      Pages Router API that no-ops in App Router. Period is now React state.
//   2. Missing traffic chart — the old page rendered <TrafficChart /> with no
//      `period` prop and the component early-returned null. This page owns a
//      real recharts area chart fed by /api/usage/metrics/timeseries.
//   3. Light-mode invisibility — KPI cards no longer hardcode `text-white` on
//      a white Card. They are self-tinted gradient tiles that read in BOTH
//      light and dark (white text always sits on the brand gradient).
//
// New (wired from already-built repo pieces, per the Star's preview):
//   - ProviderTopology  (ReactFlow live routing map — was never on this page)
//   - Live Activity feed (SSE recentRequests)
//   - RequestDetailsTab  (full request ledger + drawer — was never on this page)
//   - Elegant segmented period control: Today · 24h · 7 · 14 · 30 · All time
"use client";

import { Suspense, useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardSkeleton } from "@/shared/components";
import { useMetrics } from "./hooks/useMetrics";
import { useUsageStream } from "./hooks/useUsageStream";
import RequestDetailsTab from "./components/RequestDetailsTab";
import ProviderTopology from "./components/ProviderTopology";
import { useProviders } from "./hooks/useProviders";

const PERIOD_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "24h", value: "24h" },
  { label: "7 days", value: "7d" },
  { label: "14 days", value: "14d" },
  { label: "30 days", value: "30d" },
  { label: "All time", value: "all" },
];

// ── Formatting helpers ──────────────────────────────────────────────────────
function formatNumber(n) {
  if (n == null) return "--";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toString();
}

function formatCost(v) {
  if (v == null) return "--";
  if (v <= 0) return "$0.00";
  if (v < 0.01) return "<$0.01";
  return `$${v.toFixed(2)}`;
}

function timeAgo(timestamp) {
  const t = timestamp ? new Date(timestamp).getTime() : NaN;
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

// ── CountUp — animates a number toward its target ───────────────────────────
function CountUp({ value, format }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    const target = Number(value) || 0;
    const from = display;
    const start = performance.now();
    const dur = 900;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (target - from) * eased);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{format ? format(display) : display}</>;
}

// ── Segmented period control with a sliding ember indicator ─────────────────
function PeriodSegmented({ value, onChange }) {
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });
  const btnRefs = useRef({});

  useEffect(() => {
    const el = btnRefs.current[value];
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [value]);

  useEffect(() => {
    const measure = () => {
      const el = btnRefs.current[value];
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [value]);

  return (
    <div className="relative inline-flex items-center gap-0.5 rounded-xl border border-border bg-surface-2 p-1">
      <span
        className="absolute top-1 bottom-1 rounded-lg bg-brand-500 shadow-sm transition-all duration-300 ease-out"
        style={{ left: indicator.left, width: indicator.width }}
      />
      {PERIOD_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          ref={(el) => {
            btnRefs.current[opt.value] = el;
          }}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`relative z-10 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            value === opt.value
              ? "text-white"
              : "text-text-muted hover:text-text-main"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── KPI tile (self-tinted gradient — legible in light AND dark) ────────────
const KPI_STYLES = {
  requests: "from-[#E56A4A] to-[#C7502F]",
  promptTokens: "from-[#6366F1] to-[#4338CA]",
  completionTokens: "from-[#16A34A] to-[#15803D]",
  cost: "from-[#F59E0B] to-[#D97706]",
};

function KpiBand({ period }) {
  const { data: kpis, loading } = useMetrics("kpis", `period=${period}`);

  if (loading || !kpis) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i} className="h-[118px] animate-pulse" />
        ))}
      </div>
    );
  }

  const cards = [
    {
      key: "requests",
      icon: "bolt",
      label: "Requests",
      value: kpis.requests?.value,
      previous: kpis.requests?.previous,
      sub: `${formatNumber(kpis.requests?.previous)} previous`,
      format: (n) => Math.round(n).toLocaleString(),
    },
    {
      key: "promptTokens",
      icon: "input",
      label: "Input Tokens",
      value: kpis.promptTokens?.value,
      previous: kpis.promptTokens?.previous,
      sub: `${formatNumber(kpis.promptTokens?.previous)} previous`,
      format: (n) => formatNumber(n),
    },
    {
      key: "completionTokens",
      icon: "output",
      label: "Output Tokens",
      value: kpis.completionTokens?.value,
      previous: kpis.completionTokens?.previous,
      sub: `${formatNumber(kpis.completionTokens?.previous)} previous`,
      format: (n) => formatNumber(n),
    },
    {
      key: "cost",
      icon: "payments",
      label: "Est. Cost",
      value: kpis.cost?.value,
      previous: kpis.cost?.previous,
      sub: perMtok(kpis),
      format: (n) => formatCost(n),
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const diff = (c.value ?? 0) - (c.previous ?? 0);
        const pct =
          (c.previous ?? 0) > 0
            ? Math.round((Math.abs(diff) / c.previous) * 100)
            : 0;
        const up = diff > 0;
        const down = diff < 0;
        return (
          <div
            key={c.key}
            className={`relative min-h-[118px] overflow-hidden rounded-[14px] bg-gradient-to-br ${KPI_STYLES[c.key]} p-4 text-white shadow-[var(--shadow-elev)]`}
          >
            <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="mb-3 flex items-center justify-between">
              <span className="material-symbols-outlined text-[22px] opacity-90">
                {c.icon}
              </span>
              {(c.previous ?? 0) > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold">
                  <span className="material-symbols-outlined text-[13px]">
                    {up ? "trending_up" : down ? "trending_down" : "remove"}
                  </span>
                  {pct}%
                </span>
              )}
            </div>
            <div className="text-3xl font-bold tabular-nums tracking-tight">
              <CountUp value={c.value ?? 0} format={c.format} />
            </div>
            <div className="mt-1 text-xs opacity-85">{c.label}</div>
            <div className="mt-0.5 text-[11px] opacity-60">{c.sub}</div>
          </div>
        );
      })}
    </div>
  );
}

function perMtok(kpis) {
  const tokens = (kpis?.promptTokens?.value || 0) + (kpis?.completionTokens?.value || 0);
  const cost = kpis?.cost?.value || 0;
  if (!tokens || !cost) return " ";
  const v = (cost / tokens) * 1_000_000;
  return v < 0.01 ? "~ <$0.01 / Mtok" : `~ $${v.toFixed(2)} / Mtok`;
}

// ── Traffic chart (recharts, /api/usage/metrics/timeseries) ────────────────
function TrafficArea({ period }) {
  const granularity = period === "today" || period === "24h" ? "1h" : "1d";
  const { data, loading } = useMetrics(
    "timeseries",
    `period=${period}&metric=requests&granularity=${granularity}`
  );

  const points = useMemo(() => {
    if (!Array.isArray(data?.points)) return [];
    return data.points.map((p) => ({
      t: p.t,
      label: fmtTick(p.t, granularity),
      value: p.value || 0,
    }));
  }, [data, granularity]);

  if (loading) {
    return <div className="h-[220px] animate-pulse rounded-xl bg-surface-2" />;
  }

  if (points.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-xl border border-border-subtle bg-surface-2 text-sm text-text-muted">
        No traffic data for this period
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E56A4A" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#E56A4A" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.12} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
          tickLine={false}
          axisLine={false}
          width={40}
          tickFormatter={(v) => formatNumber(v)}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: "10px",
            fontSize: "12px",
          }}
          formatter={(value) => [Number(value).toLocaleString(), "Requests"]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#E56A4A"
          strokeWidth={2.5}
          fill="url(#trafficFill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-bg)" }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function fmtTick(t, granularity) {
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return "";
  if (granularity === "1h") {
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Ranked list (top models / top spenders) ─────────────────────────────────
function RankedList({ period, metric, dimension, title, subtitle, icon, valueFmt }) {
  const { data, loading } = useMetrics(
    "breakdown",
    `period=${period}&dimension=${dimension}&metric=${metric}`
  );

  const items = useMemo(() => {
    if (!Array.isArray(data?.items)) return [];
    return data.items.slice(0, 6);
  }, [data]);

  const max = Math.max(...items.map((i) => i.value || 0), 1);

  return (
    <Card title={title} subtitle={subtitle} icon={icon} padding="md">
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-5 animate-pulse rounded bg-surface-2" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">No data yet</p>
      ) : (
        <div className="flex flex-col">
          {items.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-3 border-b border-border-subtle py-2.5 last:border-b-0"
            >
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-bold ${
                  i < 3 ? "bg-brand-500/10 text-brand-500" : "bg-surface-2 text-text-muted"
                }`}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-text-main" title={item[dimension]}>
                  {item[dimension] || "unknown"}
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-500 to-amber-400 transition-all duration-500"
                    style={{ width: `${((item.value || 0) / max) * 100}%` }}
                  />
                </div>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-text-main">
                {valueFmt ? valueFmt(item.value) : formatNumber(item.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Live activity feed (SSE recentRequests) ─────────────────────────────────
function LiveActivity({ requests = [] }) {
  const rows = (Array.isArray(requests) ? requests : []).slice(0, 7);

  return (
    <Card
      title="Live Activity"
      subtitle="realtime via SSE"
      icon="stream"
      padding="md"
      action={
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-success">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          LIVE
        </span>
      }
    >
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-muted">
          Waiting for traffic…
        </p>
      ) : (
        <div className="flex flex-col">
          {rows.map((r, i) => {
            const ok = !r.status || r.status === "ok" || r.status === "success";
            return (
              <div
                key={i}
                className="flex items-center gap-2.5 border-b border-border-subtle py-2 last:border-b-0"
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    ok ? "bg-success" : r.status ? "bg-danger" : "bg-warning"
                  }`}
                />
                <span className="min-w-0 truncate font-mono text-xs font-semibold text-text-main" title={r.model}>
                  {r.model}
                </span>
                <span className="shrink-0 text-[11px] text-text-muted">{r.provider}</span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-text-muted">
                  {formatNumber(r.promptTokens)}↑ {formatNumber(r.completionTokens)}↓
                </span>
                <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-text-subtle">
                  {timeAgo(r.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsagePageInner />
    </Suspense>
  );
}

function UsagePageInner() {
  const searchParams = useSearchParams();
  const initialPeriod = searchParams?.get("period") || "7d";
  const [period, setPeriod] = useState(initialPeriod);

  // Live stats (REST + SSE merge) — funds topology + live feed.
  const { stats, loading } = useUsageStream(period);

  const providers = useProviders();
  const [selectedProvider, setSelectedProvider] = useState("");

  const handleProviderSelect = (provider) => {
    setSelectedProvider(provider);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-semibold text-text-main">
            Usage
            <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-success">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
              </span>
              LIVE
            </span>
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Gateway metrics, live traffic and spend across time periods
          </p>
        </div>
        <PeriodSegmented value={period} onChange={setPeriod} />
      </div>

      {/* KPI hero */}
      <KpiBand period={period} />

      {/* Topology + Live activity */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)]">
        <Card
          title="Provider Topology"
          subtitle="live routing map"
          icon="hub"
          padding="md"
          className="overflow-hidden"
        >
          <ProviderTopology
            providers={providers}
            activeRequests={stats?.activeRequests || []}
            lastProvider={stats?.recentRequests?.[0]?.provider || ""}
            errorProvider={stats?.errorProvider || ""}
            perProvider={stats?.perProvider || {}}
            selectedProvider={selectedProvider}
            onProviderClick={handleProviderSelect}
          />
        </Card>
        <LiveActivity requests={stats?.recentRequests || []} />
      </div>

      {/* Request ledger (provider-filtered by topology selection) */}
      <RequestDetailsTab provider={selectedProvider} />

      {/* Traffic chart */}
      <Card
        title="Traffic"
        subtitle={`requests over ${period === "all" ? "all time" : `the last ${period.replace("d", " days")}`}`}
        icon="show_chart"
        padding="md"
      >
        <TrafficArea period={period} />
      </Card>

      {/* Top models + spenders */}
      <div className="grid gap-4 lg:grid-cols-2">
        <RankedList
          period={period}
          metric="requests"
          dimension="model"
          title="Top Models"
          subtitle="by request count"
          icon="trophy"
        />
        <RankedList
          period={period}
          metric="cost"
          dimension="model"
          title="Top Spenders"
          subtitle="models by est. cost"
          icon="payments"
          valueFmt={formatCost}
        />
      </div>
    </div>
  );
}
