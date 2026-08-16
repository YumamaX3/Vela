// Usage Observatory W2-D — the Analytics deck, "Is it healthy?"
// W2-B seeds an honest collecting-state; W2-D fills the panels:
// compact topology pulse + 3 live tiles → LatencyLines, ErrorMix,
// CacheShare, CostPerMtok, UsageByKey, RtkSavings (ChartPanel chrome,
// 'collecting since' honesty until telemetry accrues).
"use client";

import Card from "@/shared/components/Card";
import { t } from "../../lib/t";

export default function AnalyticsDeck() {
  return (
    <Card className="flex min-w-0 flex-col items-center justify-center gap-2 py-16" padding="lg">
      <span className="material-symbols-outlined text-[40px] text-text-muted/60">monitor_heart</span>
      <p className="text-sm font-medium text-text">{t("Health panels arrive with the next tide")}</p>
      <p className="text-xs text-text-muted">
        {t("Latency, error mix, cache share and savings — collecting since the telemetry upgrade.")}
      </p>
    </Card>
  );
}
