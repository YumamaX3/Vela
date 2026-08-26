"use client";

import { useSettingsContext } from "./_context/SettingsContext";
import { useSettingsStatus } from "./hooks/useSettingsStatus";
import SettingsKpiCard from "./components/shared/SettingsKpiCard";
import { SETTINGS_NAV_ITEMS } from "./lib/settingsNavItems";
import Link from "next/link";

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border p-4 h-20 bg-surface-2/50" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border p-4 h-24 bg-surface-2/50" />
      ))}
    </div>
  );
}

export default function SettingsOverviewPage() {
  const { settings, loading } = useSettingsContext();
  const statuses = useSettingsStatus(settings);

  if (loading) return <Skeleton />;

  const ba = settings?.budgetAlerts || {};

  const kpis = [
    {
      icon: "lock",
      label: "Login required",
      value: settings?.requireLogin ? "On" : "Off",
      status: settings?.requireLogin ? "ok" : "warn",
      href: "/dashboard/settings/security",
    },
    {
      icon: "key",
      label: "SSO",
      value: settings?.oidcConfigured
        ? "OIDC"
        : settings?.samlEntryPoint
          ? "SAML"
          : "None",
      status:
        settings?.oidcConfigured || settings?.samlEntryPoint ? "ok" : "none",
      href: "/dashboard/settings/authentication",
    },
    {
      icon: "wifi",
      label: "Outbound proxy",
      value: settings?.outboundProxyEnabled ? "Active" : "Off",
      status: settings?.outboundProxyEnabled ? "ok" : "none",
      href: "/dashboard/settings/network",
    },
    {
      icon: "compress",
      label: "Token savers",
      value: settings?.rtkEnabled !== false ? "On" : "Off",
      status: settings?.rtkEnabled !== false ? "ok" : "none",
      href: "/dashboard/settings/token-savers",
    },
    {
      icon: "notifications",
      label: "Budget alerts",
      value:
        ba.discordEnabled || ba.n8nEnabled ? "Active" : "Off",
      status:
        ba.discordEnabled || ba.n8nEnabled ? "ok" : "none",
      href: "/dashboard/settings/alerts",
    },
    {
      icon: "monitoring",
      label: "Observability",
      value: settings?.enableObservability ? "On" : "Off",
      status: settings?.enableObservability ? "ok" : "none",
      href: "/dashboard/settings/observability",
    },
    {
      icon: "backup",
      label: "Backup",
      value: "Configured",
      status: "ok",
      href: "/dashboard/settings/storage",
    },
    {
      icon: "tune",
      label: "Capacity adapter",
      value: "Active",
      status: "ok",
      href: "/dashboard/settings/capacity",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-text-muted mt-1">
          Manage every aspect of the Vela gateway — from appearance to security,
          routing to observability.
        </p>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {kpis.map((kpi) => (
          <SettingsKpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* Quick-link grid — all settings in one flat view */}
      <div className="mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">
          All settings
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SETTINGS_NAV_ITEMS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-center gap-3 p-3 rounded-xl border border-border/50 hover:border-brand-500/30 hover:bg-brand-500/[0.03] transition-all group"
            >
              <span className="material-symbols-outlined text-[24px] text-text-muted group-hover:text-brand-500 transition-colors">
                {item.icon}
              </span>
              <div className="min-w-0">
                <p className="font-medium text-sm group-hover:text-brand-500 transition-colors">
                  {item.label}
                </p>
                <p className="text-xs text-text-muted truncate">
                  {item.desc}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}