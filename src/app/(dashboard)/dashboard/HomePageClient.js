"use client";
// The Vela Home Deck — Harbor Morning.
//
// A full redesign around one question: what should a gateway homepage feel
// like when the operator walks in? Not a wall of tiles — a morning. The
// greeting and today's date meet you; one living sentence tells the day's
// story in plain numbers; the live pulse chart is the single focal point;
// four quiet tiles hold the accounting; activity and fleet keep watch below.
//
// The old page led with a coral gradient hero band. This one leads with
// voice and whitespace; the coral appears exactly once (the pulse line),
// because a single accent is worth more than a painted wall. Every number
// is live truth from the same streams the observatory rides — nothing
// simulated, nothing fabricated.
//
// Data flows:
//   useUsageStream("today")  — REST totals + SSE realtime merge
//   /api/settings            — fleet statuses (providerStatuses)
//   /api/version             — build version chip
//   /api/health ping (15s)   — gateway-alive indicator
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardSkeleton } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { useUsageStream } from "@/app/(dashboard)/dashboard/usage/hooks/useUsageStream";

function greetingKey() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function dayLabel() {
  // A living date, rendered client-side (hydrated state only — SSR renders
  // nothing so the server string can never disagree with the client's).
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
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

  // Live usage — REST totals for Today + SSE realtime fields, the same seam
  // the usage observatory rides. No simulated numbers.
  const { stats, loading } = useUsageStream("today");

  const [settings, setSettings] = useState(null);
  const [version, setVersion] = useState(null);
  const [gatewayOk, setGatewayOk] = useState(null); // null = unknown yet
  const [day, setDay] = useState("");

  useEffect(() => {
    setDay(dayLabel());
  }, []);

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
  const requests = stats?.totalRequests || 0;

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
  const fleet = Array.isArray(settings?.providerStatuses) ? settings.providerStatuses : [];
  const fleetShown = fleet.slice(0, 5);
  const fleetOk = fleet.filter((p) => p.status === "ok").length;

  if (loading) {
    return (
      <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
        <div className="space-y-3">
          <div className="h-10 w-56 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-5 w-80 animate-pulse rounded-md bg-surface-2" />
        </div>
        <div className="h-[220px] animate-pulse rounded-[14px] bg-surface-2" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-[14px] bg-surface-2" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-8 px-1 sm:px-0">
      {/* ── Masthead: the greeting meets the operator ────────────── */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight text-text-main sm:text-[34px]">
            {translate(greetingKey())}.
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            {day && <span>{day}</span>}
            {day && version && <span aria-hidden="true" className="text-text-subtle">·</span>}
            {version && <span className="font-mono text-xs text-text-subtle">v{version}</span>}
          </p>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-text-main">
            {/* The day's story in one living sentence — every figure is
                live truth, so the sentence is always honest. */}
            {requests > 0 ? (
              <>
                {translate("Today the harbor moved")}{" "}
                <strong className="font-semibold tabular-nums">{fmtNum(requests)}</strong>{" "}
                {translate("requests")} ·{" "}
                <strong className="font-semibold tabular-nums">{compact(totalTokens)}</strong>{" "}
                {translate("tokens")} ·{" "}
                <strong className="font-semibold tabular-nums">{money(cost)}</strong>{" "}
                {translate("spend")}
                {active > 0 && (
                  <>
                    {" "}· {active} {translate("live now")}
                  </>
                )}
              </>
            ) : gatewayOk === false ? (
              translate("The gateway is unreachable right now. No traffic has moved today.")
            ) : (
              translate("The harbor is quiet. No traffic has moved yet today.")
            )}
          </p>
        </div>

        {/* Live chips — the harbor's vital signs */}
        <div className="flex shrink-0 items-center gap-2 text-sm">
          <span
            className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text-muted"
            role="status"
          >
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
            {gatewayOk === false ? translate("Gateway unreachable") : translate("Gateway live")}
          </span>
          {fleet.length > 0 && (
            <button
              type="button"
              onClick={() => router.push("/dashboard/providers")}
              className="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-primary/40 hover:text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <span className="material-symbols-outlined text-[14px] text-primary">monitor_heart</span>
              {fleetOk}/{fleet.length} {translate("providers ok")}
            </button>
          )}
        </div>
      </header>

      {/* ── The Pulse — the single focal point ───────────────────── */}
      <section aria-label={translate("Request flow, last 10 minutes")}>
        <div className="overflow-hidden rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">
          <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-main">
                {translate("The Pulse")}
              </h2>
              <span className="hidden text-xs text-text-subtle sm:inline">
                {translate("requests in the last 10 minutes")}
              </span>
            </div>
            {spark.length > 0 && (
              <span className="text-xs tabular-nums text-text-muted">
                {fmtNum(spark.reduce((a, b) => a + b, 0))} {translate("total")}
              </span>
            )}
          </div>

          <div className="px-5 pb-5 pt-4">
            {spark.length > 0 ? (
              <svg
                viewBox="0 0 400 140"
                preserveAspectRatio="none"
                className="h-40 w-full"
                role="img"
                aria-label={translate("Request flow chart, last 10 minutes")}
              >
                <defs>
                  <linearGradient id="homePulseArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E56A4A" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#E56A4A" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={sparkArea} fill="url(#homePulseArea)" />
                <path d={sparkPath} fill="none" stroke="#E56A4A" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <div className="flex h-40 flex-col items-center justify-center gap-1.5 text-center">
                <span className="material-symbols-outlined text-[26px] text-text-subtle">waves</span>
                <p className="text-sm text-text-muted">{translate("The water is still.")}</p>
                <p className="text-xs text-text-subtle">{translate("No traffic in the last 10 minutes")}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── The accounting — four quiet tiles ────────────────────── */}
      <section aria-label={translate("Today's totals")} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          icon="swap_vert"
          label={translate("Requests")}
          value={fmtNum(requests)}
          sub={active > 0 ? `${active} ${translate("live now")}` : translate("no requests in flight")}
        />
        <StatTile
          icon="token"
          label={translate("Tokens")}
          value={compact(totalTokens)}
          sub={`${compact(stats?.totalPromptTokens || 0)} ${translate("in")} · ${compact(stats?.totalCompletionTokens || 0)} ${translate("out")}`}
        />
        <StatTile
          icon="payments"
          label={translate("Spend")}
          value={money(cost)}
          sub={translate("estimated today")}
        />
        <StatTile
          icon="savings"
          label={translate("Cache rate")}
          value={`${cacheRate}%`}
          sub={`${compact(cached)} ${translate("tokens cached")}`}
        />
      </section>

      {/* ── Below the fold: activity keeps watch, fleet stands ready ── */}
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card
          title={translate("Recent Activity")}
          subtitle={translate("Streaming live")}
          icon="history"
          padding="md"
          action={
            <button
              type="button"
              onClick={() => router.push("/dashboard/usage")}
              className="inline-flex items-center gap-1 rounded-md text-[11.5px] font-semibold text-primary transition-colors hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {translate("View all")}
              <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </button>
          }
        >
          {recent.length ? (
            <div className="flex flex-col">
              {recent.map((r, i) => (
                <div
                  key={r.id || i}
                  className="flex items-center gap-2.5 border-b border-border-subtle py-2.5 last:border-0"
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      r.status === "error" || r.error ? "bg-danger" : "bg-success"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-text-main">
                      {r.model || r.provider || "request"}
                    </div>
                    <div className="text-[10.5px] text-text-subtle">
                      {r.provider ? `${r.provider} · ` : ""}
                      {r.promptTokens != null
                        ? `${compact((r.promptTokens || 0) + (r.completionTokens || 0))} ${translate("tokens")}`
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
            <p className="py-8 text-center text-xs text-text-subtle">{translate("No recent requests")}</p>
          )}
        </Card>

        <Card
          title={translate("Fleet Status")}
          subtitle={translate("Provider health")}
          icon="monitor_heart"
          padding="md"
          action={
            fleet.length > 5 ? (
              <button
                type="button"
                onClick={() => router.push("/dashboard/providers")}
                className="inline-flex items-center gap-1 rounded-md text-[11.5px] font-semibold text-primary transition-colors hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                {translate("All providers")}
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </button>
            ) : null
          }
        >
          {fleetShown.length ? (
            <div className="flex flex-col">
              {fleetShown.map((p) => (
                <div
                  key={p.name || p.id}
                  className="flex items-center gap-2.5 border-b border-border-subtle py-2.5 last:border-0"
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
                    {p.latencyMs != null && <div className="text-[10.5px] text-text-subtle">{p.latencyMs}ms</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-xs text-text-subtle">{translate("No providers configured")}</p>
              <button
                type="button"
                onClick={() => router.push("/dashboard/providers")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-xs font-semibold text-text-main transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                {translate("Connect a provider")}
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatTile({ icon, label, value, sub }) {
  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface p-4 shadow-[var(--shadow-soft)] transition-shadow hover:shadow-[var(--shadow-warm)]">
      <div className="flex items-center gap-2 text-text-muted">
        <span className="material-symbols-outlined text-[16px] text-primary">{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-[26px] font-semibold leading-none tabular-nums tracking-tight text-text-main">
        {value}
      </p>
      {sub && <p className="mt-1.5 truncate text-[11px] text-text-subtle">{sub}</p>}
    </div>
  );
}
