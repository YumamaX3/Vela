"use client";

import { translate } from "@/i18n/runtime";
import { formatTime } from "../lib/keyFormat";

// Icon per ledger surface — the timeline's visual language.
const SURFACE_ICONS = {
  minted: "add_circle",
  created: "add_circle",
  rotated: "autorenew",
  revoked: "block",
  deleted: "block",
  paused: "pause_circle",
  resumed: "play_circle",
  expired: "event_busy",
  renewed: "restart_alt",
  tested: "science",
  imported: "upload_file",
  edited: "edit",
  tag_added: "sell",
  tag_removed: "sell",
};
const SURFACE_TONES = {
  minted: "text-green-500",
  created: "text-green-500",
  rotated: "text-amber-500",
  revoked: "text-red-500",
  deleted: "text-red-500",
  paused: "text-amber-500",
  resumed: "text-green-500",
  expired: "text-red-500",
  renewed: "text-sky-500",
  tested: "text-violet-500",
  imported: "text-primary",
  edited: "text-text-muted",
};

const FALLBACK_ICON = "more_horiz";

/**
 * The key's lifecycle timeline — the mutation ledger rendered as a vertical
 * rail of nodes (surface → icon + tone), each with outcome, actor, and a
 * relative time. Pure presentational; the ledger rows come from props.
 */
export default function LifecycleTimeline({ ledger = [], loading = false }) {
  if (loading) {
    return (
      <div className="py-6 text-center text-text-muted">
        <span className="material-symbols-outlined animate-spin text-[20px] inline-block">progress_activity</span>
      </div>
    );
  }
  if (ledger.length === 0) {
    return <p className="text-xs text-text-muted py-2">{translate("No lifecycle events recorded yet")}</p>;
  }

  return (
    <div className="flex flex-col">
      {ledger.map((r, i) => {
        const surface = r.surface || "unknown";
        const time = formatTime(r.createdAt);
        const isLast = i === ledger.length - 1;
        return (
          <div key={r.id || i} className="flex gap-2.5">
            {/* Node rail */}
            <div className="flex flex-col items-center">
              <span className={`material-symbols-outlined text-[16px] ${SURFACE_TONES[surface] || "text-text-muted"} shrink-0`}>
                {SURFACE_ICONS[surface] || FALLBACK_ICON}
              </span>
              {!isLast && <span className="w-px flex-1 bg-border-subtle my-0.5" />}
            </div>
            {/* Body */}
            <div className={`flex-1 min-w-0 pb-3 ${isLast ? "" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-text-main capitalize">{surface.replace(/_/g, " ")}</span>
                {time && <span className="text-[10px] text-text-muted shrink-0" title={time.absolute}>{time.relative}</span>}
              </div>
              {(r.outcome || r.actorClass) && (
                <p className="text-[11px] text-text-muted truncate">
                  {r.outcome}
                  {r.actorClass ? ` · ${r.actorClass}` : ""}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
