"use client";
// The console's census strip — the numbers the operator checks first, in one row
// above every lens. It reads the same `census` object the four tabs read, so the
// Fleet tab's totals, the Fitness tab's block count and the Egress tab's pool count
// can never disagree: there is one arithmetic and it runs once.
//
// The three verdict tiles are the console's honesty in miniature. `ok`, `dead`, and
// `indeterminate` are three tiles, not two, because a probe that could not decide is
// a third state and folding it into `dead` is the wound this console exists to close.
import { Badge } from "@/shared/components";
function Tile({ label, value, icon, tone = "text-brand-500/80", hint }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-[14px] border border-border-subtle bg-surface px-3 py-2"
      title={hint}
    >
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
export default function ProxyCensus({ census }) {
  const c = census || {};
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Pools" value={String(c.total ?? 0)} icon="lan" />
        <Tile label="Active" value={String(c.active ?? 0)} icon="toggle_on" tone="text-green-600/80 dark:text-green-400" />
        <Tile label="Probe ok" value={String(c.ok ?? 0)} icon="check_circle" tone="text-green-600/80 dark:text-green-400" />
        <Tile label="Proven dead" value={String(c.dead ?? 0)} icon="block" tone="text-red-500" hint="Probe failed deterministically" />
        <Tile
          label="Indeterminate"
          value={String(c.indeterminate ?? 0)}
          icon="help"
          tone="text-amber-600/80 dark:text-amber-400"
          hint="Probe could not decide: these pools are unknown, and left active"
        />
        <Tile label="Blocked pairs" value={String(c.blocked ?? 0)} icon="health_and_safety" tone="text-red-500" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-text-muted">
        <span>
          <span className="tabular-nums text-text-main">{c.bound ?? 0}</span> bound connections
        </span>
        <span>
          <span className="tabular-nums text-text-main">{c.relayCount ?? 0}</span> relay pools
        </span>
        <Badge variant={(c.indeterminate ?? 0) > 0 ? "warning" : "default"} size="sm">
          {c.indeterminate ?? 0} unknown, left active
        </Badge>
      </div>
    </div>
  );
}
