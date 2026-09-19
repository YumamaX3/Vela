"use client";

// The category rail — the master column. Smart views on top, the namespace
// tree beneath, each with a live count so the operator knows where the weight
// sits before clicking anything. In compact mode (small screens) the same
// buttons wrap into a chip row instead of a column.
import { cn } from "@/shared/utils/cn";
import { SMART_VIEWS } from "../lib/comboMeta";

function RailButton({ active, icon, label, count, depth = 0, mono, compact, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left text-xs transition-colors",
        compact ? "w-auto shrink-0" : "w-full",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-text-muted hover:bg-black/[0.04] hover:text-text-main dark:hover:bg-white/[0.05]"
      )}
      style={depth && !compact ? { paddingLeft: `${10 + depth * 12}px` } : undefined}
    >
      {icon && (
        <span className="material-symbols-outlined text-[15px] shrink-0" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={cn("min-w-0 flex-1 truncate", mono && "font-mono")}>{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums",
            active ? "bg-primary/15 text-primary" : "bg-black/5 text-text-muted dark:bg-white/5"
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export default function ComboRail({ counts, tree, category, onSelect, totalCombos, className, compact = false }) {
  return (
    <nav
      aria-label="Combo categories"
      className={cn("flex flex-col", compact ? "gap-2" : "gap-4", className)}
    >
      <div className={cn("flex gap-0.5", compact ? "flex-row flex-wrap items-center" : "flex-col")}>
        <p
          className={cn(
            "text-[10px] font-semibold uppercase tracking-wider text-text-subtle",
            compact ? "shrink-0 px-1" : "px-2.5 pb-1"
          )}
        >
          Views
        </p>
        {SMART_VIEWS.map((view) => (
          <RailButton
            key={view.value}
            icon={view.icon}
            label={view.label}
            count={counts?.[view.value] ?? 0}
            compact={compact}
            active={category.type === "view" && category.value === view.value}
            onClick={() => onSelect("view", view.value)}
          />
        ))}
      </div>

      {tree?.length > 0 && (
        <div className={cn("flex gap-0.5", compact ? "flex-row flex-wrap items-center" : "flex-col")}>
          <p
            className={cn(
              "text-[10px] font-semibold uppercase tracking-wider text-text-subtle",
              compact ? "shrink-0 px-1" : "px-2.5 pb-1"
            )}
          >
            Namespaces
          </p>
          <RailButton
            icon="folder_open"
            label="All namespaces"
            count={totalCombos}
            mono
            compact={compact}
            active={category.type === "harbor" && category.value === ""}
            onClick={() => onSelect("harbor", "")}
          />
          {tree.map((node) => (
            <RailButton
              key={node.prefix}
              label={node.leaf}
              count={node.count}
              mono
              depth={node.depth}
              compact={compact}
              active={category.type === "harbor" && category.value === node.prefix}
              onClick={() => onSelect("harbor", node.prefix)}
            />
          ))}
        </div>
      )}

      {!compact && (
        <p className="px-2.5 text-[10px] leading-relaxed text-text-subtle">
          Namespaces come from <code className="font-mono">/</code> in a combo name — group a fleet as{" "}
          <code className="font-mono">vela/cc/opus</code>.
        </p>
      )}
    </nav>
  );
}
