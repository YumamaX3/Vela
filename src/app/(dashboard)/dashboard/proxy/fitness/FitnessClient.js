"use client";
// FitnessClient — the Fitness lens as its own page (§3.1 · `/proxy/fitness`).
//
// What used to be `?tab=fitness`: the block ledger, clear-one, clear-all, and the
// fleet-wide geo-probe toggle. The lens reads `c.records` and `c.poolById` through the
// facade and does its own filtering; nothing here filters on its behalf.
//
// The loading gate is the frame's, for the same reason as the Pools page: the ledger's
// honest empty state is "no active blocks", and that must not be printed while the
// records have not been read yet.
//
// WHY THE CENSUS STRIP IS HERE AND NOT REPEATED ON ALL FOUR: the console put it above
// every lens because every lens shared one screen. Separated, it belongs where its
// numbers are the subject — "blocked pairs" is this page's punchline, and "proven dead
// vs indeterminate" is the honesty this page's ledger depends on. Pools carries the
// same three verdicts in its own header badges; Egress reads `c.geo`; the hub carries
// the strip for anyone who wants the whole picture before choosing a door.
import { useProxyFleet } from "../hooks/useProxyFleet";
import { FitnessTab, ProxyCensus, ProxyShore } from "../components";

export default function FitnessClient() {
  const c = useProxyFleet();

  return (
    <ProxyShore
      title="Fitness"
      subtitle="Which provider is blocked on which proxy egress, why, and until when — with the geo probe that feeds it."
      icon="monitor_heart"
      actions={
        c.census.blocked > 0 ? (
          <span className="text-xs text-text-muted">
            <span className="tabular-nums text-text-main">{c.census.blocked}</span> blocked{" "}
            {c.census.blocked === 1 ? "pair" : "pairs"}
          </span>
        ) : null
      }
      error={c.error}
      onRetry={c.reload}
      loading={c.loading}
    >
      <ProxyCensus census={c.census} />
      <FitnessTab c={c} />
    </ProxyShore>
  );
}
