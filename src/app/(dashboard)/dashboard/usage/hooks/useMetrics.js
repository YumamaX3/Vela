// Usage Observatory W2-C — useMetrics: the fetch hook for the metrics REST
// API (sealed plan W2(c), Decision Log #4 — SQL-side aggregation).
//
// One small hook shared by every deck row: takes the compass's metricsQuery
// (period + facets + granularity, URL is the single source of truth) and a
// route name, refetches when the query string changes, and hands back
// { data, loading, error, refetch }.
//
// Fail-open, with one honest exception (v1.0.30 "The Beacon Shore"): a failed
// REFETCH leaves the prior data in place — the instrument degrades, it does
// not break. But a failed INITIAL load has no prior data to fall back on, and
// swallowing that left the visitor staring at skeletons forever. The hook
// records `error` (the HTTP status line or the thrown message) whenever a
// failure lands with nothing yet loaded, and `refetch()` retries in place.
//
// SHAPE (React 19 lint-clean, mirroring useUsageStream): every setState sits
// inside a promise callback, never in the effect body; `loading` is DERIVED
// from state (no data and no error yet); stale runs are discarded by runId so
// a query change that overtakes an in-flight response never lets the old
// answer land.
"use client";
import { useState, useEffect, useRef, useCallback } from "react";

// One shared runner for both the effect's initial load and `refetch` — same
// contract: land only the newest run, speak only when nothing has loaded.
function fetchMetrics({ url, runId, runIdRef, hasLoaded, setData, setError }) {
  fetch(url)
    .then(async (r) => ({ d: r.ok ? await r.json() : null, status: r.status }))
    .then(({ d, status }) => {
      if (runIdRef.current !== runId) return; // a newer query superseded this run
      if (d) {
        hasLoaded.current = true;
        setData(d);
        setError(null);
      } else if (!hasLoaded.current) {
        // Non-OK with no prior data: the room would otherwise show skeletons
        // forever. Name the status so the operator knows the harbor refused.
        setError(`HTTP ${status}`);
      }
    })
    .catch((e) => {
      if (runIdRef.current !== runId) return;
      // A failed refetch keeps its prior data (fail-open) — silent there is
      // honest, because something useful is still on the instrument. A failed
      // initial load speaks, because nothing else is on it.
      if (!hasLoaded.current) {
        setError(e?.message || "The request never reached the harbor.");
      }
    });
}

/** @param {string} route — one of "kpis" | "stacked" | "breakdown" | ...
 *  @param {string} metricsQuery — compass.metricsQuery (period + facets).
 *  @param {string} [extra] — route-specific params appended after a "&". */
export function useMetrics(route, metricsQuery, extra = "") {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // hasLoaded: has ANY answer ever landed? Read inside promise callbacks only
  // — never during render — so a failed refetch can keep its prior data
  // (fail-open) while a failed initial load speaks.
  const hasLoaded = useRef(false);
  const runIdRef = useRef(0);
  const urlRef = useRef(null);

  useEffect(() => {
    const runId = ++runIdRef.current;
    const url = `/api/usage/metrics/${route}?${metricsQuery}${extra ? `&${extra}` : ""}`;
    urlRef.current = url;
    fetchMetrics({ url, runId, runIdRef, hasLoaded, setData, setError });
  }, [route, metricsQuery, extra]);

  const refetch = useCallback(() => {
    if (urlRef.current == null) return;
    const runId = ++runIdRef.current;
    fetchMetrics({ url: urlRef.current, runId, runIdRef, hasLoaded, setData, setError });
  }, []);

  const loading = data === null && error === null;
  return { data, loading, error, refetch };
}
export default useMetrics;
