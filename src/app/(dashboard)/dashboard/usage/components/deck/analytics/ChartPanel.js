// Usage Observatory W2-D — ChartPanel chrome (sealed plan Deck-2).
// The shared frame every Analytics panel rides: a title, an optional subtitle,
// an optional honesty note (~ estimated / collecting), and a fixed-height
// body. One chrome so all six panels read as one instrument.
"use client";

import Card from "@/shared/components/Card";
import { t } from "../../../lib/t";

export default function ChartPanel({
  title,
  subtitle,
  estimated = false,
  collecting = false,
  height = 220,
  action,
  children,
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-2 p-4" padding="none">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-text-muted">
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {estimated && (
            <span
              className="text-[11px] text-text-muted/70"
              title={t("Cost and savings are estimates computed from pricing at write time")}
            >
              ~ {t("estimated")}
            </span>
          )}
          {action}
        </span>
      </div>
      {subtitle && (
        <span className="-mt-1 truncate text-[11px] text-text-muted/70">{subtitle}</span>
      )}
      <div className="min-w-0" style={{ height }}>
        {children}
      </div>
      {collecting && (
        <span className="truncate text-[11px] text-text-muted/60" title={t("Latency, error mix, cache share and savings — collecting since the telemetry upgrade.")}>
          {t("Latency, error mix, cache share and savings — collecting since the telemetry upgrade.")}
        </span>
      )}
    </Card>
  );
}
