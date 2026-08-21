"use client";
// The Vela Command Deck — dashboard homepage (warm-dark 9router blend).
// Deep warm canvas, the brand orange as the ember accent, glowing live
// stats, provider rail, recent activity, quick actions. Every number
// comes from a real API; every tile leads somewhere real.
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardSkeleton } from "@/shared/components";
import { translate } from "@/i18n/runtime";

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

function money(cents) {
  if (!cents || cents <= 0) return "$0.00";
  if (cents < 0.01) return "<$0.01";
  return `$${cents.toFixed(2)}`;
}

export default function HomePageClient() {
  const router = useRouter();
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [statsRes, settingsRes, versionRes] = await Promise.all([
        fetch("/api/usage/stats?period=today").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/settings").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/version").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!alive) return;
      setStats(statsRes);
      setSettings(settingsRes);
      setVersion(versionRes?.version || versionRes?.current || versionRes?.currentVersion || null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const totalTokens = (stats?.totalPromptTokens || 0) + (stats?.totalCompletionTokens || 0);
  const cached = stats?.totalCachedTokens || 0;
  const cacheRate = totalTokens > 0 ? Math.round((cached / (totalTokens + cached)) * 100) : 0;
  const cost = stats?.totalCost != null ? stats.totalCost : (stats?.totalCostCents != null ? stats.totalCostCents / 100 : 0);
  const active = Array.isArray(stats?.activeRequests) ? stats.activeRequests.length : (stats?.activeRequests || 0);

  const timeline = stats?.last10Minutes || [];
  const spark = Array.isArray(timeline) ? timeline.map((p) => p?.requests || p?.count || 0) : [];

  const recent = useMemo(() => {
    const src = Array.isArray(stats?.recentRequests) ? stats.recentRequests : [];
    return src.slice(0, 5);
  }, [stats]);

  const providers = useMemo(() => {
    const list = Array.isArray(settings?.providerStatuses) ? settings.providerStatuses : [];
    return list.slice(0, 5);
  }, [settings]);

  if (loading) return <CardSkeleton />;

  const sparkMax = spark.length ? Math.max(...spark, 1) : 1;
  const sparkPath = spark.length
    ? spark
        .map((v, i) => `${i === 0 ? "M" : "L"}${(i / Math.max(spark.length - 1, 1)) * 400},${140 - (v / sparkMax) * 110}`)
        .join(" ")
    : "M0,100 L400,100";
  const sparkArea = `${sparkPath} L400,140 L0,140 Z`;

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* ── Top bar: greeting + live chips ───────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-[26px] font-bold text-text-main tracking-tight">
            {translate(greetingKey())}
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {translate("Your gateway, at a glance")}
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-border-subtle bg-surface dark:bg-surface">
            <span className="h-2 w-2 rounded-full bg-success shadow-[0_0_8px] shadow-success/70 animate-pulse" />
            <span className="text-text-muted dark:text-text-muted">{translate("Gateway live")}</span>
          </span>
          {version && (
            <span className="inline-flex items-center gap-1 text-xs font-mono px-2.5 py-1.5 rounded-full bg-surface text-text-muted border border-border-subtle dark:bg-surface">
              <span className="material-symbols-outlined text-[13px] text-primary">bolt</span>
              v{version}
            </span>
          )}
        </div>
      </div>

      {/* ── Hero: Live Traffic band (warm-dark, orange glow) ─────────── */}
      <div className="relative overflow-hidden rounded-[14px] border border-border-subtle bg-gradient-to-br from-[#1E1814] via-[#2A1F18] to-[#33221A] dark:from-[#1a1410] dark:via-[#2a1d15] dark:to-[#3a2418] p-5">
        <div
          className="pointer-events-none absolute -top-1/3 -right-10 h-80 w-80 rounded-full"
          style={{ background: "radial-gradient(circle, rgba(229,106,74,0.18) 0%, transparent 70%)" }}
        />
        <div className="relative mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#F5EFE8]">
            <span className="material-symbols-outlined text-[18px] text-[#EE8D6A]">monitoring</span>
            {translate("Live Traffic")}
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] text-[#A89F96]">
            <span className="material-symbols-outlined text-[13px]">refresh</span>
            {translate("Auto-refresh")}
          </span>
        </div>
        <div className="relative grid grid-cols-2 gap-3 lg:grid-cols-4">
          <HeroStat icon="bolt" tone="orange" label={translate("Requests today")} value={fmtNum(stats?.totalRequests || 0)} sub={active ? `${active} active` : " "} />
          <HeroStat icon="token" tone="blue" label={translate("Tokens today")} value={compact(totalTokens)} sub={`${compact(stats?.totalPromptTokens || 0)} in · ${compact(stats?.totalCompletionTokens || 0)} out`} />
          <HeroStat icon="payments" tone="amber" label={translate("Spend today")} value={money(cost)} sub="~ est." />
          <HeroStat icon="savings" tone="green" label={translate("Cache rate")} value={`${cacheRate}%`} sub={`${compact(cached)} cached`} />
        </div>
      </div>

      {/* ── Row: Request flow + Providers + Recent activity ─────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1" padding="md">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-text-main">
              <span className="material-symbols-outlined text-[16px] text-primary">show_chart</span>
              {translate("Request Flow")}
            </div>
            <span className="text-[11px] text-text-subtle">{translate("Last 10 minutes")}</span>
          </div>
          {spark.length ? (
            <svg viewBox="0 0 400 140" preserveAspectRatio="none" className="h-36 w-full">
              <defs>
                <linearGradient id="sparkArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E56A4A" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#E56A4A" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={sparkArea} fill="url(#sparkArea)" />
              <path d={sparkPath} fill="none" stroke="#E56A4A" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ) : (
            <p className="py-10 text-center text-xs text-text-subtle">{translate("No traffic in the last 10 minutes")}</p>
          )}
        </Card>

        <Card className="lg:col-span-1" padding="md">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-text-main">
              <span className="material-symbols-outlined text-[16px] text-primary">dns</span>
              {translate("Providers")}
            </div>
            <button
              type="button"
              onClick={() => router.push("/dashboard/providers")}
              className="text-[11.5px] font-semibold text-primary hover:text-primary-hover"
            >
              {translate("Manage")}
            </button>
          </div>
          {providers.length ? (
            <div className="flex flex-col">
              {providers.map((p) => (
                <div key={p.name || p.id} className="flex items-center gap-2.5 border-b border-border-subtle py-2 last:border-0">
                  <span className={`h-2 w-2 rounded-full ${p.status === "ok" ? "bg-success shadow-[0_0_6px] shadow-success/70" : p.status === "degraded" ? "bg-warning shadow-[0_0_6px] shadow-warning/70" : "bg-danger shadow-[0_0_6px] shadow-danger/70"}`} />
                  <span className="flex-1 truncate text-[12.5px] font-medium text-text-main">{p.name}</span>
                  {p.latencyMs != null && <span className="font-mono text-[11px] text-text-subtle">{p.latencyMs}ms</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-text-subtle">{translate("No providers configured")}</p>
          )}
        </Card>

        <Card className="lg:col-span-1" padding="md">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-text-main">
              <span className="material-symbols-outlined text-[16px] text-primary">history</span>
              {translate("Recent Activity")}
            </div>
            <button
              type="button"
              onClick={() => router.push("/dashboard/usage")}
              className="text-[11.5px] font-semibold text-primary hover:text-primary-hover"
            >
              {translate("View all")}
            </button>
          </div>
          {recent.length ? (
            <div className="flex flex-col">
              {recent.map((r, i) => (
                <div key={r.id || i} className="flex items-center gap-2.5 border-b border-border-subtle py-2 last:border-0">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-text-muted dark:bg-surface-2">
                    <span className="material-symbols-outlined text-[14px]">bolt</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-text-main">{r.model || r.provider || "request"}</div>
                    <div className="text-[10.5px] text-text-subtle">
                      {r.promptTokens != null ? `${compact(r.promptTokens + (r.completionTokens || 0))} tokens` : ""}
                      {r.costUsd != null ? ` · ${money(r.costUsd)}` : r.cost != null ? ` · ${money(r.cost)}` : ""}
                    </div>
                  </div>
                  {r.timeAgo && <span className="font-mono text-[10.5px] text-text-subtle">{r.timeAgo}</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-text-subtle">{translate("No recent requests")}</p>
          )}
        </Card>
      </div>

      {/* ── Quick actions ────────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center gap-1.5 text-[15px] font-semibold text-text-main">
          <span className="material-symbols-outlined text-[18px] text-primary">quick_phrases</span>
          {translate("Quick Actions")}
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <QuickTile icon="api" label={translate("Endpoint & Key")} sub={translate("Copy the gateway URL")} href="/dashboard/endpoint" />
          <QuickTile icon="dns" label={translate("Providers")} sub={translate("Manage connections")} href="/dashboard/providers" />
          <QuickTile icon="layers" label={translate("Combos")} sub={translate("Route + fallback chains")} href="/dashboard/combos" />
          <QuickTile icon="bar_chart" label={translate("Usage")} sub={translate("Single-page observatory")} href="/dashboard/usage" />
          <QuickTile icon="data_usage" label={translate("Quota")} sub={translate("Per-account limits")} href="/dashboard/quota" />
          <QuickTile icon="terminal" label={translate("CLI Tools")} sub={translate("Shell utilities")} href="/dashboard/cli-tools" />
        </div>
      </div>
    </div>
  );
}

function HeroStat({ icon, tone, label, value, sub }) {
  const tones = {
    orange: "bg-brand-500/15 text-[#EE8D6A]",
    blue: "bg-info/15 text-info",
    amber: "bg-warning/15 text-warning",
    green: "bg-success/15 text-success",
  };
  return (
    <div className="rounded-xl border border-[#3A312B] bg-[#1E1814]/75 p-3.5 backdrop-blur-sm transition-transform hover:-translate-y-0.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#A89F96]">{label}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tones[tone]}`}>
          <span className="material-symbols-outlined text-[16px]">{icon}</span>
        </span>
      </div>
      <div className="text-[26px] font-extrabold leading-none tracking-tight text-[#F5EFE8] tabular-nums">{value}</div>
      <div className="mt-1.5 text-[11px] text-[#A89F96]">{sub}</div>
    </div>
  );
}

function QuickTile({ icon, label, sub, href }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="flex items-center gap-3 rounded-xl border border-border-subtle bg-surface p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_4px_16px_rgba(0,0,0,0.25)]"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-2 text-primary dark:bg-surface-2">
        <span className="material-symbols-outlined text-[19px]">{icon}</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold text-text-main">{label}</span>
        <span className="block truncate text-[11px] text-text-subtle">{sub}</span>
      </span>
    </button>
  );
}
