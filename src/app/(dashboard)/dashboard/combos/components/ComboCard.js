"use client";

// One combo, as a card. Identity opens the drawer; actions are real buttons;
// selection is a real checkbox — no clickable div pretending to be all three.
import { Card, CapacityBadges } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { strategyMeta } from "../lib/comboMeta";
import { splitHarbor } from "../lib/comboGroups";
import { TONES } from "../lib/comboFormat";
import HealthPill from "./HealthPill";
import StrategyControl from "./StrategyControl";
import UsageCell from "./UsageCell";

function IconBtn({ icon, label, active, danger, onClick }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      title={label}
      aria-label={label}
      className={cn(
        "rounded p-1 transition-colors",
        active
          ? "text-primary"
          : danger
            ? "text-text-muted hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"
            : "text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5"
      )}
    >
      <span className="material-symbols-outlined text-[16px]">{active ? "check" : icon}</span>
    </button>
  );
}

export default function ComboCard({
  combo,
  strategy,
  usage,
  getCaps,
  health,
  copied,
  selected,
  onToggleSelect,
  onCopy,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
  onSetStrategy,
}) {
  const current = strategy?.fallbackStrategy || "fallback";
  const judge = strategy?.judgeModel || "";
  const meta = strategyMeta(current);
  const { harbor, leaf } = splitHarbor(combo.name);
  const members = Array.isArray(combo.models) ? combo.models : [];

  return (
    <Card
      padding="sm"
      className={cn(
        "group flex min-w-0 flex-col gap-3 transition-colors",
        selected ? "border-primary/50 ring-1 ring-primary/30" : "hover:border-brand-500/30"
      )}
    >
      {/* Row 1 — selection, identity, actions */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelect?.(combo.id)}
            aria-label={`Select ${combo.name}`}
            className={cn(
              "mt-1.5 size-3.5 shrink-0 cursor-pointer accent-[var(--color-brand-500)] transition-opacity",
              selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            )}
          />
          <button
            type="button"
            onClick={() => onOpen?.(combo)}
            className="flex min-w-0 items-start gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]/40"
            aria-label={`Open details for ${combo.name}`}
          >
            <span
              className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TONES[meta.tone])}
              aria-hidden="true"
            >
              <span className="material-symbols-outlined text-[17px]">{meta.icon}</span>
            </span>
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-1.5">
                <code className="truncate font-mono text-sm font-medium text-text-main" title={combo.name}>
                  {leaf}
                </code>
                <span className="shrink-0 text-[10px] text-text-muted">
                  {members.length} model{members.length === 1 ? "" : "s"}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-text-muted" title={`${combo.name} · ${meta.hint}`}>
                {harbor ? `${harbor} · ` : ""}
                {meta.label}
              </span>
            </span>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <IconBtn
            icon="content_copy"
            label="Copy name"
            active={copied === `combo-${combo.id}`}
            onClick={() => onCopy?.(combo.name, `combo-${combo.id}`)}
          />
          <IconBtn icon="edit" label="Edit" onClick={() => onEdit?.(combo)} />
          <IconBtn icon="copy_all" label="Duplicate" onClick={() => onDuplicate?.(combo)} />
          <IconBtn icon="delete" label="Delete" danger onClick={() => onDelete?.(combo)} />
        </div>
      </div>

      {/* Row 2 — members, each with its capacity badges */}
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {members.length === 0 ? (
          <span className="text-xs italic text-text-muted">No models</span>
        ) : (
          members.map((model, index) => (
            <span
              key={`${model}-${index}`}
              className="inline-flex max-w-full items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 font-mono text-[11px] text-text-muted dark:bg-white/5"
              title={model}
            >
              <span className="truncate">{model}</span>
              <CapacityBadges caps={getCaps?.(model)} />
            </span>
          ))
        )}
      </div>

      {/* Row 3 — signals: strategy, usage, health */}
      <div className="mt-auto flex flex-col gap-2 border-t border-border-subtle pt-2">
        <StrategyControl
          value={current}
          judge={judge}
          judgeFallback={members[0]}
          onChange={(next) => onSetStrategy?.({ fallbackStrategy: next })}
          onOpenJudge={() => onOpen?.(combo)}
          onClearJudge={() => onSetStrategy?.({ judgeModel: "" })}
        />
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <UsageCell usage={usage} />
          <HealthPill reachable={health?.reachable || 0} total={health?.total || 0} />
        </div>
      </div>
    </Card>
  );
}
