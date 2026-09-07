// Usage Observatory W2-A — RecentRequests (sealed plan W2(a)).
//
// Extracted verbatim from src/shared/components/UsageStats.js: the live
// feed rail beside the provider topology. Shows the most recent completed
// requests with a per-row ticking "time ago" cell. Zero behavior change —
// same markup, same classes, same TimeAgo cadence. (The W2-C pause-on-hover
// lives in the deck's LiveRow — it freezes which array this rail renders,
// so this component stays exactly as extracted.)
"use client";

import { useState, useEffect } from "react";
import Card from "@/shared/components/Card";
import { usePageVisible } from "@/shared/hooks/usePageVisible";
import { fmt } from "./UsageTable";

function timeAgo(timestamp) {
  const diff = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Auto-update time display (perf audit V5). WAS: one setInterval(1000) PER
// ROW — 20 rows meant 20 re-renders/second in this rail alone, forever,
// even though the displayed string rarely changes (it only moves when a
// boundary crosses: s→m→h→d). NOW: ONE module-level ticker process-wide;
// each row subscribes to it and re-renders only when ITS OWN label changes
// (per-second only while the row is under a minute old, then the label is
// stable and React's Object.is bail-out skips the render entirely).
function timeAgoLabel(timestamp, now) {
  const diff = Math.floor((now - new Date(timestamp)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const tickSubscribers = new Set();
let tickTimer = null;

function subscribeTicker(fn) {
  tickSubscribers.add(fn);
  // The ticker lives only while at least one TimeAgo is mounted; with no
  // subscribers there is nothing to update, so the interval clears itself.
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      const now = Date.now();
      tickSubscribers.forEach((fn) => fn(now));
    }, 1000);
  }
  return () => {
    tickSubscribers.delete(fn);
    if (tickSubscribers.size === 0) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

function TimeAgo({ timestamp }) {
  const visible = usePageVisible();
  const [label, setLabel] = useState(() => timeAgoLabel(timestamp, Date.now()));

  useEffect(() => {
    // Sync immediately when the row's timestamp changes (new request lands).
    setLabel(timeAgoLabel(timestamp, Date.now()));
    // Hidden tab: labels frozen (they will resync on the timestamp change or
    // the next visible tick — perf audit V6).
    if (!visible) return undefined;
    return subscribeTicker((now) => {
      setLabel((prev) => {
        const next = timeAgoLabel(timestamp, now);
        return next === prev ? prev : next; // Object.is bail-out — no render when unchanged
      });
    });
  }, [timestamp, visible]);

  return <>{label}</>;
}

export default function RecentRequests({ requests = [] }) {
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden" padding="sm" style={{ height: 480 }}>
      {/* Header */}
      <div className="px-1 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Recent Requests</span>
      </div>

      {!requests.length ? (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">No requests yet.</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full min-w-[300px] border-collapse text-xs">
            <thead className="sticky top-0 bg-bg z-10">
              <tr className="border-b border-border">
                <th className="py-1.5 text-left font-semibold text-text-muted w-2"></th>
                <th className="py-1.5 text-left font-semibold text-text-muted">Model</th>
                <th className="py-1.5 text-right font-semibold text-text-muted whitespace-nowrap">In / Out</th>
                <th className="py-1.5 text-right font-semibold text-text-muted">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {requests.map((r, i) => {
                const ok = !r.status || r.status === "ok" || r.status === "success";
                return (
                  <tr key={i} className="hover:bg-bg-subtle transition-colors">
                    <td className="py-1.5">
                      <span className={`block w-1.5 h-1.5 rounded-full ${ok ? "bg-success" : "bg-error"}`} />
                    </td>
                    <td className="py-1.5 font-mono truncate max-w-[120px]" title={r.model}>{r.model}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <span className="text-primary">{fmt(r.promptTokens)}↑</span>
                      {" "}
                      <span className="text-success">{fmt(r.completionTokens)}↓</span>
                    </td>
                    <td className="py-1.5 text-right text-text-muted whitespace-nowrap"><TimeAgo timestamp={r.timestamp} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
