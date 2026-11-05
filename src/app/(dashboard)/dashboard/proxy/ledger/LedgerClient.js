"use client";
// LedgerClient — the routing ledger as its own page (sealed plan §1 · `/proxy/ledger`;
// §3.2: the ledger reads `GET /api/proxy-pools/routing-ledger` → `{routes, health}`).
//
// WHAT THE LEDGER IS: the router's own trace (pipeline/ledger.js). Every routed
// request writes one summary line into a FIXED 256-slot in-process ring — newest
// first — and `healthScore()` rolls that same window into a per-provider success
// rate. This page is the mirror of that trace: it reads, it filters, it never
// writes. The ledger is the operator's instrument, never the engine's input, and
// nothing on this page can change a routing decision.
//
// THE THREE TRUTHS THE PAGE KEEPS SEPARATE:
//   · EMPTY — the ring is in-process, so after a boot and before traffic it is
//     empty. "No routes yet" says exactly that; it does not say "healthy".
//   · FILTERED-EMPTY — routes exist for other providers but not this one. The
//     empty state names the filter, so a provider-scoped blank never reads as a
//     dead fleet.
//   · FAILED — the read itself refused. Said plainly, with a retry, because a
//     failed read and an empty ring are different truths a blank table blurs.
//
// THE PROVIDER FILTER DOES NOT RE-FETCH. `recentRoutes({providerId})` scopes a
// ring that is already whole, and the ring holds at most 256 rows — so the page
// reads the full ledger once and filters in memory, which keeps the health score
// and the rows scoped to the same window as the operator switches filters. The
// route accepts `?provider=` for a caller that wants one provider and no fleet
// read; this page wants the whole window, so it reads the whole window.
//
// THE SAMPLE FIELD IS NAMED, NOT HIDDEN. `spans` is whatever the failure kept
// (full spans) or the success kept (stage NAMES only) — sampling is a budget
// decision made in the ring, not a UI simplification made here, so where a failure
// carried detail the row offers it in a disclosure rather than dropping it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Select } from "@/shared/components";
import { useProxyFleet } from "../hooks/useProxyFleet";
import { loadRoutingLedger } from "../lib/proxyApi";
import { fmtTime } from "../lib/proxyFormat";
import { ProxyShore, SectionCard } from "../components";

const LIMIT = 256; // the ring's whole width — the page reads the entire trace

