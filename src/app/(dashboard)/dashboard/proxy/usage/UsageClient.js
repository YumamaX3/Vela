"use client";
// UsageClient — per-pool usage analytics as its own page (sealed plan §1/§3.2 ·
// `/proxy/usage`), reading `GET /api/proxy-pools/analytics` →
// `{period, wired, since, pools[], meta}`.
//
// WHY THIS PAGE COULD NOT EXIST BEFORE W2 (plan §2 wound #1): `usageHistory` had
// no `poolId`, so the request→pool wire was severed and a per-pool census had
// nothing to group by. W2 added the column and the writer; this page is the first
// reader. That is why the honest empty state matters more here than anywhere else
// in the console: every bucket on this page is attributed since the seam landed,
// and a bucket that was never attributable is ABSENT, never zero-filled.
//
// THE TWO TRUTHS, KEPT SEPARATE (the route's own design, honored verbatim):
//   · `wired`  — does the poolId column exist? A `false` here means the migration
//                 has not reached this harbour; every pool is unattributed.
//   · `since`  — the WATERLINE: the oldest attributed row. A null waterline on a
//                 WIRED harbour just means no attributed request has landed yet.
// A busy hour is never read as "migration missing", and a cold-but-migrated
// harbour says "collecting since…" exactly as a pre-migrate one does. The page
// says which of the two it is looking at; it never blurs them into one banner.
//
// LATENCY IS HONESTLY NULLABLE. `avgLatencyMs`/`p95LatencyMs` are null when no
// row in the window carried a measured latency (wound #3: latencies were once
// NULL on the success path). They render "—", never "0 ms", because zero is a
// measurement and "we did not measure" is not.
//
// NO CHART DEPENDENCY (§6 non-goal): the census is a SORTED TABLE, which is the
// most legible shape for "which pool is carrying the traffic" and needs no
// drawing library. The `recharts` usage page elsewhere is unrelated to this one.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Select } from "@/shared/components";
import { useProxyFleet } from "../hooks/useProxyFleet";
import { loadPoolAnalytics } from "../lib/proxyApi";
import { PoolIdentity, ProxyShore, SectionCard } from "../components";

