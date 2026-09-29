"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import usePageVisible from "./usePageVisible";

/**
 * useNavPulse — the nav rail's living chart.
 *
 * One `GET /api/nav/pulse` on mount, then one per `intervalMs`. The response is
 * a COUNTS-ONLY census (integers, one timestamp, booleans, and `providers.worst`
 * from a closed vocabulary), so the rail can glint about the fleet without ever
 * holding a name, an id or a credential — see the route's read-boundary law.
 *
 * WHY THE RAIL NEVER BLANKS. A failed refetch KEEPS the last good `pulse`: a
 * transient hiccup must not empty a rail the operator is reading, and a rail
 * that flickers to empty is more alarming than one that is briefly stale. Only
 * the very first load leaves `pulse` null, and `loading` says so. Errors are
 * caught silently into `error` — a poll failing is not an unhandled rejection
 * in someone's console.
 *
 * WHY IT PAUSES WHEN HIDDEN (house convention, `usePageVisible`). A background
 * tab should not pay for a dashboard it cannot see; the browser throttles its
 * timers anyway, so the interval buys stale data plus wasted cycles. On return
 * to visibility the effect re-runs and fires ONE immediate fetch, so the user
 * comes back to fresh numbers rather than the cache they would have had from a
 * running-but-throttled timer. `intervalMs: 0` schedules nothing at all.
 *
 * `refresh()` is exposed for an operator who wants the numbers NOW (a manual
 * re-poll); it shares the same abort controller, so a manual poll is cancelled
 * by unmount exactly like a scheduled one.
 *
 * @param {object}  [options]
 * @param {number}  [options.intervalMs=60000] poll cadence; 0 disables polling
 * @returns {{ pulse: object|null, loading: boolean, error: Error|null, refresh: () => void }}
 */
export function useNavPulse({ intervalMs = 60000 } = {}) {
  const [pulse, setPulse] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // One controller per effect run; cleanup aborts it, so a poll in flight when
  // the route changes can never resolve into a dead component.
  const abortRef = useRef(null);

  const load = useCallback(async (signal) => {
    try {
      const res = await fetch("/api/nav/pulse", { cache: "no-store", signal });
      if (!res.ok) throw new Error(`nav pulse answered ${res.status}`);
      const data = await res.json();
      setPulse(data);
      setError(null);
    } catch (err) {
      // A cancelled poll is a deliberate teardown, not a failure to report.
      if (err?.name === "AbortError") return;
      setError(err);
    } finally {
      // Runs on abort too: the first load that gets torn down still has to
      // leave `loading` false, or a remount would show a permanent spinner.
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return load(controller.signal);
  }, [load]);

  const visible = usePageVisible();
  const polling = Number.isFinite(intervalMs) && intervalMs > 0;

  // `loading` means "a read is in flight", and with polling OFF no read is ever
  // in flight — the polling effect below returns before its first `load()`, so
  // nothing would ever clear the flag and the rail would show a permanent
  // spinner for a request that was never made. Note this does NOT perform a
  // read: `intervalMs: 0` still schedules nothing at all, not even the
  // opening one, which is exactly what this hook's docblock promises.
  useEffect(() => {
    if (!polling) setLoading(false);
  }, [polling]);

  useEffect(() => {
    if (!polling || !visible) return undefined;

    const controller = new AbortController();
    abortRef.current = controller;
    load(controller.signal);

    const timer = setInterval(() => {
      // The cadence is a floor, not a promise of concurrency: skip a tick whose
      // predecessor is still in flight rather than stacking requests.
      if (controller.signal.aborted) return;
      load(controller.signal);
    }, intervalMs);

    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [load, intervalMs, polling, visible]);

  return { pulse, loading, error, refresh };
}

export default useNavPulse;
