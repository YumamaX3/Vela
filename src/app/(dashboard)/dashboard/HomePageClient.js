"use client";
// The Vela Home Deck — dashboard homepage.
//
// Carries the original 9router silhouette (coral gradient hero band, four
// white stat tiles, two-column deck, provider topology at home) but every
// number is live truth — nothing is fabricated. The ancestor page simulated
// activity with random intervals; this deck rides the real usage stream.
//
// Data flows:
//   useUsageStream("today")  — REST totals + SSE realtime merge
//   useProviders()           — topology nodes (ReactFlow, dynamic import)
//   /api/settings            — fleet statuses (providerStatuses)
//   /api/version             — build version chip
//   /api/health ping (15s)   — gateway-alive indicator
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Card, CardSkeleton } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { useUsageStream } from "@/app/(dashboard)/dashboard/usage/hooks/useUsageStream";
import { useProviders } from "@/app/(dashboard)/dashboard/usage/hooks/useProviders";

const ProviderTopology = dynamic(
  () => import("@/app/(dashboard)/dashboard/usage/components/ProviderTopology"),
  { ssr: false }
);

function greetingKey() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function compact(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `${Math.round(n)}`;
}

function fmtNum(n) {
  return new Intl.NumberFormat().format(Math.round(n || 0));
}

