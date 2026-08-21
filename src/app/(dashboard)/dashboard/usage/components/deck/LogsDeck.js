// Usage Observatory W3 — Logs Deck (new bearing).
// Shows per-request logs with model/tokens/latency/status/cost/time.
// Fetches /api/usage/request-logs, 30s auto-refresh paused when document hidden.
"use client";

import { useEffect, useState, useCallback } from "react";
import Card from "@/shared/components/Card";
import { t } from "../../lib/t";

export default function LogsDeck({ compass }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const fetchLogs = useCallback(async () => {
    try {
      const qs = `${compass.metricsQuery}&limit=50`;
      const res = await fetch(`/api/usage/request-logs?${qs}`);
      if (res.ok) {
        const d = await res.json();
        setData(d?.logs || []);
        setLastUpdated(new Date());
      }
    } catch {
      // fail-open
    } finally {
      setLoading(false);
    }
  }, [compass.metricsQuery]);

  useEffect(() => {
    let alive = true;
    fetchLogs().then(() => { if (!alive) return; });
    return () => { alive = false; };
  }, [fetchLogs]);

  // Auto-refresh every 30s, paused when document hidden
  useEffect(() => {
    if (document.hidden) return;

    const interval = setInterval(() => {
      fetchLogs();
    }, 30000);

    return () => clearInterval(interval);
  }, [fetchLogs]);

  // Pause/resume on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchLogs();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [fetchLogs]);

  const fmtCost = (n) => {
    if (!n || n <= 0) return "$0.00";
    if (n < 0.01) return "<$0.01";
    return `$${n.toFixed(2)}`;
  };

  const fmtTokens = (n) => {
    if (!n) return "0";
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return `${Math.round(n)}`;
  };

  const fmtLatency = (ms) => {
    if (!ms) return "-";
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.round(ms)}ms`;
  };

  const fmtTime = (ts) => {
    if (!ts) return "-";
    return new Date(ts).toLocaleTimeString();
  };

  const getStatusClass = (status) => {
    if (status === 200) return "bg-success/10 text-success border-success/20";
    if (status >= 400) return "bg-error/10 text-error border-error/20";
    return "bg-bg-subtle text-text-muted border-border";
  };

  return (
    <Card padding="none">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-text">{t("Request logs")}</span>
          <span className="text-[11px] text-text-muted">{t("Last updated")} {lastUpdated ? lastUpdated.toLocaleTimeString() : "-"}</span>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-main transition-colors hover:bg-bg-hover disabled:opacity-50"
        >
          <span className={`material-symbols-outlined text-[16px] ${loading ? "animate-spin" : ""}`}>refresh</span>
          {t("Refresh")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] border-collapse">
          <thead>
            <tr className="border-b border-border bg-bg-subtle/50">
              {["time", "model", "tokens", "latency", "status", "cost"].map((header) => (
                <th key={header} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {t(header.charAt(0).toUpperCase() + header.slice(1))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-3 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-bg-subtle" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data && data.length > 0 ? (
              data.map((row, idx) => (
                <tr key={idx} className="border-b border-border last:border-b-0 hover:bg-bg-hover/50">
                  <td className="whitespace-nowrap px-3 py-3 text-sm text-text-muted" data-i18n-skip="true">
                    {fmtTime(row.timestamp)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm font-medium text-text-main" data-i18n-skip="true">
                    {row.model || "-"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm text-text-main tabular-nums" data-i18n-skip="true">
                    {fmtTokens(row.tokens)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm text-text-main tabular-nums" data-i18n-skip="true">
                    {fmtLatency(row.latencyMs)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium border ${getStatusClass(row.status)}`} data-i18n-skip="true">
                      {row.status || "-"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-sm font-medium text-text-main tabular-nums" data-i18n-skip="true">
                    {fmtCost(row.cost || 0)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-text-muted">
                  {t("No request logs yet — send a request to see them here.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
