"use client";
// HubClient — the Proxy hub, the front door over the EIGHT separated shores
// (sealed plan §1 "The hub — census strip, quick health, recent activity, links to
// every lens"; §4 · W4 owns the hub's own content).
//
// WHY A HUB EXISTS AT ALL: separating the console into eight routes moved every
// subject to its own address, and an address book with no cover is not a front
// door. The hub answers the operator's first question — "is the fleet healthy
// right now?" — with the SAME census arithmetic the eight shores read (one store,
// one `census`), then shows what the router has been doing (the routing ledger's
// newest routes), and finally offers the eight doors as navigable cards. Nothing
// here is a second dashboard: every fleet number is from `c.census`, every recent
// route is the same `{routes, health}` the Ledger page renders, and every card
// links to the page that owns its subject.
//
// Quick health is here rather than only on Pools and Tools because the sweep is
// the hub's most useful verb: a visitor who suspects the fleet is unwell should
// be able to ask before they know which page they need. It calls the SAME facade
// `c.bulkHealth` the other pages use — one engine call, three verdicts — so there
// is exactly one sweep in the client, not a hub-shaped second copy of it.
//
// RECENT ACTIVITY IS HONEST WHEN IT IS EMPTY. The routing ring is a 256-slot
// in-process ring (ledger.js): a fresh boot, or an instance that has served no
// routed request, has NO routes — and the card says "no routes yet" rather than
// inventing a row. A failed read says so, separating "nothing has happened" from
// "I could not look," which are different truths a blank table would blur.
//
// The hub deliberately never gates on `c.loading`. A front door that shows a
// skeleton until the fleet answers hides the eight links — the only thing on this
// page that matters if the load has failed. It renders immediately; the census,
// the sweep and the ledger fill in, or the banner says why they did not.
import Link from "next/link";
import { useEffect, useState } from "react";
// The shell imports its imports from one place — the store facade and the barrel
// both live one directory up from any shore, hub included (§3.1 tree).
import { useProxyFleet } from "../hooks/useProxyFleet";
import { loadRoutingLedger } from "../lib/proxyApi";
import { PROXY_LENSES } from "../lib/proxyDoors";
import { fmtTime } from "../lib/proxyFormat";
import { ProxyCensus, ProxyShore, SectionCard } from "../components";

/** A route outcome's tone — success is calm, a halt is amber, and the reason is
 *  named beside it rather than encoded only in colour (R-22). */
function RouteOutcome({ route }) {
  if (route.ok === true) return <span className="text-2xs font-medium text-green-600 dark:text-green-400">ok</span>;
  return (
    <span className="text-2xs font-medium text-amber-600 dark:text-amber-400" title={route.haltReason || "halted"}>
      halt
    </span>
  );
}

