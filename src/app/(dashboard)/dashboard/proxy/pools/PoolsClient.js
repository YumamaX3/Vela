"use client";
// PoolsClient — the Fleet lens as its own page (sealed plan §3.1 · `/proxy/pools`).
//
// This is what used to be the console's `?tab=fleet`. The lens component (FleetTab)
// already read and mutated through the shared facade `c`, so the separation did not
// touch it: this file binds the facade to the lens and gives the room its masthead.
// The subject — pool CRUD, the one-request bulk sweep, batch import — is unchanged,
// which is why the three-verdict honesty it proved in the console is still proved
// here, on the page a navigator can now reach by URL.
//
// `c.loading` is handed to the frame so the skeleton lands BEFORE the subject mounts:
// mounting FleetTab against zero pools would flash "no pools" between the first paint
// and the first fetch, and an empty fleet is a true statement that must never appear
// while the fleet has not been read.
import { useProxyFleet } from "../hooks/useProxyFleet";
import { FleetTab, ProxyShore } from "../components";

export default function PoolsClient() {
  const c = useProxyFleet();

  return (
    <ProxyShore
      title="Pools"
      subtitle="The fleet itself: create, edit, test, toggle, delete, import — and one sweep that asks the engine, not the browser."
      icon="lan"
      error={c.error}
      onRetry={c.reload}
      loading={c.loading}
    >
      <FleetTab c={c} />
    </ProxyShore>
  );
}
