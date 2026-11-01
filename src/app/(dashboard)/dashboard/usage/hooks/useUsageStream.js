// Usage Observatory W2-A — useUsageStream (sealed plan W2(a)).
//
// Extracted verbatim from src/shared/components/UsageStats.js: the unified
// usage-data stream. REST carries the period-filtered full stats; SSE merges
// ONLY the real-time fields (activeRequests/recentRequests/errorProvider/
// pending) and never overwrites the REST picture. The W1-D server contract
// (perProvider memo ≤30s + coalesced full-stats recompute ≥15s) rides on the
// other end of this stream.
//
// Zero behavior change: same effects, same merge semantics, same ref guards.
// The W2 cockpit's decks will consume this hook instead of the orchestrator.
//
// P5 — the dashboard coalescing mend (suspects 1 + 7), the client half:
//   • The SSE opens under the CLIENT'S period (?period=…, the same allow-list
//     the REST leg uses — src/lib/usagePeriods.js). Before this the stream had
//     no period and every subscriber scanned "all" whatever the tab showed.
//   • The connection is keyed by period: a period change closes the old
//     EventSource and opens the new one. No REST-bypass: the REST leg remains
//     the period picture's owner, exactly as sealed in W2-A.
import { useState, useEffect, useRef } from "react";
import { logger } from "@/lib/clientLogger.js";

export function useUsageStream(period) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const isInitialLoad = useRef(true);
  const hasLoadedStats = useRef(false);

  // Fetch filtered stats via REST when period changes
  useEffect(() => {
    // First load: show full spinner; subsequent: show subtle fetching indicator
    if (isInitialLoad.current) {
      isInitialLoad.current = false;
      setLoading(true);
    } else {
      setFetching(true);
    }

    fetch(`/api/usage/stats?period=${period}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          hasLoadedStats.current = true;
          setStats((prev) => ({ ...prev, ...data }));
        }
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setFetching(false);
      });
  }, [period]);

  // SSE connection - real-time updates for activeRequests + recentRequests
  // only. P5: period-keyed — re-opens under the client's own period.
  useEffect(() => {
    const es = new EventSource(`/api/usage/stream?period=${encodeURIComponent(period)}`);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        // Always merge only real-time fields, never overwrite full stats from REST
        setStats((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
            pending: data.pending,
            // W2-C: the ≤30s memoized per-provider health frame (W1-D) funds
            // the topology halos. Additive merge — old consumers (UsageStats)
            // ignore fields they don't read.
            perProvider: data.perProvider,
          };
        });
        if (hasLoadedStats.current) setLoading(false);
      } catch (err) {
        logger.error("USEUSAGESTREAM", "[SSE CLIENT] parse error:", err);
      }
    };

    es.onerror = () => setLoading(false);

    return () => es.close();
  }, [period]);

  return { stats, loading, fetching };
}

export default useUsageStream;
