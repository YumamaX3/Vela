"use client";

/**
 * ModelAvailabilityBadge — compact inline status indicator
 *
 * Shows green when all models are operational, or amber/red when there are
 * issues, with a popover for details and cooldown clearing. The last good
 * snapshot is kept when a refresh fails: a stale answer is more honest than
 * an empty one, and the popover says when it is stale.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const STATUS_CONFIG = {
  available: { icon: "check_circle", color: "var(--color-success)", label: "Available" },
  cooldown: { icon: "schedule", color: "var(--color-warning)", label: "Cooldown" },
  unavailable: { icon: "error", color: "var(--color-danger)", label: "Unavailable" },
  unknown: { icon: "help", color: "var(--color-text-subtle)", label: "Unknown" },
};

export default function ModelAvailabilityBadge() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clearing, setClearing] = useState(null);
  const ref = useRef(null);
  const notify = useNotificationStore();

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/models/availability");
      if (!res.ok) throw new Error("availability unavailable");
      const json = await res.json();
      setData(json);
      setStale(false);
    } catch {
      // Keep the last good snapshot; the popover names it as stale.
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer the first fetch one tick so the effect body does not setState
    // synchronously (react-hooks/set-state-in-effect). The interval keeps
    // the 30 s cadence.
    const kickoff = setTimeout(fetchStatus, 0);
    const interval = setInterval(fetchStatus, 30000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [fetchStatus]);

  // Close popover on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setExpanded(false);
    };
    if (expanded) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [expanded]);

  const handleClearCooldown = async (provider, model) => {
    setClearing(`${provider}:${model}`);
    try {
      const res = await fetch("/api/models/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clearCooldown", provider, model }),
      });
      if (res.ok) {
        notify.success(`Cooldown cleared for ${model}`);
        await fetchStatus();
      } else {
        notify.error("Failed to clear cooldown");
      }
    } catch {
      notify.error("Failed to clear cooldown");
    } finally {
      setClearing(null);
    }
  };

  if (loading) return null;

  const models = data?.models || [];
  const hasData = data != null;
  const unavailableCount = hasData
    ? data.unavailableCount ?? models.filter((m) => m.status !== "available").length
    : 0;
  const isHealthy = hasData && unavailableCount === 0;
  const label = !hasData
    ? "Model status unavailable"
    : isHealthy
      ? "All models operational"
      : `${unavailableCount} model${unavailableCount !== 1 ? "s" : ""} with issues`;

  // Group unhealthy models by provider
  const byProvider = {};
  models.forEach((m) => {
    if (m.status === "available") return;
    const key = m.provider || "unknown";
    if (!byProvider[key]) byProvider[key] = [];
    byProvider[key].push(m);
  });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-haspopup="dialog"
        aria-label={`${label}. Open model status.`}
        className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[10px] border px-3 text-xs font-medium motion-control focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${
          // 700/300 hue pairs, not the 500 weights: as TEXT on the light shore
          // the 500s measure ~2.4:1 at 12px — the same AA failure the ledger
          // records in logs/RequestLedger.js:51-57. The tint and hairline keep
          // the hue; only the words darken enough to be read.
          isHealthy
            ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
            : hasData
              ? "border-amber-500/25 bg-amber-500/10 text-amber-700 hover:bg-amber-500/15 dark:text-amber-300"
              : "border-border bg-surface text-text-muted hover:text-text-main"
        }`}
      >
        <span className="material-symbols-outlined text-sm" aria-hidden="true">
          {isHealthy ? "verified" : hasData ? "warning" : "help"}
        </span>
        <span className="hidden sm:inline">{label}</span>
        {stale && hasData && (
          <span className="text-3xs font-normal text-text-subtle" title="Last refresh failed">
            stale
          </span>
        )}
      </button>
      <span className="sr-only" aria-live="polite">{label}</span>

      {expanded && (
        <div
          role="dialog"
          aria-label="Model status"
          className="absolute top-full right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border bg-bg px-4 py-3">
            <div className="flex items-center gap-2">
              <span
                className="material-symbols-outlined text-base"
                style={{ color: isHealthy ? "var(--color-success)" : "var(--color-warning)" }}
                aria-hidden="true"
              >
                {isHealthy ? "verified" : "warning"}
              </span>
              <span className="text-sm font-semibold text-text-main">Model Status</span>
            </div>
            <button
              type="button"
              onClick={fetchStatus}
              aria-label="Refresh model status"
              className="cursor-pointer rounded-lg p-1 text-text-muted motion-control hover:bg-surface hover:text-text-main focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true">refresh</span>
            </button>
          </div>

          <div className="max-h-60 overflow-y-auto px-4 py-3">
            {!hasData ? (
              <p className="py-2 text-center text-sm text-text-muted">
                Status has not arrived yet. Refresh, or check the gateway.
              </p>
            ) : isHealthy ? (
              <p className="py-2 text-center text-sm text-text-muted">
                All models are responding normally.
                {stale ? " This is the last good snapshot." : ""}
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {Object.entries(byProvider).map(([provider, provModels]) => (
                  <div key={provider}>
                    <p className="mb-1.5 text-xs font-semibold capitalize text-text-main">{provider}</p>
                    <div className="flex flex-col gap-1">
                      {provModels.map((m) => {
                        const status = STATUS_CONFIG[m.status] || STATUS_CONFIG.unknown;
                        const isClearing = clearing === `${m.provider}:${m.model}`;
                        return (
                          <div
                            key={`${m.provider}-${m.model}`}
                            className="flex items-center justify-between rounded-lg bg-surface/30 px-2.5 py-1.5"
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span
                                className="material-symbols-outlined shrink-0 text-sm"
                                style={{ color: status.color }}
                                aria-hidden="true"
                              >
                                {status.icon}
                              </span>
                              <span className="truncate font-mono text-xs text-text-main">{m.model}</span>
                            </div>
                            {m.status === "cooldown" && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleClearCooldown(m.provider, m.model)}
                                disabled={isClearing}
                                className="ml-2 px-1.5! py-0.5! text-3xs"
                              >
                                {isClearing ? "..." : "Clear"}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
