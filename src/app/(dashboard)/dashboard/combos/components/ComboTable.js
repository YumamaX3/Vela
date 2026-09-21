"use client";

// The dense lens. Same fleet, scanned rather than browsed: sortable columns,
// one row per combo, strategy editing delegated to the drawer (the bulk bar
// sets strategies across rows).
import { CapacityBadges } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { strategyMeta } from "../lib/comboMeta";
import { splitHarbor } from "../lib/comboGroups";
import { fmt, fmtCost, okRatioOf, timeAgo, TONES, toneForRatio, usageTokens } from "../lib/comboFormat";
import HealthPill from "./HealthPill";
import UsageCell from "./UsageCell";

const SORTABLE = {
  name: "Name",
  members: "Members",
  requests: "24h requests",
  cost: "24h cost",
  health: "Health",
};

function SortHeader({ column, label, sortKey, onSort, align = "left" }) {
  const active = sortKey === column;
  return (
    <th scope="col" className={cn("px-3 py-2 font-semibold", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort?.(column)}
        className={cn(
          "inline-flex items-center gap-1 rounded motion-control hover:text-text-main",
          active && "text-text-main"
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active && (
          <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
            sort
          </span>
        )}
      </button>
    </th>
  );
}

export default function ComboTable({
  combos,
  comboStrategies,
  usageByName,
  hubHealth,
  getCaps,
  copied,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onCopy,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  sortKey,
  onSort,
}) {
  const allSelected = combos.length > 0 && combos.every((c) => selectedIds?.has(c.id));

  return (
    <div className="overflow-x-auto rounded-[14px] border border-border-subtle bg-surface shadow-[var(--shadow-soft)]">
      <table className="w-full min-w-[980px] border-collapse text-sm">
        <caption className="sr-only">Combo fleet — one row per combo, sorted by {sortKey}</caption>
        <thead className="bg-bg-alt text-[11px] uppercase tracking-wide text-text-muted">
          <tr>
            <th scope="col" className="w-8 px-3 py-2">
              <input
                type="checkbox"
                checked={!!allSelected}
                onChange={() => onSelectAll?.(combos.map((c) => c.id))}
                aria-label="Select all combos in view"
                className="size-3.5 cursor-pointer accent-[var(--color-brand-500)]"
              />
            </th>
            <SortHeader column="name" label="Name" sortKey={sortKey} onSort={onSort} />
            <SortHeader column="members" label="Members" sortKey={sortKey} onSort={onSort} />
            <th scope="col" className="px-3 py-2 text-left font-semibold">
              Strategy
            </th>
            <SortHeader column="health" label="Health" sortKey={sortKey} onSort={onSort} />
            <SortHeader column="requests" label="24h requests" sortKey={sortKey} onSort={onSort} align="right" />
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Tokens
            </th>
            <SortHeader column="cost" label="Cost" sortKey={sortKey} onSort={onSort} align="right" />
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Ok
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              Last
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {combos.map((combo) => {
            const strategy = comboStrategies?.[combo.name]?.fallbackStrategy || "fallback";
            const meta = strategyMeta(strategy);
            const usage = usageByName?.[combo.name] || null;
            const ratio = okRatioOf(usage);
            const { harbor, leaf } = splitHarbor(combo.name);
            const members = Array.isArray(combo.models) ? combo.models : [];
            const health = hubHealth?.(combo) || { total: 0, reachable: 0 };
            const selected = selectedIds?.has(combo.id);

            return (
              <tr
                key={combo.id}
                className={cn(
                  "border-t border-border-subtle motion-control hover:bg-black/[0.02] dark:hover:bg-white/[0.03]",
                  selected && "bg-primary/[0.04]"
                )}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!selected}
                    onChange={() => onToggleSelect?.(combo.id)}
                    aria-label={`Select ${combo.name}`}
                    className="size-3.5 cursor-pointer accent-[var(--color-brand-500)]"
                  />
                </td>
                <td className="max-w-[260px] px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpen?.(combo)}
                    className="flex min-w-0 flex-col items-start text-left"
                    aria-label={`Open details for ${combo.name}`}
                  >
                    <code className="truncate font-mono text-xs font-medium text-text-main" title={combo.name}>
                      {leaf}
                    </code>
                    {harbor && <span className="truncate text-[10px] text-text-muted">{harbor}</span>}
                  </button>
                </td>
                <td className="max-w-[260px] px-3 py-2">
                  {members.length === 0 ? (
                    <span className="text-[11px] italic text-text-muted">No models</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1">
                      {members.slice(0, 3).map((model, index) => (
                        <span
                          key={`${model}-${index}`}
                          className="inline-flex max-w-[160px] items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-[10px] text-text-muted dark:bg-white/5"
                          title={model}
                        >
                          <span className="truncate">{model}</span>
                          <CapacityBadges caps={getCaps?.(model)} />
                        </span>
                      ))}
                      {members.length > 3 && <span className="text-[10px] text-text-muted">+{members.length - 3}</span>}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => onOpen?.(combo)}
                    className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", TONES[meta.tone])}
                    title={`${meta.label} — ${meta.hint}`}
                  >
                    <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
                      {meta.icon}
                    </span>
                    {meta.label}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <HealthPill reachable={health.reachable} total={health.total} />
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {usage?.requests ? (
                    <span className="text-xs text-text-main">{fmt(usage.requests)}</span>
                  ) : (
                    <span className="text-[11px] text-text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-text-muted">
                  {usage?.requests ? fmt(usageTokens(usage)) : "—"}
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-text-muted">
                  {usage?.requests ? fmtCost(usage.cost) : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {ratio === null ? (
                    <span className="text-[11px] text-text-muted">—</span>
                  ) : (
                    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums", TONES[toneForRatio(ratio)])}>
                      {Math.round(ratio * 100)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right text-[10px] text-text-muted">
                  {usage?.lastAt ? timeAgo(usage.lastAt) : "—"}
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center justify-end gap-0.5">
                    <button
                      type="button"
                      onClick={() => onCopy?.(combo.name, `combo-${combo.id}`)}
                      title="Copy name"
                      aria-label={`Copy name ${combo.name}`}
                      className={cn(
                        "rounded p-1 motion-control",
                        copied === `combo-${combo.id}` ? "text-primary" : "text-text-muted hover:text-primary"
                      )}
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {copied === `combo-${combo.id}` ? "check" : "content_copy"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onEdit?.(combo)}
                      title="Edit"
                      aria-label={`Edit ${combo.name}`}
                      className="rounded p-1 text-text-muted motion-control hover:text-primary"
                    >
                      <span className="material-symbols-outlined text-[15px]">edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicate?.(combo)}
                      title="Duplicate"
                      aria-label={`Duplicate ${combo.name}`}
                      className="rounded p-1 text-text-muted motion-control hover:text-primary"
                    >
                      <span className="material-symbols-outlined text-[15px]">copy_all</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete?.(combo)}
                      title="Delete"
                      aria-label={`Delete ${combo.name}`}
                      className="rounded p-1 text-text-muted motion-control hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"
                    >
                      <span className="material-symbols-outlined text-[15px]">delete</span>
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-border-subtle px-3 py-2 text-[11px] text-text-muted">
        <UsageCellHint />
      </div>
    </div>
  );
}

// The table abbreviates usage to "—" when empty; this keeps the full sentence
// available to anyone who needs the words rather than the dash.
function UsageCellHint() {
  return <span className="italic">Rows without traffic read “—” — the card lens spells it out as “No usage in the last 24h”.</span>;
}
