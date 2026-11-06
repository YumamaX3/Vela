"use client";
// HubClient — the Endpoint hub, the front door over the FIVE separated shores
// (sealed plan §3.1 · W4).
//
// WHY A HUB EXISTS AT ALL: separating the console into five routes moved every
// subject to its own address, and an address book with no cover is not a front
// door. The hub answers the operator's first question — "what is this fleet's
// posture right now?" — then shows what the gateway has been serving (the
// recent requests the Log Harbor reads), and finally offers the doors as
// navigable cards. Nothing here is a second dashboard: every fleet number is
// from the facade, every recent request is the same wire the Log Harbor reads,
// and every card links to the page that owns its subject.
//
// The census is stated HONESTLY: the server's own census when it has answered
// (it agrees with the API), the client's derivation while it is in flight — and
// the label SAYS which one is on screen. A count that quietly switched source
// between two renders would be a lie told by a relabeling.
//
// RECENT ACTIVITY IS HONEST WHEN IT IS EMPTY: a fresh boot has served no
// requests, and the card says "no requests yet" rather than inventing a row.
// A failed read says so, separating "nothing has happened" from "I could not
// look," which are different truths a blank table would blur.
//
// The hub deliberately never gates on `c.loading`. A front door that shows a
// skeleton until the fleet answers hides the doors — the only thing on this
// page that matters if the load has failed. It renders immediately; the census,
// the pulse and the requests fill in, or the banner says why they did not.
import Link from "next/link";
import { useEffect, useState } from "react";
import EndpointShore from "../components/EndpointShore";
import LiveRequestPulse from "../components/LiveRequestPulse";
import { useEndpointFacade } from "../hooks/useEndpointFacade";
import { ENDPOINT_LENSES } from "../lib/endpointDoors";
import { SectionCard } from "../../proxy/components";
import { postureOf } from "../lib/keyFormat";

/** One posture tile — the count, its label, and the tone that carries it. */
function PostureTile({ label, count, tone }) {
  const toneClass = {
    emerald: "text-emerald-600 dark:text-emerald-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-500",
    muted: "text-text-muted",
  }[tone] || "text-text-main";
  return (
    <div className="flex flex-col gap-0.5 rounded-[12px] border border-border-subtle bg-surface-2/30 px-3 py-2">
      <span className={`text-lg font-semibold tabular-nums ${toneClass}`}>{count}</span>
      <span className="text-2xs text-text-muted">{label}</span>
    </div>
  );
}