export default function HubClient() {
  const c = useProxyFleet();
  const [sweeping, setSweeping] = useState(false);
  const [lastSweep, setLastSweep] = useState(null);

  // Recent activity — the ledger's newest routes, read once on mount. Not in the
  // store on purpose: the ledger ring is a separate current from the fleet, and a
  // store field for it would carry a 256-row ring into every shore that selects
  // the fleet. This card is the only consumer on the hub.
  const [ledger, setLedger] = useState({ status: "loading", routes: [], health: {} });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await loadRoutingLedger({ limit: 8 });
        if (!alive) return;
        if (res.ok) {
          setLedger({ status: "ok", routes: res.body?.routes || [], health: res.body?.health || {} });
        } else {
          setLedger({ status: "error", routes: [], health: {} });
        }
      } catch {
        if (alive) setLedger({ status: "error", routes: [], health: {} });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const runSweep = async () => {
    setSweeping(true);
    try {
      const res = await c.bulkHealth({ autoDisable: false });
      // The hub reports the engine's three buckets and NEVER acts on the fleet: the
      // disable offer belongs to Pools, where the selected set is visible. A hub that
      // quietly disabled pools would be the self-liquidation wound in a new coat.
      if (res?.ok && res.body) {
        setLastSweep({
          alive: res.body.alive ?? 0,
          dead: res.body.dead ?? 0,
          indeterminate: res.body.indeterminate ?? 0,
        });
      } else {
        setLastSweep(null);
      }
    } finally {
      setSweeping(false);
    }
  };

  const providerScores = Object.entries(ledger.health || {})
    .sort((a, b) => (b[1]?.samples || 0) - (a[1]?.samples || 0))
    .slice(0, 4);

  return (
    <ProxyShore
      title="Proxy"
      subtitle="One fleet, eight doors: pools, fitness, egress, relays — and the ledger, usage and tools that read them."
      icon="lan"
      error={c.error}
      onRetry={c.reload}
      actions={
        <button
          type="button"
          onClick={runSweep}
          disabled={sweeping || c.loading || c.pools.length === 0}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-border-subtle bg-surface px-2.5 py-1.5 text-xs font-medium text-text-main disabled:opacity-50"
          title="Sweep the whole fleet once, through the engine"
        >
          <span className="material-symbols-outlined text-base text-brand-500" aria-hidden="true">
            {sweeping ? "progress_activity" : "health_and_safety"}
          </span>
          {sweeping ? "Checking…" : "Quick health"}
        </button>
      }
    >
      <ProxyCensus census={c.census} />

      {lastSweep ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[12px] border border-border-subtle bg-surface px-3 py-2 text-2xs text-text-muted">
          <span>Last sweep</span>
          <span>
            <span className="tabular-nums text-text-main">{lastSweep.alive}</span> ok
          </span>
          <span>
            <span className="tabular-nums text-text-main">{lastSweep.dead}</span> proven dead
          </span>
          <span>
            <span className="tabular-nums text-text-main">{lastSweep.indeterminate}</span> indeterminate, left
            active
          </span>
          <Link
            href="/dashboard/proxy/pools"
            className="ml-auto font-medium text-brand-500 underline decoration-dotted underline-offset-2"
          >
            Review on Pools
          </Link>
        </div>
      ) : null}

      <SectionCard
        title="Recent routes"
        icon="route"
        count={ledger.status === "ok" ? `${ledger.routes.length}` : null}
        description="The router's newest decisions — provider, model, outcome and duration. The full trace lives on the Ledger."
        actions={
          <Link
            href="/dashboard/proxy/ledger"
            className="text-xs font-medium text-brand-500 underline decoration-dotted underline-offset-2"
          >
            Open the ledger
          </Link>
        }
      >
        {ledger.status === "loading" ? (
          <p className="text-xs text-text-muted">Reading the routing ring…</p>
        ) : ledger.status === "error" ? (
          <p className="text-xs text-text-muted">The ledger could not be read right now — this is a failed read, not an empty one.</p>
        ) : ledger.routes.length === 0 ? (
          <p className="text-xs text-text-muted">
            No routes yet — the ledger is a 256-slot in-process ring, so it starts empty after a boot and fills as the
            gateway routes.
          </p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-border-subtle text-2xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-1.5 font-medium">When</th>
                  <th className="px-4 py-1.5 font-medium">Provider</th>
                  <th className="px-4 py-1.5 font-medium">Model</th>
                  <th className="px-4 py-1.5 font-medium">Outcome</th>
                  <th className="px-4 py-1.5 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {ledger.routes.slice(0, 6).map((r) => (
                  <tr key={r.seq} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-1.5 text-2xs text-text-muted">{fmtTime(r.ts)}</td>
                    <td className="px-4 py-1.5 text-xs text-text-main">{r.providerId || "—"}</td>
                    <td className="max-w-[220px] truncate px-4 py-1.5 text-xs text-text-muted" title={r.model || ""}>
                      {r.model || "—"}
                    </td>
                    <td className="px-4 py-1.5">
                      <RouteOutcome route={r} />
                    </td>
                    <td className="px-4 py-1.5 text-right text-2xs tabular-nums text-text-muted">
                      {r.ms === null || r.ms === undefined ? "—" : `${r.ms} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {providerScores.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 text-2xs text-text-muted">
                <span>Health score</span>
                {providerScores.map(([pid, h]) => (
                  <span key={pid}>
                    {pid}{" "}
                    <span className="tabular-nums text-text-main">{h.score}%</span>{" "}
                    <span className="text-text-subtle">({h.samples})</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Every lens"
        icon="space_dashboard"
        description="Each shore owns one subject and one address. The fleet store is shared, so walking between them costs no refetch."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PROXY_LENSES.map((door) => {
            const chip = typeof door.chip === "function" ? door.chip(c) : null;
            return (
              <Link
                key={door.href}
                href={door.href}
                className="group flex items-start gap-3 rounded-[14px] border border-border-subtle bg-surface-2/30 p-4 transition-colors hover:border-brand-500/40 hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-brand)] bg-brand-500/10 text-brand-500">
                  <span className="material-symbols-outlined text-xl" aria-hidden="true">
                    {door.icon}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-text-main">{door.label}</span>
                    {chip ? <span className="text-2xs text-text-muted">{chip}</span> : null}
                  </span>
                  <span className="mt-1 block text-xs text-text-muted">{door.blurb}</span>
                </span>
                <span
                  className="material-symbols-outlined text-lg text-text-subtle transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                >
                  arrow_forward
                </span>
              </Link>
            );
          })}
        </div>
      </SectionCard>
    </ProxyShore>
  );
}
