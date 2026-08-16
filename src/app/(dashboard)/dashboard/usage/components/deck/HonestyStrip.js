// Usage Observatory W2-B — the honesty strip (sealed plan W2(b)).
// A quiet line under the decks that tells the truth about the data: as-of
// stamp, timezone, the ~estimated marker where values are funded-not-exact,
// and the dedupe-undercount note. Never faked, never hidden (Manifest graft).
"use client";

import { useState, useEffect } from "react";
import { t } from "../../lib/t";

function tzLabel() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch { return ""; }
}

export default function HonestyStrip() {
  // The stamp lives in state (not Date.now() during render) so the component
  // stays pure; it ticks every 30s to stay honest about freshness.
  const [stamp, setStamp] = useState("");
  const tz = tzLabel();

  useEffect(() => {
    const tick = () => setStamp(new Date().toLocaleTimeString());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div data-i18n-skip="false" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[11px] text-text-muted/70">
      <span>{t("As of")} <span data-i18n-skip="true">{stamp}</span></span>
      {tz && <span>{tz}</span>}
      <span title={t("Cost and savings are estimates computed from pricing at write time")}>
        ~ {t("estimated")}
      </span>
      <span title={t("Duplicate provider/model rows may undercount totals slightly")}>
        {t("dedupe may undercount")} ⓘ
      </span>
    </div>
  );
}