// The periods `resolvePeriodWindow` accepts (usageNames.PERIODS). "today" and
// "all" resolve to local-midnight / unbounded windows; the page offers the
// bounded ones a per-pool census is most useful over.
const PERIODS = [
  { value: "24h", label: "Last 24 hours" },
  { value: "3d", label: "Last 3 days" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const nf = new Intl.NumberFormat(undefined);
const fmtInt = (v) => (v === null || v === undefined ? "—" : nf.format(Number(v)));
const fmtTokens = (v) => {
  const n = Number(v || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return nf.format(n);
};
const fmtUsd = (v) => (v === null || v === undefined ? "—" : `$${Number(v).toFixed(Number(v) < 0.01 && Number(v) > 0 ? 4 : 2)}`);
const fmtMs = (v) => (v === null || v === undefined ? "—" : `${nf.format(Math.round(Number(v)))} ms`);
const fmtSince = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
};

export default function UsageClient() {
  const c = useProxyFleet();
  const [period, setPeriod] = useState("24h");
  const [state, setState] = useState({ status: "loading", body: null, error: null });

  const read = useCallback(async (p) => {
    setState({ status: "loading", body: null, error: null });
    try {
      const res = await loadPoolAnalytics(p);
      if (res.ok) {
        setState({ status: "ok", body: res.body, error: null });
      } else if (res.status === 400) {
        setState({ status: "error", body: null, error: `Unknown period "${p}" — the console and the route disagree about the vocabulary.` });
      } else {
        setState({ status: "error", body: null, error: res.body?.error || "Could not read pool analytics." });
      }
    } catch (err) {
      setState({ status: "error", body: null, error: err?.message || "Could not reach pool analytics." });
    }
  }, []);

  // The read on mount and on every period change — the period IS the request, and
  // the census is an external system. The setState is the effect's purpose; the
  // disable is the codebase's own written justification (FleetTab's pattern).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    read(period);
  }, [read, period]);

  const pools = useMemo(() => state.body?.pools || [], [state.body]);
  const totals = useMemo(
    () =>
      pools.reduce(
        (acc, p) => {
          acc.requests += p.requests || 0;
          acc.errors += p.errors || 0;
          acc.tokens += (p.promptTokens || 0) + (p.completionTokens || 0);
          acc.cost += Number(p.costUsd || 0);
          return acc;
        },
        { requests: 0, errors: 0, tokens: 0, cost: 0 }
      ),
    [pools]
  );

  const since = fmtSince(state.body?.since);
  const wired = state.body ? state.body.wired !== false : null;

  return (
    <ProxyShore
      title="Usage"
      subtitle="Per-pool requests, tokens, cost and latency — the request→pool wire the fleet could not see before the seam landed."
      icon="query_stats"
      error={c.error || state.error}
      onRetry={state.error ? () => read(period) : c.reload}
      actions={
        <div className="flex items-center gap-2">
          <Select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            options={PERIODS}
            selectClassName="h-8 text-xs min-w-36"
            aria-label="Usage period"
          />
          <Button variant="secondary" size="sm" icon="refresh" onClick={() => read(period)} disabled={state.status === "loading"}>
            Refresh
          </Button>
        </div>
      }
    >
      {/* The honesty banner — only when the data cannot be read as a plain census.
          Wired + attributed → no banner at all: a normal hour deserves no caveat. */}
      {state.status === "ok" && wired === false ? (
        <div className="rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          The <code className="font-mono">poolId</code> attribution seam has not landed in this harbour yet, so no request
          can be tied to a pool. Buckets will appear once the migration reaches this database — nothing here is zero
          because nothing is attributable, not because the fleet is idle.
        </div>
      ) : state.status === "ok" && pools.length === 0 ? (
        <div className="rounded-[12px] border border-border-subtle bg-surface px-3 py-2 text-xs text-text-muted">
          {wired ? (
            <>
              Collecting — the attribution seam is in place{since ? `, attributed since ${since}` : ""}, but no routed
              request has landed in this window yet. A quiet window is not a missing migration.
            </>
          ) : (
            "Collecting — no attributed traffic has landed in this window yet."
          )}
        </div>
      ) : state.status === "ok" && since ? (
        <p className="px-1 text-2xs text-text-muted">
          Attributed since <span className="text-text-main">{since}</span> — pre-seam history carries no pool and is not
          counted here.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile label="Requests" value={fmtInt(totals.requests)} icon="bolt" />
        <SummaryTile label="Errors" value={fmtInt(totals.errors)} icon="error" tone={totals.errors > 0 ? "text-red-500" : "text-text-muted"} />
        <SummaryTile label="Tokens" value={fmtTokens(totals.tokens)} icon="token" />
        <SummaryTile label="Cost" value={fmtUsd(totals.cost)} icon="payments" />
      </div>

      <SectionCard
        title="Per-pool census"
        icon="table_rows"
        count={state.status === "ok" ? pools.length : null}
        description="Busiest first. Every row is an attributed bucket — a pool with no attributed request in the window is absent, not zero."
      >
        {state.status === "loading" ? (
          <p className="text-xs text-text-muted">Reading the usage census…</p>
        ) : state.error ? (
          <p className="text-xs text-text-muted">{state.error}</p>
        ) : pools.length === 0 ? (
          <p className="text-xs text-text-muted">No attributed buckets in this window.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-border-subtle text-2xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-2 font-medium">Pool</th>
                  <th className="px-4 py-2 text-right font-medium">Requests</th>
                  <th className="px-4 py-2 text-right font-medium">Errors</th>
                  <th className="px-4 py-2 text-right font-medium">Tokens</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                  <th className="px-4 py-2 text-right font-medium">Avg latency</th>
                  <th className="px-4 py-2 text-right font-medium">p95</th>
                  <th className="px-4 py-2 font-medium">Providers</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((p) => {
                  // The bucket's own label is the route's projection ({id,name,type});
                  // the store's pool row (if this surface has the fleet) supplies the
                  // verdict badge. A pool the fleet does not know still renders — the
                  // census is its own truth and does not depend on the fleet load.
                  const fleetPool =
                    c.poolById.get(p.poolId) ||
                    (p.label ? { id: p.label.id || p.poolId, name: p.label.name, type: p.label.type } : null);
                  const errRate = p.requests > 0 ? (p.errors / p.requests) * 100 : 0;
                  return (
                    <tr key={p.poolId} className="border-b border-border-subtle align-top last:border-0 hover:bg-surface-2/40">
                      <td className="px-4 py-3">
                        <PoolIdentity pool={fleetPool} />
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-text-main">{fmtInt(p.requests)}</td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums">
                        <span className={errRate >= 20 ? "text-red-600 dark:text-red-400" : errRate > 0 ? "text-amber-600 dark:text-amber-400" : "text-text-muted"}>
                          {fmtInt(p.errors)}
                        </span>
                        {p.requests > 0 ? <span className="ml-1 text-2xs text-text-subtle">({errRate.toFixed(1)}%)</span> : null}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-text-main" title={`${fmtInt((p.promptTokens || 0) + (p.completionTokens || 0))} tokens`}>
                        {fmtTokens((p.promptTokens || 0) + (p.completionTokens || 0))}
                      </td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-text-main">{fmtUsd(p.costUsd)}</td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-text-muted">{fmtMs(p.avgLatencyMs)}</td>
                      <td className="px-4 py-3 text-right text-xs tabular-nums text-text-muted">{fmtMs(p.p95LatencyMs)}</td>
                      <td className="px-4 py-3">
                        {Array.isArray(p.providers) && p.providers.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {p.providers.slice(0, 4).map((prov) => (
                              <Badge key={prov} variant="default" size="sm">
                                {prov}
                              </Badge>
                            ))}
                            {p.providers.length > 4 ? <Badge variant="default" size="sm">+{p.providers.length - 4}</Badge> : null}
                          </span>
                        ) : (
                          <span className="text-2xs text-text-subtle">unbound</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </ProxyShore>
  );
}

function SummaryTile({ label, value, icon, tone = "text-brand-500/80" }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[14px] border border-border-subtle bg-surface px-3 py-2">
      <span className={`material-symbols-outlined text-lg ${tone}`} aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold leading-tight tabular-nums text-text-main">{value}</div>
        <div className="truncate text-2xs text-text-muted">{label}</div>
      </div>
    </div>
  );
}
