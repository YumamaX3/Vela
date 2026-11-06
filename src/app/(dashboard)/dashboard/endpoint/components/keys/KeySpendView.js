"use client";
// KeySpendView — where the money went, per key (sealed plan §3.1 · W3, the cost
// attribution view).
//
// WHY IT EXISTS: the deck's rows showed each key's usage, but cost was one
// number per row with no ordering and no total — so "which key is expensive?"
// was a question the operator answered by reading every row. This view answers
// it directly: rows sorted by cost descending, tokens and cost formatted, the
// window shared with every other strip on the shore.
//
// THE RECONCILIATION LAW: per-key rollup comes from `/api/keys/usage`
// (`byKey: { [keyId]: { requests, tokens, cost, … } }`) and the census totals
// from `/api/keys/stats` (`totals: { requests, tokens, cost, … }`). Keys with no
// traffic in the window are ABSENT from the rollup — they are shown as
// zero-traffic rows and counted in the honest line "N keys had no traffic",
// never folded into a fabricated number. A failed read says so; the view never
// invents a cost.
import { useEffect, useState } from "react";
import { translate } from "@/i18n/runtime";
import { Card } from "@/shared/components";

import { PERIODS } from "../../hooks/useKeyDeck";
function fmtCost(cents) {
  const n = Number(cents) || 0;
  return n >= 100 ? `$${(n / 100).toFixed(2)}` : `${n.toFixed(1)}¢`;
}

/** Format a token count — thousands separators, no false precision. */
function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

/** Format the last-used time — compact, no locale drift. */
function fmtWhen(t) {
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function KeySpendView({ c, deck }) {
  const period = deck.usagePeriod;
  const [rows, setRows] = useState(null);
  const [census, setCensus] = useState(null);
  const [error, setError] = useState(null);

  // Period-keyed, and re-read when the key set changes (a new key's cost
  // belongs in the list the moment it exists) — the same dependency shape the
  // usage rollup in the store uses.
  useEffect(() => {
    const controller = new AbortController();
    setRows(null);
    setError(null);
    (async () => {
      try {
        const [usageRes, statsRes] = await Promise.all([
          fetch(`/api/keys/usage?period=${encodeURIComponent(period)}`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/keys/stats?period=${encodeURIComponent(period)}`, { cache: "no-store", signal: controller.signal }),
        ]);
        if (!usageRes.ok) throw new Error(`usage HTTP ${usageRes.status}`);
        const usage = await usageRes.json();
        const stats = statsRes.ok ? await statsRes.json() : null;
        if (controller.signal.aborted) return;
        setCensus(stats?.totals || null);
        const byKey = usage?.byKey || {};
        const keys = c.keys || [];
        // Every key gets a row — traffic or not. The rollup omits keys with no
        // traffic in the window, and an absent key is a fact (zero), not a
        // reason to drop the row.
        const merged = keys.map((k) => {
          const u = byKey[k.id] || null;
          return {
            id: k.id,
            name: k.name || k.keyPrefix || k.id,
            posture: k.isActive === false ? "paused" : "active",
            requests: u?.requests || 0,
            tokens: u?.totalTokens || 0,
            cost: Number(u?.cost) || 0,
            lastUsed: u?.lastUsed || null,
            hadTraffic: Boolean(u),
          };
        });
        // A key the fleet read has not yet seen (just minted) still earns a row.
        for (const [id, u] of Object.entries(byKey)) {
          if (merged.some((r) => r.id === id)) continue;
          merged.push({
            id,
            name: id,
            posture: "active",
            requests: u?.requests || 0,
            tokens: u?.totalTokens || 0,
            cost: Number(u?.cost) || 0,
            lastUsed: u?.lastUsed || null,
            hadTraffic: true,
          });
        }
        merged.sort((a, b) => b.cost - a.cost || b.requests - a.requests);
        setRows(merged);
      } catch (err) {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        setError(err?.message || "could not be read");
      }
    })();
    return () => controller.abort();
  }, [period, c.keys]);

  const periodLabel = PERIODS.find((p) => p.value === period)?.label || period;
  const noTraffic = rows ? rows.filter((r) => !r.hadTraffic).length : 0;
  const rowCost = rows ? rows.reduce((n, r) => n + r.cost, 0) : 0;
  const censusCost = census ? Number(census.cost) || 0 : null;
  // The reconciliation line: the rows' own sum against the census's sum. They
  // count the same window over the same ledger, so they agree; when they do
  // not, the view SAYS so rather than quietly showing one of them.
  const reconciled = censusCost === null || Math.abs(censusCost - rowCost) < 0.5;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-lg text-brand-500/80" aria-hidden="true">payments</span>
          {translate("Spend")}
        </h2>
        <span className="text-2xs text-text-muted">
          {translate("Per-key cost over the last")} {periodLabel.toLowerCase()}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-text-muted py-2">
          {translate("Spend could not be read")} — {error}
        </p>
      ) : rows === null ? (
        <p className="text-xs text-text-muted py-2">{translate("Reading spend…")}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-text-muted py-2">{translate("No keys to attribute spend to.")}</p>
      ) : (
        <>
          <div className="flex flex-col">
            <div className="flex items-center gap-3 py-1.5 border-b border-border text-3xs font-semibold text-text-muted uppercase tracking-wider">
              <span className="w-[140px] shrink-0">{translate("Key")}</span>
              <span className="flex-1 text-right">{translate("Requests")}</span>
              <span className="w-[64px] text-right">{translate("Tokens")}</span>
              <span className="w-[64px] text-right">{translate("Cost")}</span>
              <span className="w-[44px] text-right hidden sm:block">{translate("Used")}</span>
            </div>
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 py-1.5 border-b border-border-subtle last:border-b-0 text-xs"
              >
                <span className="w-[140px] shrink-0 truncate min-w-0" title={r.name}>
                  {r.name}
                  {!r.hadTraffic && (
                    <span className="text-3xs text-text-muted ml-1">{translate("no traffic")}</span>
                  )}
                </span>
                <span className="flex-1 text-right font-mono tabular-nums">{r.requests.toLocaleString()}</span>
                <span className="w-[64px] text-right font-mono tabular-nums">{fmtTokens(r.tokens)}</span>
                <span className="w-[64px] text-right font-mono tabular-nums">{fmtCost(r.cost)}</span>
                <span className="w-[44px] text-right font-mono tabular-nums text-text-muted hidden sm:block">{fmtWhen(r.lastUsed)}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-2xs text-text-muted">
            <span className="font-mono tabular-nums">
              {translate("rows total")} {fmtCost(rowCost)}
            </span>
            {censusCost !== null && (
              <span className="font-mono tabular-nums">
                {translate("census total")} {fmtCost(censusCost)}
                {reconciled ? "" : ` — ${translate("these disagree; the census is the server's own count")}`}
              </span>
            )}
            {noTraffic > 0 && (
              <span>{noTraffic} {noTraffic === 1 ? translate("key had no traffic") : translate("keys had no traffic")}</span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
