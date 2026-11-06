"use client";
// The Endpoint console's provider — the store's single mount point.
//
// In the old room the "store" was a hook inside ONE page client, so a tab
// switch kept the data and a route navigation cleared it. The separation gives
// every lens its own route; a route change is a navigation, and a nested
// `layout.js` does NOT remount between sibling routes under it — only its
// `children` swap. So this provider is mounted ONCE by the endpoint layout and
// outlives every shore beneath it: walking Keys → Access → Security costs zero
// refetches, and all five shores read the same fleet, the same settings, the
// same reachability machine.
//
// Why it does nothing but wrap: the load itself belongs to the pages (each
// shore's facade calls the idempotent `load()` on mount). That keeps the
// provider from owning a `useEffect` that lint would rightly ask to justify,
// and means a test rendering a single page (without this layout) still
// bootstraps correctly.
import { useEffect } from "react";
import { useEndpointStore } from "./stores/endpointStore";

export default function EndpointProvider({ children }) {
  // A cheap belt-and-braces bootstrap: if a route under this layout renders
  // without calling the facade (a future static page, an error boundary's
  // fallback), the fleet is still warming behind it. Idempotent — a facade's
  // own load joins it.
  useEffect(() => {
    useEndpointStore.getState().load();
  }, []);

  return children;
}
