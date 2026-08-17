// Usage Observatory W3-C — the cockpit banner.
//
// Surfaces ACTIVE budget breaches (soft thresholds crossed, hard caps biting)
// at the top of the compass deck, across every bearing. The breach state is
// server-owned (budgetAlerts.js keeps it, /api/usage/budgets/alerts serves it)
// — the banner polls it on a gentle cadence and renders the worst offenders.
// Red when a hard cap (100%) is reached and traffic is being denied; amber
// for the softer 50/80 crossings. Fail-open: a failed poll leaves the banner
// hidden — an instrument that cannot reach its source degrades silently.
"use client";

import { useEffect, useState } from "react";
import { t } from "../../lib/t";

const POLL_MS = 30_000;

function breachTone(breach) {
  return breach.threshold >= 100
    ? "border-error/40 bg-error/10 text-error"
    : "border-warning/40 bg-warning/10 text-warning";
}

function capLabel(breach) {
  return breach.capType === "token"
    ? `${Number(breach.used || 0).toLocaleString()} / ${Number(breach.cap || 0).toLocaleString()} tokens`
    : `$${((breach.used || 0) / 100).toFixed(2)} / $${((breach.cap || 0) / 100).toFixed(2)}`;
}

export default function BudgetAlertBanner() {
  const [breaches, setBreaches] = useState([]);

  useEffect(() => {
    let alive = true;
    let timer = null;
    const poll = () => {
      fetch("/api/usage/budgets/alerts")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setBreaches(d?.breaches || []); })
        .catch(() => {}); // fail-open — the banner degrades, never errors
      timer = setTimeout(poll, POLL_MS);
    };
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);

  if (!breaches.length) return null;

  const shown = breaches.slice(0, 3);
  const extra = breaches.length - shown.length;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        <span className="material-symbols-outlined text-[14px]">warning</span>
        {t("Budget alerts")}
      </div>
      {shown.map((b) => (
        <div
          key={`${b.budgetId}|${b.capType}`}
          className={`flex items-center justify-between gap-3 rounded-[10px] border px-3 py-2 text-sm ${breachTone(b)}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium" data-i18n-skip="true">{b.budgetId}</span>
            <span className="shrink-0 text-[11px] uppercase opacity-80" data-i18n-skip="true">
              {b.window} · {b.capType}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-[12px] tabular-nums">
            <span data-i18n-skip="true">{capLabel(b)}</span>
            <span className="rounded-full border border-current px-1.5 font-semibold" data-i18n-skip="true">
              {b.pct}%
            </span>
          </span>
        </div>
      ))}
      {extra > 0 && (
        <div className="text-[11px] text-text-muted">{t("and {n} more", { n: extra })}</div>
      )}
    </div>
  );
}
