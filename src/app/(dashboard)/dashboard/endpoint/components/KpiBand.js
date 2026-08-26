"use client";

import { Card } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { formatTokens, formatCost } from "../lib/keyFormat";

/**
 * The four KPI tiles — Active Keys, Requests (24h), Tokens (24h), Est. Cost.
 * Fed by /api/usage/stats (24h window) + the keys list.
 */
export default function KpiBand({ stats, keys, loading }) {
  const tiles = [
    {
      icon: "vpn_key",
      label: translate("Active Keys"),
      value: loading ? "—" : String(keys.filter((k) => k.isActive !== false).length),
      accent: "text-primary bg-primary/10",
    },
    {
      icon: "swap_calls",
      label: translate("Requests (24h)"),
      value: loading ? "—" : String(stats?.totalRequests ?? 0),
      accent: "text-sky-500 bg-sky-500/10",
    },
    {
      icon: "token",
      label: translate("Tokens (24h)"),
      value: loading ? "—" : formatTokens((stats?.totalPromptTokens ?? 0) + (stats?.totalCompletionTokens ?? 0)),
      accent: "text-violet-500 bg-violet-500/10",
    },
    {
      icon: "paid",
      label: translate("Est. Cost"),
      value: loading ? "—" : formatCost(stats?.totalCost),
      accent: "text-amber-500 bg-amber-500/10",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {tiles.map((t) => (
        <Card key={t.label} className="p-4">
          <div className="flex items-center gap-3">
            <span className={`material-symbols-outlined rounded-lg w-9 h-9 flex items-center justify-center text-[20px] shrink-0 ${t.accent}`}>
              {t.icon}
            </span>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-text-muted truncate">{t.label}</p>
              <p className="text-xl font-semibold text-text-main tabular-nums">{t.value}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
