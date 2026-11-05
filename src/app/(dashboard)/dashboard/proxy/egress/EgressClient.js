"use client";
// EgressClient — the Egress lens as its own page (§3.1 · `/proxy/egress`).
//
// What used to be `?tab=egress`: one row per pool with its current egress IP, country,
// how many distinct IPs have been seen (the flapping signal) and the prior-IP history,
// plus a per-row Probe. The lens reads the poolGeo registry through `c.geo`; this file
// only binds it to the room.
import { useProxyFleet } from "../hooks/useProxyFleet";
import { EgressTab, ProxyShore } from "../components";

export default function EgressClient() {
  const c = useProxyFleet();
  const observed = Object.keys(c.geo).length;

  return (
    <ProxyShore
      title="Egress"
      subtitle="The address each pool actually leaves from — IP, country, whether it flaps, and where it has been."
      icon="travel_explore"
      actions={
        c.pools.length > 0 ? (
          <span className="text-xs text-text-muted">
            <span className="tabular-nums text-text-main">{observed}</span> of{" "}
            <span className="tabular-nums text-text-main">{c.pools.length}</span> observed
          </span>
        ) : null
      }
      error={c.error}
      onRetry={c.reload}
      loading={c.loading}
    >
      <EgressTab c={c} />
    </ProxyShore>
  );
}
