"use client";

// The strategy control — a segmented switch rather than a dropdown, because a
// strategy is a mode with three states and the operator should see the current
// one without opening anything. Fusion reveals its judge on the same row.
import { cn } from "@/shared/utils/cn";
import { STRATEGY_OPTIONS, strategyMeta } from "../lib/comboMeta";

export default function StrategyControl({
  value,
  onChange,
  judge = "",
  judgeFallback = "",
  onOpenJudge,
  onClearJudge,
  className,
}) {
  const meta = strategyMeta(value);

  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      <div
        role="group"
        aria-label="Fallback strategy"
        className="inline-flex items-center gap-0.5 rounded-lg border border-border-subtle bg-bg p-0.5"
      >
        {STRATEGY_OPTIONS.map((option) => {
          const active = value === option.value;
          const optionMeta = strategyMeta(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              title={optionMeta.hint}
              onClick={(e) => {
                e.stopPropagation();
                onChange(option.value);
              }}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "bg-surface text-text-main shadow-[var(--shadow-soft)]"
                  : "text-text-muted hover:text-text-main"
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {value === "fusion" && (
        <span className="inline-flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenJudge?.();
            }}
            title={`Pick the model that fuses panel answers (${meta.hint})`}
            className="inline-flex min-w-0 max-w-[220px] items-center gap-1 rounded border border-dashed border-violet-400/50 px-1.5 py-1 font-mono text-[11px] text-violet-600 transition-colors hover:border-violet-400 hover:bg-violet-500/5 dark:text-violet-300"
          >
            <span className="material-symbols-outlined text-[13px]" aria-hidden="true">
              gavel
            </span>
            <span className="truncate">{judge || `Auto · ${judgeFallback || "first model"}`}</span>
          </button>
          {judge && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClearJudge?.();
              }}
              className="rounded p-0.5 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"
              title="Reset judge to Auto"
              aria-label="Reset judge to Auto"
            >
              <span className="material-symbols-outlined text-[13px]">close</span>
            </button>
          )}
        </span>
      )}
    </div>
  );
}
