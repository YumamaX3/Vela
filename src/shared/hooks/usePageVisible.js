"use client";

// usePageVisible — perf audit V6 (2026-09-07).
//
// A background tab should not pay for a dashboard it cannot see. Every
// polling surface (health pings, countdowns, topology ticks) keeps its
// interval alive when the tab is hidden, burning CPU and network against
// a browser that throttles timers to 1/min anyway — the worst of both:
// stale data the moment the user returns, and wasted cycles before it.
//
// This hook exposes the page's visibility as state. A poll site gates its
// fetch with it:
//
//   const visible = usePageVisible();
//   useEffect(() => {
//     if (!visible) return undefined;   // pause when hidden
//     ...fetch + setInterval...
//     return cleanup;
//   }, [visible]);
//
// On return to visibility the effect re-runs, firing one immediate fetch
// — so the user comes back to FRESH data instead of the stale interval
// cache they would have had with a running-but-throttled timer.
//
// Uses document.visibilityState (not just the event) so the initial value
// is correct on mount rather than waiting for the first visibilitychange.

import { useSyncExternalStore } from "react";

function subscribe(callback) {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

function getSnapshot() {
  return document.visibilityState === "visible";
}

// Server snapshot: SSR never knows real visibility; assume visible so the
// hydration pass doesn't render a different tree than the client's first
// pass (a false `hidden` would suppress initial fetches that then never
// re-run until the next visibility change).
function getServerSnapshot() {
  return true;
}

export function usePageVisible() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export default usePageVisible;
