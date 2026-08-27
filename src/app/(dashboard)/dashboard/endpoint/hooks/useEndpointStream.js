"use client";

import { useState, useEffect, useRef } from "react";

/**
 * useEndpointStream — the endpoint page's live stream (W3b, sealed plan W3(b)).
 *
 * Consumes /api/usage/stream (the W1-D SSE contract) and merges ONLY the
 * real-time fields over the REST picture:
 *   • REST supplies the period-filtered full stats (KPI band: totalRequests,
 *     tokens, cost).
 *   • SSE supplies the live deltas — activeRequests, recentRequests,
 *     errorProvider, and the memoized perProvider frame — merged in place,
 *     NEVER overwriting the full stats.
 *
 * Merge semantics are identical to useUsageStream: a null REST base is left
 * untouched (the stream can't invent a full stats picture), and the SSE
 * connection dies silently on error (fail-open, reconnect handled by
 * EventSource natively).
 *
 * @param {object} opts { enabled } — gate the connection (e.g. only on the
 *   overview tab). Defaults to always-on.
 */
export function useEndpointStream({ enabled = true } = {}) {
  const [live, setLive] = useState(null); // merged { ...stats, activeRequests, recentRequests, perProvider }
  const [loading, setLoading] = useState(true);
  const baseRef = useRef(null);

  // REST base — the period-filtered full stats (24h window).
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/usage/stats?period=24h", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) baseRef.current = data;
        setLive((prev) => (data ? { ...(prev || {}), ...data } : prev));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled]);

  // SSE — merge the live fields only; never clobber the REST base.
  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource("/api/usage/stream");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setLive((prev) => {
          if (!prev) return prev; // no REST base yet — nothing to merge onto
          return {
            ...prev,
            activeRequests: data.activeRequests,
            recentRequests: data.recentRequests,
            errorProvider: data.errorProvider,
            perProvider: data.perProvider || prev.perProvider,
          };
        });
      } catch {
        /* malformed frame — ignore */
      }
    };
    return () => es.close();
  }, [enabled]);

  return { live, loading };
}