function money(v) {
  if (v == null || v <= 0) return "$0.00";
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

export default function HomePageClient() {
  const router = useRouter();

  // Live usage — REST totals for Today + SSE realtime fields
  // (activeRequests / recentRequests / errorProvider), same seam the
  // usage observatory rides. No simulated numbers.
  const { stats, loading } = useUsageStream("today");
  const providers = useProviders();

  const [settings, setSettings] = useState(null);
  const [version, setVersion] = useState(null);
  const [gatewayOk, setGatewayOk] = useState(null); // null = unknown yet

  useEffect(() => {
    let alive = true;
    (async () => {
      const [settingsRes, versionRes] = await Promise.all([
        fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/version").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!alive) return;
      setSettings(settingsRes);
      setVersion(versionRes?.version || versionRes?.current || versionRes?.currentVersion || null);
    })();
    return () => { alive = false; };
  }, []);

  // Heartbeat — ping /api/health every 15s so the live chip tells truth.
  useEffect(() => {
    let alive = true;
    const ping = () =>
      fetch("/api/health", { cache: "no-store" })
        .then((r) => alive && setGatewayOk(r.ok))
        .catch(() => alive && setGatewayOk(false));
    ping();
    const id = setInterval(ping, 15_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const totalTokens = (stats?.totalPromptTokens || 0) + (stats?.totalCompletionTokens || 0);
  const cached = stats?.totalCachedTokens || 0;
  const cacheRate = totalTokens > 0 ? Math.round((cached / (totalTokens + cached)) * 100) : 0;
  const cost =
    stats?.totalCost != null
      ? stats.totalCost
      : stats?.totalCostCents != null
        ? stats.totalCostCents / 100
        : 0;
  const active = Array.isArray(stats?.activeRequests)
    ? stats.activeRequests.length
    : stats?.activeRequests || 0;

  const timeline = stats?.last10Minutes || [];
  const spark = Array.isArray(timeline) ? timeline.map((p) => p?.requests || p?.count || 0) : [];
  const sparkMax = spark.length ? Math.max(...spark, 1) : 1;
  const sparkPath = spark.length
    ? spark
        .map((v, i) => `${i === 0 ? "M" : "L"}${(i / Math.max(spark.length - 1, 1)) * 400},${140 - (v / sparkMax) * 110}`)
        .join(" ")
    : "M0,100 L400,100";
  const sparkArea = `${sparkPath} L400,140 L0,140 Z`;

  const recent = Array.isArray(stats?.recentRequests) ? stats.recentRequests.slice(0, 5) : [];

  const fleet = Array.isArray(settings?.providerStatuses) ? settings.providerStatuses.slice(0, 6) : [];

  if (loading) {
    return (
      <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
        <div className="h-9 w-64 animate-pulse rounded-lg bg-surface-2" />
        <div className="h-[190px] animate-pulse rounded-[14px] bg-surface-2" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="space-y-6">
            <div className="h-10 animate-pulse rounded-lg bg-surface-2" />
            <CardSkeleton />
            <CardSkeleton />
          </div>
          <div className="space-y-6">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* ── Header: greeting + live chips ─────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-main sm:text-[28px]">
            {translate(greetingKey())}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {translate("Welcome back. The pulse of your gateway, live.")}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text-muted">
            <span className="relative flex h-2.5 w-2.5">
              {gatewayOk !== false && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              )}
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                  gatewayOk === false ? "bg-danger" : "bg-success"
                }`}
              />
            </span>
            {gatewayOk === false
              ? translate("Gateway unreachable")
              : translate("Gateway live")}
          </span>
          {version && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface px-2.5 py-1.5 font-mono text-xs text-text-muted">
              <span className="material-symbols-outlined text-[13px] text-primary">bolt</span>
              v{version}
            </span>
          )}
        </div>
      </div>

      {/* ── Hero band — the 9router signature, live numbers ────────── */}
      <div className="relative overflow-hidden rounded-[14px] border border-brand-500/20 bg-gradient-to-br from-brand-600 via-brand-500 to-brand-400 p-6 shadow-[var(--shadow-warm)]">
        {/* Ember glow — the deck's identity motif */}
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-20 right-32 h-48 w-48 rounded-full bg-white/10 blur-2xl" />

        <div className="relative z-10 mb-5">
          <h2 className="text-xl font-semibold text-white">{translate("Gateway Overview")}</h2>
          <p className="mt-1 text-sm text-white/85">
            {translate("Today's pulse across every provider")}
          </p>
        </div>

        <div className="relative z-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroStat
            label={translate("Requests today")}
            value={fmtNum(stats?.totalRequests || 0)}
            sub={active ? `${active} ${translate("active now")}` : null}
          />
          <HeroStat
            label={translate("Tokens today")}
            value={compact(totalTokens)}
            sub={`${compact(stats?.totalPromptTokens || 0)} in · ${compact(stats?.totalCompletionTokens || 0)} out`}
          />
          <HeroStat label={translate("Spend today")} value={money(cost)} sub="~ est." />
          <HeroStat
            label={translate("Cache rate")}
            value={`${cacheRate}%`}
            sub={`${compact(cached)} ${translate("cached")}`}
          />
        </div>

        <div className="relative z-10 mt-4 flex items-center gap-2 text-xs text-white/90">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
          </span>
          {translate("Live updates: the deck breathes with your traffic")}
        </div>
      </div>

      {/* ── Quick actions strip ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <QuickTile
          icon="dns"
          label={translate("Providers")}
          sub={translate("Manage connections")}
          href="/dashboard/providers"
        />
        <QuickTile
          icon="key"
          label={translate("Endpoint & Key")}
          sub={translate("Copy the gateway URL")}
          href="/dashboard/endpoint"
        />
        <QuickTile
          icon="analytics"
          label={translate("Usage")}
          sub={translate("Live observatory")}
          href="/dashboard/usage"
        />
        <QuickTile
          icon="layers"
          label={translate("Combos")}
          sub={translate("Route + fallback chains")}
          href="/dashboard/combos"
        />
      </div>

      {/* ── The deck: main column + sidebar (9router silhouette) ───── */}
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {/* Left — topology + request flow */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card
            title={translate("Provider Topology")}
            subtitle={translate("Live routing map")}
            icon="hub"
            padding="md"
            className="overflow-hidden"
          >
            <div className="h-[320px]">
              <ProviderTopology
                providers={providers}
                activeRequests={stats?.activeRequests || []}
                lastProvider={stats?.recentRequests?.[0]?.provider || ""}
                errorProvider={stats?.errorProvider || ""}
              />
            </div>
          </Card>

          <Card
            title={translate("Request Flow")}
            subtitle={translate("Last 10 minutes")}
            icon="show_chart"
            padding="md"
          >
            {spark.length ? (
              <svg viewBox="0 0 400 140" preserveAspectRatio="none" className="h-36 w-full">
                <defs>
                  <linearGradient id="homeSparkArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E56A4A" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#E56A4A" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={sparkArea} fill="url(#homeSparkArea)" />
                <path d={sparkPath} fill="none" stroke="#E56A4A" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <p className="py-10 text-center text-xs text-text-subtle">
                {translate("No traffic in the last 10 minutes")}
              </p>
            )}
          </Card>
        </div>

        {/* Right — recent activity + fleet status */}
        <div className="flex min-w-0 flex-col gap-6">
          <Card
            title={translate("Recent Activity")}
            subtitle={translate("Streaming live")}
            icon="history"
            padding="md"
            action={
              <button
                type="button"
                onClick={() => router.push("/dashboard/usage")}
                className="text-[11.5px] font-semibold text-primary hover:text-primary-hover"
              >
                {translate("View all")}
              </button>
            }
          >
            {recent.length ? (
              <div className="flex flex-col">
                {recent.map((r, i) => (
                  <div
                    key={r.id || i}
                    className="flex items-center gap-2.5 border-b border-border-subtle py-2 last:border-0"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        r.status === "error" || r.error
                          ? "bg-danger"
                          : "bg-success"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-text-main">
                        {r.model || r.provider || "request"}
                      </div>
                      <div className="text-[10.5px] text-text-subtle">
                        {r.provider ? `${r.provider} · ` : ""}
                        {r.promptTokens != null
                          ? `${compact((r.promptTokens || 0) + (r.completionTokens || 0))} tokens`
                          : ""}
                        {r.costUsd != null ? ` · ${money(r.costUsd)}` : r.cost != null ? ` · ${money(r.cost)}` : ""}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-text-subtle">
                      {r.timestamp ? timeAgo(r.timestamp) : r.timeAgo || ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-xs text-text-subtle">
                {translate("No recent requests")}
              </p>
            )}
          </Card>

          <Card
            title={translate("Fleet Status")}
            subtitle={translate("Provider health")}
            icon="monitor_heart"
            padding="md"
          >
            {fleet.length ? (
              <div className="flex flex-col">
                {fleet.map((p) => (
                  <div
                    key={p.name || p.id}
                    className="flex items-center gap-2.5 border-b border-border-subtle py-2 last:border-0"
                  >
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        p.status === "ok"
                          ? "bg-success shadow-[0_0_6px] shadow-success/70"
                          : p.status === "degraded"
                            ? "bg-warning shadow-[0_0_6px] shadow-warning/70"
                            : "bg-danger shadow-[0_0_6px] shadow-danger/70"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] font-medium text-text-main">{p.name}</div>
                      {p.latencyMs != null && (
                        <div className="text-[10.5px] text-text-subtle">{p.latencyMs}ms</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-xs text-text-subtle">
                {translate("No providers configured")}
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value, sub }) {
  return (
    <div className="rounded-[10px] bg-black/15 px-3.5 py-3 backdrop-blur-sm">
      <p className="truncate text-[11px] font-medium text-white/90">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums tracking-tight text-white sm:text-[22px]">
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[10.5px] text-white/75">{sub}</p>}
    </div>
  );
}

function QuickTile({ icon, label, sub, href }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-warm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-brand-500/10 text-primary">
        <span className="material-symbols-outlined text-[19px]">{icon}</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-text-main">{label}</span>
        <span className="block truncate text-[11px] text-text-subtle">{sub}</span>
      </span>
    </button>
  );
}
