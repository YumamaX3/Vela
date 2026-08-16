// Usage Observatory W2-C — useMetrics: the fetch hook for the metrics REST
// API (sealed plan W2(c), Decision Log #4 — SQL-side aggregation).
//
// One small hook shared by every deck row: takes the compass's metricsQuery
// (period + facets + granularity, URL is the single source of truth) and a
// route name, refetches when the query string changes, and hands back
// { data, loading, fetching } with the same initial-load-vs-refetch
// distinction useUsageStream uses. Never throws — a failed fetch leaves the
// prior data in place (fail-open, the instrument degrades, it does not break).
"use client";

import { useState, useEffect, useRef } from "react";

/** @param {string} route — one of "kpis" | "stacked" | "breakdown" | ...
 *  @param {string} metricsQuery — compass.metricsQuery (period + facets).
 *  @param {string} [extra] — route-specific params appended after a "&". */
export function useMetrics(route, metricsQuery, extra = "") {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const isInitial = useRef(true);
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (isInitial.current) { isInitial.current = false; setLoading(true); }
    else setFetching(true);

    let alive = true;
    const url = `/api/usage/metrics/${route}?${metricsQuery}${extra ? `&${extra}` : ""}`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) {
          hasLoaded.current = true;
          setData(d);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) { setLoading(false); setFetching(false); }
      });
    return () => { alive = false; };
  }, [route, metricsQuery, extra]);

  return { data, loading, fetching };
}

export default useMetrics;
