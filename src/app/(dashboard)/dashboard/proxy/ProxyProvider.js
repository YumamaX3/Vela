"use client";
// The Proxy console's provider — the store's single mount point.
//
// In the old console the "store" was a hook inside ONE page, so a lens switch kept
// the data and a route navigation cleared it. The separation gives every lens its own
// route; a route change is a navigation, and a nested `layout.js` does NOT remount
// between sibling routes under it — only its `children` swap. So this provider is
// mounted ONCE by the proxy layout and outlives every lighthouse page beneath it:
// walking pools → fitness → egress costs zero refetches, and all eight shores read
// the same pools, the same records, the same census arithmetic.
//
// Why it does nothing but wrap: the load itself belongs to the pages (each lens's
// `useProxyFleet` calls the idempotent `load()` on mount). That keeps the provider
// from owning a `useEffect` that lint would rightly ask to justify, and means a
// test rendering a single page (without this layout) still bootstraps correctly.
import { useEffect } from "react";
import { useProxyFleetStore } from "./stores/proxyFleetStore";

export default function ProxyProvider({ children }) {
  // A cheap belt-and-braces bootstrap: if a route under this layout renders without
  // calling the facade (a future static page, an error boundary's fallback), the
  // fleet is still warming behind it. Idempotent — a facade's own load joins it.
  useEffect(() => {
    useProxyFleetStore.getState().load();
  }, []);

  return children;
}
