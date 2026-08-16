// Usage Observatory W2-F — per-key usage bars (sealed plan Deck-4).
// Who is calling the gateway, and how much. Merges /api/keys (masked list)
// with /api/keys/usage (keyId-keyed rollup) over a fixed honest window —
// the last 30 days. Bars are normalized to the busiest key; a click crosses
// to the Requests deck pre-filtered to that key (the same facet-then-cross
// gesture the StatusMix donut uses, one atomic URL write via setFacets).
// Attribution is keyId-based (hash-at-rest), so totals survive key rotation.
//
// Budget bars ride W3 — this panel shows what the telemetry funds today.
"use client";

import { useEffect, useMemo, useState } from "react";
import Card from "@/shared/components/Card";
import { t } from "../../../lib/t";
import { fmtTokens } from "../../../lib/ledgerFmt";

const WINDOW = "30d"; // the honest fixed window — limits don't respect the Needle period
const fmtCost = (n) => (!n || n <= 0 ? "$0.00" : n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);
const fmtDate = (ts) => {
  if (!ts) return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
};

export default function KeyUsagePanel({ compass }) {
  const [keys, setKeys] = useState(null);
  const [byKey, setByKey] = useState({});

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/keys?limit=200").then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/keys/usage?period=${WINDOW}`).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([k, u]) => {
        if (!alive) return;
        setKeys(k?.keys || []);
        setByKey(u?.byKey || {});
      })
      .catch(() => {}); // fail-open — empty panel beats an error wall
    return () => { alive = false; };
  }, []);

  // Merge on keyId; the bar scale rides the busiest key's cost.
  const rows = useMemo(() => {
    if (!Array.isArray(keys)) return [];
    return keys
      .map((k) => ({ ...k, usage: byKey[k.id] || null }))
      .sort((a, b) => (b.usage?.cost || 0) - (a.usage?.cost || 0));
  }, [keys, byKey]);
  const maxCost = useMemo(
    () => Math.max(...rows.map((r) => r.usage?.cost || 0), 0),
    [rows]
  );

  const crossToRequests = (keyId) => {
    // One atomic URL write: facet the key + cross to the requests bearing.
    compass.setFacets({ key: keyId, tab: "requests" });
  };

  return (
    <Card padding="none">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-text">{t("API key usage")}</span>
          <span className="text-[11px] text-text-muted">{t("last 30 days")} · {t("Budget bars arrive with the next tide")}</span>
        </div>
        <span className="material-symbols-outlined text-[18px] text-text-muted">key</span>
      </div>

      <div className="flex flex-col">
        {keys === null ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border-b border-border px-4 py-3 last:border-b-0">
              <div className="h-4 w-1/3 animate-pulse rounded bg-bg-subtle" />
              <div className="mt-2 h-2 w-full animate-pulse rounded bg-bg-subtle" />
            </div>
          ))
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-text-muted">{t("No API keys yet")}</div>
        ) : (
          rows.map((row) => {
            const u = row.usage;
            const width = maxCost > 0 && u ? Math.max(2, ((u.cost || 0) / maxCost) * 100) : 0;
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => crossToRequests(row.id)}
                title={`${row.name} — ${t("View requests")}`}
                className="group border-b border-border px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-bg-hover"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-text">{row.name}</span>
                    <code className="shrink-0 font-mono text-[11px] text-text-muted" data-i18n-skip="true">{row.keyPrefix}</code>
                    {row.isActive === false && (
                      <span className="shrink-0 rounded-full border border-warning/30 bg-warning/10 px-1.5 text-[10px] font-semibold text-warning">{t("Paused")}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-text-muted" data-i18n-skip="true">
                    <span title={t("Requests")}>{u ? u.requests.toLocaleString() : 0}</span>
                    <span title={t("Tokens")}>{u ? fmtTokens(u.totalTokens) : 0}</span>
                    <span className="font-medium text-text" title={t("Est. Cost")}>~{fmtCost(u?.cost)}</span>
                  </span>
                </div>
                <div className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle">
                  <span
                    className="block h-full rounded-full bg-primary transition-[width] duration-300 group-hover:bg-primary/80"
                    style={{ width: `${width}%` }}
                  />
                </div>
                {u?.lastUsed ? (
                  <span className="mt-1 block text-[10px] text-text-muted/70">
                    {t("Last used")} {fmtDate(u.lastUsed)}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </Card>
  );
}