/** The outcome cell: ok / halt, with the halt reason named beside it. */
function Outcome({ route }) {
  if (route.ok === true) {
    return (
      <Badge variant="success" size="sm" dot>
        ok
      </Badge>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant="warning" size="sm" dot>
        halt
      </Badge>
      {route.haltReason ? <span className="text-2xs text-text-muted">{route.haltReason}</span> : null}
    </div>
  );
}

/** The spans a row carries: names for a sampled success, objects for a failure. */
function Spans({ spans }) {
  if (!Array.isArray(spans) || spans.length === 0) return <span className="text-2xs text-text-subtle">—</span>;
  const first = spans[0];
  const objects = first && typeof first === "object";
  if (!objects) {
    return (
      <span className="flex flex-wrap gap-1">
        {spans.map((name, i) => (
          <span key={`${name}-${i}`} className="rounded-full bg-surface-2 px-1.5 py-0.5 text-2xs text-text-muted">
            {name || "span"}
          </span>
        ))}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      {spans.map((s, i) => (
        <span key={`${s?.stage}-${i}`} className="text-2xs text-text-muted">
          <span className="font-medium text-text-main">{s?.stage || "span"}</span>
          {s?.decision ? ` · ${s.decision}` : ""}
          {s?.ms !== undefined && s?.ms !== null ? ` · ${s.ms} ms` : ""}
          {s?.detail ? ` · ${typeof s.detail === "string" ? s.detail : JSON.stringify(s.detail)}` : null}
        </span>
      ))}
    </div>
  );
}

/** One provider's health-score tile. A score is `null` when the provider served
 *  no traffic in the window — never a fabricated 100, and never a red 0. */
function ScoreTile({ providerId, health }) {
  const samples = health?.samples ?? 0;
  const score = health?.score;
  const tone =
    samples === 0 || score === null || score === undefined
      ? "text-text-muted"
      : score >= 99
        ? "text-green-600 dark:text-green-400"
        : score >= 90
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400";
  return (
    <div className="flex items-center justify-between gap-3 rounded-[12px] border border-border-subtle bg-surface px-3 py-2">
      <span className="min-w-0 truncate text-xs font-medium text-text-main">{providerId}</span>
      <span className="flex items-baseline gap-1.5">
        <span className={`text-sm font-semibold tabular-nums ${tone}`}>
          {score === null || score === undefined ? "—" : `${score}%`}
        </span>
        <span className="text-2xs tabular-nums text-text-muted">{samples} samples</span>
      </span>
    </div>
  );
}

export default function LedgerClient() {
  const c = useProxyFleet();
  const [state, setState] = useState({ status: "loading", routes: [], health: {}, error: null });
  const [providerId, setProviderId] = useState("all");

  const read = useCallback(async () => {
    // Every caller is an explicit read (the mount, the Refresh click), so the
    // state goes straight to `loading`; a retry after a failure replaces the
    // error, it never stacks one on top of another.
    setState({ status: "loading", routes: [], health: {}, error: null });
    try {
      const res = await loadRoutingLedger({ limit: LIMIT });
      if (res.ok) {
        setState({ status: "ok", routes: res.body?.routes || [], health: res.body?.health || {}, error: null });
      } else {
        setState({ status: "error", routes: [], health: {}, error: res.body?.error || "Could not read the routing ledger." });
      }
    } catch (err) {
      setState({ status: "error", routes: [], health: {}, error: err?.message || "Could not reach the routing ledger." });
    }
  }, []);

  // The mount read. `read` sets `loading` before its await and the result after it,
  // so the setState here is the effect's stated purpose: synchronize with the
  // ledger ring, an external system. The same justification FleetTab carries.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    read();
  }, [read]);

  // Every provider the window has seen — the filter's options come from the trace
  // itself, so a provider with routes is always selectable and one without never is.
  const providers = useMemo(() => {
    const set = new Set();
    for (const r of state.routes) if (r.providerId) set.add(r.providerId);
    return [...set].sort();
  }, [state.routes]);

  const rows = useMemo(
    () => (providerId === "all" ? state.routes : state.routes.filter((r) => r.providerId === providerId)),
    [state.routes, providerId]
  );

  // The score the page shows is scoped the same way the rows are: one provider →
  // that provider's score; the whole fleet → every provider's tile, busiest first.
  const scoreEntries = useMemo(() => {
    const entries = Object.entries(state.health || {});
    const scoped = providerId === "all" ? entries : entries.filter(([pid]) => pid === providerId);
    return scoped.sort((a, b) => (b[1]?.samples || 0) - (a[1]?.samples || 0));
  }, [state.health, providerId]);

  const filterOptions = useMemo(
    () => [{ value: "all", label: "All providers" }, ...providers.map((p) => ({ value: p, label: p }))],
    [providers]
  );

  return (
    <ProxyShore
      title="Ledger"
      subtitle="The router's trace: which provider, which model, which pool — and the health score rolled from the same window."
      icon="route"
      error={c.error}
      onRetry={c.reload}
      actions={
        <Button variant="secondary" size="sm" icon="refresh" onClick={read} disabled={state.status === "loading"}>
          Refresh
        </Button>
      }
    >
      <p className="text-xs text-text-muted">
        The ledger is a fixed 256-slot in-process ring, sampled by default: a successful route keeps one summary line and
        its stage names, while a failed route keeps its full spans — that is the walk the operator needs. It records what
        the router did; it never steers it.
      </p>

      <SectionCard
        title="Health score"
        icon="monitor_heart"
        count={scoreEntries.length}
        description="Success rate over the recorded window, per provider. A provider with no traffic scores nothing — not 100%, and not 0%."
        actions={
          <Select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            options={filterOptions}
            selectClassName="h-7 text-xs min-w-40"
          />
        }
      >
        {state.status === "error" ? (
          <p className="text-xs text-text-muted">No score to show: the ledger read failed. Retry above.</p>
        ) : scoreEntries.length === 0 ? (
          <p className="text-xs text-text-muted">
            {providerId === "all" ? "No provider has routed yet." : `No traffic recorded for ${providerId} in this window.`}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {scoreEntries.map(([pid, h]) => (
              <ScoreTile key={pid} providerId={pid} health={h} />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Recent routes"
        icon="route"
        count={state.status === "ok" ? rows.length : null}
        description="Newest first. Times are the ring's own stamps."
      >
        {state.error ? (
          <p className="text-xs text-text-muted">{state.error}</p>
        ) : state.status === "loading" ? (
          <p className="text-xs text-text-muted">Reading the routing ring…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-text-muted">
            {providerId === "all"
              ? "No routes yet — the ring starts empty after a boot and fills as the gateway routes. This is an empty trace, not a clean bill of health."
              : `No routes for ${providerId} in this window — clear the filter to see the rest of the fleet.`}
          </p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left">
              <thead>
                <tr className="border-b border-border-subtle text-2xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Pool</th>
                  <th className="px-4 py-2 font-medium">Strategy</th>
                  <th className="px-4 py-2 font-medium">Outcome</th>
                  <th className="px-4 py-2 text-right font-medium">Duration</th>
                  <th className="px-4 py-2 font-medium">Spans</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // A route names its pool by id; the fleet store is the one place
                  // that maps id → name, and it is already loaded above this shore.
                  const pool = r.poolId ? c.poolById.get(r.poolId) : null;
                  return (
                    <tr key={r.seq} className="border-b border-border-subtle align-top last:border-0 hover:bg-surface-2/40">
                      <td className="whitespace-nowrap px-4 py-2 text-2xs text-text-muted">{fmtTime(r.ts)}</td>
                      <td className="px-4 py-2 text-xs text-text-main">{r.providerId || "—"}</td>
                      <td className="max-w-[220px] truncate px-4 py-2 text-xs text-text-muted" title={r.model || ""}>
                        {r.model || "—"}
                      </td>
                      <td className="max-w-[180px] truncate px-4 py-2 text-xs text-text-muted" title={r.poolId || ""}>
                        {pool?.name || r.poolId || "—"}
                      </td>
                      <td className="px-4 py-2 text-2xs text-text-muted">{r.strategy || "—"}</td>
                      <td className="px-4 py-2">
                        <Outcome route={r} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right text-2xs tabular-nums text-text-muted">
                        {r.ms === null || r.ms === undefined ? "—" : `${r.ms} ms`}
                      </td>
                      <td className="max-w-[260px] px-4 py-2">
                        <Spans spans={r.spans} />
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
