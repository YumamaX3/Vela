"use client";
// The Vela Harbor — dashboard homepage. Editorial, warm, layered:
// a greeting with a live pulse, a gradient hero stat band, an asymmetric
// activity grid, harbor status, and quick-nav tiles. Every number comes
// from a real API; every tile leads somewhere real.
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardSkeleton } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { translate } from "@/i18n/runtime";
import CountUp from "@/shared/components/ui/CountUp";
import SpotlightCard from "@/shared/components/ui/SpotlightCard";

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

function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function HomePageClient() {
  const router = useRouter();
  const { copied, copy } = useCopyToClipboard();
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [version, setVersion] = useState(null);
  const [baseUrl, setBaseUrl] = useState("/v1");
  const [loading, setLoading] = useState(true);

  // Hydration fix: window.location is only available client-side.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (typeof window !== "undefined") setBaseUrl(`${window.location.origin}/v1`); }, []);

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
      setVersion(versionRes?.version || versionRes?.current || null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const topModels = useMemo(() => {
    const entries = Object.entries(stats?.byModel || {});
    if (!entries.length) return [];
    const max = Math.max(...entries.map(([, v]) => v?.requests || 0));
    return entries
      .sort((a, b) => (b[1]?.requests || 0) - (a[1]?.requests || 0))
      .slice(0, 5)
      .map(([model, v]) => ({ model, requests: v?.requests || 0, pct: max ? Math.max(4, Math.round(((v?.requests || 0) / max) * 100)) : 0 }));
  }, [stats]);

  if (loading) return <CardSkeleton />;

  const totalTokens = (stats?.totalPromptTokens || 0) + (stats?.totalCompletionTokens || 0);
  const cached = stats?.totalCachedTokens || 0;
  const cacheRate = totalTokens > 0 ? Math.round((cached / (totalTokens + cached)) * 100) : 0;
  const active = stats?.activeRequests || 0;

  const timeline = stats?.last10Minutes || [];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Greeting row ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-[28px] font-semibold text-text-main tracking-tight">
            {translate(greetingKey())}
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {translate("Your gateway, at a glance")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {version && (
            <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-surface-2 text-text-muted border border-border-subtle">
              v{version}
            </span>
          )}
          <span
            className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border border-border-subtle bg-surface"
            title={translate("Active requests")}
          >
            <span className="relative flex h-2 w-2">
              {active > 0 && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${active > 0 ? "bg-success" : "bg-text-subtle"}`} />
            </span>
            {active > 0 ? `${active} ${translate("active")}` : translate("Idle")}
          </span>
        </div>
      </div>

      {/* ── Hero band — the pulse of the harbor ──────────────────────── */}
      <div className="relative overflow-hidden rounded-[14px] border border-brand-500/20 bg-gradient-to-br from-brand-500 via-brand-400 to-brand-300 shadow-[var(--shadow-warm)]">
        <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="absolute -bottom-20 right-32 w-48 h-48 rounded-full bg-white/10 blur-2xl pointer-events-none" />
        <div className="relative p-5 sm:p-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-white/85 text-xs font-medium uppercase tracking-wider">{translate("Gateway endpoint")}</p>
              <div className="flex items-center gap-2 mt-1">
                <code className="text-white font-mono text-sm sm:text-base bg-black/15 px-3 py-1.5 rounded-[10px] max-w-full truncate">
                  {baseUrl}
                </code>
                <button
                  onClick={() => copy(baseUrl, "endpoint")}
                  className="shrink-0 p-1.5 rounded-lg text-white/85 hover:text-white hover:bg-white/15 transition-colors"
                  title={translate("Copy")}
                >
                  <span className="material-symbols-outlined text-[18px]">{copied === "endpoint" ? "check" : "content_copy"}</span>
                </button>
              </div>
            </div>
            <p className="text-white/75 text-xs max-w-[260px] leading-relaxed hidden lg:block">
              {translate("Point your AI tools at this OpenAI-compatible endpoint — Vela routes, translates, and governs every request.")}
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SpotlightCard key="requests" glowSize={80} bordered={false}>
              <CountUp start={0} end={stats?.totalRequests || 0} duration={1.5} decimals={0} className="text-2xl font-semibold text-white" />
              <p className="text-xs text-white/75 mt-1">{translate("Requests today")}</p>
            </SpotlightCard>
            <SpotlightCard key="tokens" glowSize={80} bordered={false}>
              <CountUp start={0} end={totalTokens} duration={1.5} decimals={0} className="text-2xl font-semibold text-white" />
              <p className="text-xs text-white/75 mt-1">{translate("Tokens today")}</p>
            </SpotlightCard>
            <SpotlightCard key="spend" glowSize={80} bordered={false}>
              <CountUp start={0} end={Math.round((stats?.totalCost || 0) * 100)} duration={1.5} decimals={2} className="text-2xl font-semibold text-success" />
              <p className="text-xs text-white/75 mt-1">{translate("Spend today")}</p>
            </SpotlightCard>
            <SpotlightCard key="cache" glowSize={80} bordered={false}>
              <span className="text-2xl font-semibold text-white">{cacheRate}%</span>
              <p className="text-xs text-white/75 mt-1">{translate("Cache rate")}</p>
            </SpotlightCard>
          </div>
        </div>
      </div>

      {/* ── Asymmetric grid: activity + harbor status ────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" padding="md">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-text-main">{translate("Activity")}</h2>
              <p className="text-xs text-text-muted">{translate("Requests in the last 10 minutes")}</p>
            </div>
            <button
              onClick={() => router.push("/dashboard/usage")}
              className="text-xs font-medium text-primary hover:text-primary-hover transition-colors inline-flex items-center gap-0.5"
            >
              {translate("Usage")}
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </button>
          </div>
          <Sparkline data={timeline.map((t) => t?.requests || 0)} />
          <div className="mt-5">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">{translate("Top models today")}</p>
            {topModels.length ? (
              <div className="flex flex-col gap-2">
                {topModels.map((m) => (
                  <div key={m.model} className="flex items-center gap-3">
                    <span className="text-xs font-mono text-text-main truncate w-44 sm:w-56 shrink-0" title={m.model}>{m.model}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
                      <div className="h-full rounded-full bg-brand-400" style={{ width: `${m.pct}%` }} />
                    </div>
                    <span className="text-xs text-text-muted w-10 text-right shrink-0">{compact(m.requests)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-subtle py-2">{translate("No traffic yet — send a request to see it here.")}</p>
            )}
          </div>
        </Card>

        <Card padding="md">
          <h2 className="text-sm font-semibold text-text-main mb-1">{translate("Harbor status")}</h2>
          <p className="text-xs text-text-muted mb-4">{translate("Governance and exposure")}</p>
          <div className="flex flex-col gap-1">
            <StatusRow label={translate("API key required")} on={!!settings?.requireApiKey} href="/dashboard/endpoint" />
            <StatusRow label={translate("Dashboard login")} on={settings?.requireLogin !== false} href="/dashboard/settings" />
            <StatusRow label={translate("Cloud sync")} on={!!settings?.cloudEnabled} href="/dashboard/settings" />
            <StatusRow label={translate("Tunnel")} on={!!settings?.tunnelEnabled} href="/dashboard/endpoint" />
          </div>
          <div className="mt-4 pt-4 border-t border-border-subtle">
            <button
              onClick={() => router.push("/dashboard/endpoint")}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-[10px] bg-surface-2 hover:bg-surface-3 border border-transparent hover:border-border-subtle transition-all text-sm text-text-main"
            >
              <span className="inline-flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">key</span>
                {translate("Manage API keys")}
              </span>
              <span className="material-symbols-outlined text-[16px] text-text-muted">arrow_forward</span>
            </button>
          </div>
        </Card>
      </div>

      {/* ── Quick nav ────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">{translate("Quick nav")}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <QuickTile icon="api" label={translate("Endpoint & Key")} href="/dashboard/endpoint" />
          <QuickTile icon="dns" label={translate("Providers")} href="/dashboard/providers" />
          <QuickTile icon="layers" label={translate("Combos")} href="/dashboard/combos" />
          <QuickTile icon="bar_chart" label={translate("Usage")} href="/dashboard/usage" />
          {/* Flagship Observatory — the quota shore stands on its own again */}
          <QuickTile icon="data_usage" label={translate("Quota")} href="/dashboard/quota" />
          <QuickTile icon="terminal" label={translate("CLI Tools")} href="/dashboard/cli-tools" />
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value }) {
  return (
    <div className="rounded-[10px] bg-black/10 backdrop-blur-sm px-3.5 py-3">
      <p className="text-white/75 text-[11px] font-medium truncate">{label}</p>
      <p className="text-white text-xl font-semibold tracking-tight mt-0.5 tabular-nums">{value}</p>
    </div>
  );
}

function Sparkline({ data }) {
  const W = 100, H = 32;
  const hasSignal = data.some((v) => v > 0);
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => ({
    x: data.length > 1 ? (i / (data.length - 1)) * W : W / 2,
    y: hasSignal ? H - 3 - (v / max) * (H - 6) : H - 3,
  }));
  const line = pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const area = `M0,${H} L${line.replace(/ /g, " L")} L${W},${H} Z`;
  const last = pts[pts.length - 1];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-20" role="img" aria-label="Request activity">
        <defs>
          <linearGradient id="harbor-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#harbor-spark)" />
        <polyline points={line} fill="none" stroke="var(--color-primary)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {hasSignal && last && <circle cx={last.x} cy={last.y} r="1.6" fill="var(--color-primary)" />}
      </svg>
      {!hasSignal && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-text-subtle">
          {translate("No requests in the last 10 minutes")}
        </p>
      )}
    </div>
  );
}

function StatusRow({ label, on, href }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(href)}
      className="w-full flex items-center justify-between px-2 py-2 rounded-lg hover:bg-surface-2 transition-colors text-left"
    >
      <span className="text-sm text-text-main">{label}</span>
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${on ? "text-success" : "text-text-subtle"}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${on ? "bg-success" : "bg-text-subtle"}`} />
        {on ? translate("On") : translate("Off")}
      </span>
    </button>
  );
}

function QuickTile({ icon, label, href }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(href)}
      className="group flex flex-col items-start gap-2.5 p-4 rounded-[14px] bg-surface border border-border-subtle shadow-[var(--shadow-soft)] hover:shadow-[var(--shadow-warm)] hover:border-brand-500/30 hover:-translate-y-0.5 transition-all text-left"
    >
      <span className="material-symbols-outlined text-[22px] text-primary group-hover:scale-110 transition-transform origin-left">
        {icon}
      </span>
      <span className="text-xs font-medium text-text-main leading-snug">{label}</span>
    </button>
  );
}
