"use client";

// The reachability pill — the one place a member hub verdict becomes visible.
// The label is text, not decoration: "2/2 connected" reads identically to a
// screen reader and to the eye.
import { cn } from "@/shared/utils/cn";
import { TONES, healthIcon, healthLabel, healthSummary, toneForHealth } from "../lib/comboFormat";

export default function HealthPill({ reachable, total, className }) {
  if (!total) return null;
  const tone = toneForHealth(reachable, total);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
        TONES[tone],
        className
      )}
      title={healthSummary(reachable, total)}
    >
      <span className="material-symbols-outlined text-[12px]" aria-hidden="true">
        {healthIcon(reachable, total)}
      </span>
      {healthLabel(reachable, total)}
    </span>
  );
}
