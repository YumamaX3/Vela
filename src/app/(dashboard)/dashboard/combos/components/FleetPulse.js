"use client";

// The fleet pulse — the four numbers the operator checks first, plus a second
// row of facts that only cost anything if someone looks. Values come from the
// server's census when it answered, from the page's own arithmetic otherwise.
import { fmt } from "../lib/comboFormat";

function Tile({ label, value, icon, tone = "text-primary/70" }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] border border-border-subtle bg-surface px-3 py-2">
      <span className={`material-symbols-outlined text-[18px] ${tone}`} aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-tight tabular-nums">{value}</div>
        <div className="truncate text-[11px] text-text-muted">{label}</div>
      </div>
    </div>
  );
}

export default function FleetPulse({ pulse, server, className }) {
  const data = server?.totals || pulse;

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Combos" value={String(data.combos ?? 0)} icon="layers" />
        <Tile label="Models in fleet" value={fmt(data.members ?? 0)} icon="deployed_code" />
        <Tile label="Fusion combos" value={String(data.fusionCombos ?? 0)} icon="hub" tone="text-violet-600/80 dark:text-violet-300" />
        <Tile label="Active · 24h" value={String(data.activeCombos ?? 0)} icon="monitoring" />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-text-muted">
        <span>
          <span className="tabular-nums text-text-main">{fmt(data.uniqueModels ?? 0)}</span> unique models
        </span>
        <span>
          <span className="tabular-nums text-text-main">{fmt(data.providers ?? 0)}</span> providers in play
        </span>
        <span>
          <span className="tabular-nums text-text-main">{fmt(data.idleCombos ?? 0)}</span> idle · 24h
        </span>
        {data.unreachableMembers > 0 && (
          <span className="text-amber-700 dark:text-amber-300">
            <span className="tabular-nums">{fmt(data.unreachableMembers)}</span> member
            {data.unreachableMembers === 1 ? "" : "s"} offline
          </span>
        )}
        {server ? (
          <span className="text-text-subtle" title={server.window?.since || ""}>
            census from the server · last {server.window?.hours ?? 24}h
          </span>
        ) : (
          <span className="text-text-subtle">census computed here · last 24h</span>
        )}
      </div>
    </div>
  );
}