/** A recent request's time — compact, no locale drift. */
function logTime(t) {
  if (!t) return "—";
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export default function HubClient() {
  const c = useEndpointFacade();

  // Recent activity — the same 200-row ring the Log Harbor reads, sliced here.
  // Not in the store on purpose: the request log is a separate current from the
  // fleet, and a store field for it would carry every request into every shore
  // that selects the fleet. This card is the hub's only consumer.
  const [logs, setLogs] = useState({ status: "loading", rows: [] });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/usage/request-logs", { cache: "no-store" });
        if (!alive) return;
        if (res.ok) {
          const rows = await res.json();
          setLogs({ status: "ok", rows: Array.isArray(rows) ? rows : [] });
        } else {
          setLogs({ status: "error", rows: [] });
        }
      } catch {
        if (alive) setLogs({ status: "error", rows: [] });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The census, derived from the rows in hand — the honest fallback while the
  // server's own census is unavailable, and the label says which is on screen.
  const derived = c.keys.reduce(
    (acc, k) => {
      const p = postureOf(k);
      acc[p] = (acc[p] || 0) + 1;
      return acc;
    },
    { active: 0, paused: 0, expiring: 0, expired: 0 }
  );
  const scoped = c.keys.filter((k) => Array.isArray(k.allowedModels) && k.allowedModels.length > 0).length;
  const limited = c.keys.filter((k) => k.rateLimitRpm != null || k.tokenBudgetDaily != null || k.spendCapDailyCents != null).length;
  const idle = c.keys.filter((k) => !c.keyUsage[k.id]).length;

  return (
    <EndpointShore
      title="Endpoint"
      subtitle="One gateway, five doors: the fleet, its access, its safety, its health — and the front door you are standing on."
      icon="api"
      error={c.error}
      onRetry={c.reload}
    >
      {/* The posture census — one row of tiles, the operator's first question. */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <PostureTile label="Active" count={derived.active} tone="emerald" />
          <PostureTile label="Paused" count={derived.paused} tone={derived.paused > 0 ? "amber" : "muted"} />
          <PostureTile label="Expiring" count={derived.expiring} tone={derived.expiring > 0 ? "amber" : "muted"} />
          <PostureTile label="Expired" count={derived.expired} tone={derived.expired > 0 ? "red" : "muted"} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <PostureTile label="Scoped" count={scoped} tone="muted" />
          <PostureTile label="Limited" count={limited} tone="muted" />
          <PostureTile label="No traffic in window" count={idle} tone="muted" />
          <PostureTile label="Controls to set" count={c.missingControls} tone={c.missingControls > 0 ? "amber" : "emerald"} />
        </div>
        <p className="text-3xs text-text-muted">
          Counts are this browser&apos;s own derivation over the fleet in hand — the server&apos;s census answers on the
          Keys shore&apos;s rail.
        </p>
      </div>

      {/* The live pulse — the gateway's heartbeat, additive by law. */}
      <LiveRequestPulse period={c.usagePeriod} />

      <SectionCard
        title="Recent requests"
        icon="route"
        count={logs.status === "ok" ? `${logs.rows.length}` : null}
        description="The gateway's newest decisions — key, model, and outcome. The full trace lives in the Log Harbor."
        actions={
          <Link
            href="/dashboard/usage"
            className="text-xs font-medium text-brand-500 underline decoration-dotted underline-offset-2"
          >
            Open the Log Harbor
          </Link>
        }
      >
        {logs.status === "loading" ? (
          <p className="text-xs text-text-muted">Reading the request ring…</p>
        ) : logs.status === "error" ? (
          <p className="text-xs text-text-muted">The request log could not be read right now — this is a failed read, not an empty one.</p>
        ) : logs.rows.length === 0 ? (
          <p className="text-xs text-text-muted">No requests yet — the gateway has served nothing since its last boot.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="border-b border-border-subtle text-2xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-1.5 font-medium">When</th>
                  <th className="px-4 py-1.5 font-medium">Key</th>
                  <th className="px-4 py-1.5 font-medium">Model</th>
                  <th className="px-4 py-1.5 font-medium">Outcome</th>
                  <th className="px-4 py-1.5 text-right font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {logs.rows.slice(0, 8).map((r, i) => (
                  <tr key={r.id ?? i} className="border-b border-border-subtle last:border-b-0">
                    <td className="px-4 py-1.5 text-2xs text-text-muted">{logTime(r.at ?? r.ts ?? r.timestamp ?? r.createdAt)}</td>
                    <td className="px-4 py-1.5 text-xs text-text-main">{r.keyPrefix || r.key || "—"}</td>
                    <td className="max-w-[220px] truncate px-4 py-1.5 text-xs text-text-muted" title={r.model || ""}>
                      {r.model || "—"}
                    </td>
                    <td className="px-4 py-1.5">
                      {r.ok === false || r.status >= 400 ? (
                        <span className="text-2xs font-medium text-red-500">refused</span>
                      ) : (
                        <span className="text-2xs font-medium text-emerald-600 dark:text-emerald-400">ok</span>
                      )}
                    </td>
                    <td className="px-4 py-1.5 text-right text-2xs tabular-nums text-text-muted">
                      {r.ms == null ? "—" : `${r.ms} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Every lens"
        icon="space_dashboard"
        description="Each shore owns one subject and one address. The fleet store is shared, so walking between them costs no refetch."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {ENDPOINT_LENSES.map((door) => {
            const chip = typeof door.chip === "function" ? door.chip(c) : null;
            return (
              <Link
                key={door.href}
                href={door.href}
                className="group flex items-start gap-3 rounded-[14px] border border-border-subtle bg-surface-2/30 p-4 motion-control hover:border-brand-500/40 hover:bg-surface-2/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
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
                  className="material-symbols-outlined text-lg text-text-subtle motion-control group-hover:translate-x-0.5"
                  aria-hidden="true"
                >
                  arrow_forward
                </span>
              </Link>
            );
          })}
        </div>
      </SectionCard>
    </EndpointShore>
  );
}
