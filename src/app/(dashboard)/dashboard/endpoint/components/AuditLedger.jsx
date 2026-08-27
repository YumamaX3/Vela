"use client";

import { Card } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { formatTime } from "../lib/keyFormat";

const SURFACE_ICONS = {
  create: "add_circle",
  rotate: "autorenew",
  duplicate: "content_paste",
  revive: "restart_alt",
  revoke: "block",
  "import-mint": "download",
  "template-apply": "auto_awesome",
};

/**
 * AuditLedger — the fleet-wide mutation ledger (W3a audit tab). The
 * append-only key_mutation_ledger surface, newest first. Presentational —
 * the orchestrator supplies the rows from useKeys.fleetLedger.
 */
export default function AuditLedger({ ledger, loading, onSelectKey }) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">receipt_long</span>
          {translate("Mutation Ledger")}
        </h2>
        {ledger.length > 0 && (
          <span className="text-xs text-text-muted">{ledger.length} {translate("events")}</span>
        )}
      </div>

      {loading ? (
        <div className="text-center py-10 text-text-muted">
          <span className="material-symbols-outlined animate-spin text-[24px] inline-block">progress_activity</span>
        </div>
      ) : ledger.length === 0 ? (
        <div className="text-center py-10">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 text-primary mb-3">
            <span className="material-symbols-outlined text-[28px]">receipt_long</span>
          </div>
          <p className="text-text-main font-medium mb-1">{translate("No key mutations yet")}</p>
          <p className="text-sm text-text-muted">{translate("Mint or rotate a key and its provenance will appear here")}</p>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="grid grid-cols-[auto_1fr_1fr_auto] gap-3 px-3 pb-2 border-b border-border-subtle text-[10px] uppercase tracking-wide text-text-muted">
            <span>{translate("Action")}</span>
            <span>{translate("Outcome")}</span>
            <span>{translate("Actor")}</span>
            <span className="text-right">{translate("When")}</span>
          </div>
          {ledger.map((r) => {
            const time = formatTime(r.createdAt);
            return (
              <button
                key={r.id}
                onClick={() => r.keyId && onSelectKey?.(r.keyId)}
                disabled={!r.keyId}
                className="grid grid-cols-[auto_1fr_1fr_auto] gap-3 items-center px-3 py-2 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 text-xs hover:bg-surface-2 transition-colors disabled:hover:bg-transparent disabled:cursor-default"
              >
                <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                  {SURFACE_ICONS[r.surface] || "swap_calls"}
                </span>
                <span className="text-text-main font-medium truncate">{r.surface}</span>
                <span className="text-text-muted truncate">
                  {r.outcome || "—"} · <span className="font-mono">{r.actorClass || "dashboard"}</span>
                </span>
                <span className="text-right text-text-muted whitespace-nowrap" title={time?.absolute}>
                  {time?.relative || r.createdAt || "—"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
