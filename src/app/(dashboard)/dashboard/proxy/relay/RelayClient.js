"use client";
// RelayClient — the Relay lens as its own page (§3.1 · `/proxy/relay`).
//
// What used to be `?tab=relay`: the three edge platforms as first-class rows, each
// showing every relay pool of its type, plus the per-platform deploy form. `c.relays`
// is the facade's own filter (`isRelayPool` over the pools), so this page does not
// re-derive what counts as a relay.
import { useProxyFleet } from "../hooks/useProxyFleet";
import { ProxyShore, RelayTab } from "../components";

export default function RelayClient() {
  const c = useProxyFleet();

  return (
    <ProxyShore
      title="Relay"
      subtitle="Vercel, Cloudflare and Deno edge relays — each deployed pool as a row, each platform as a form."
      icon="cloud_upload"
      actions={
        <span className="text-xs text-text-muted">
          <span className="tabular-nums text-text-main">{c.relays.length}</span> relay{" "}
          {c.relays.length === 1 ? "pool" : "pools"}
        </span>
      }
      error={c.error}
      onRetry={c.reload}
      loading={c.loading}
    >
      <RelayTab c={c} />
    </ProxyShore>
  );
}
