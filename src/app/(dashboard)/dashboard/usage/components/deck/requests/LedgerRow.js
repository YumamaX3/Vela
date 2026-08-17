// Usage Observatory W2-E — one ledger row (sealed plan Deck-3).
// Memoized so a full-page SSE refetch re-renders only what changed; keyboard
// first-class: every row is focusable, Enter/Space opens the drawer (the
// table wrapper handles ↑/↓ traversal). The pill colors ride the shared
// status palette (one copy with the Overview donut).
"use client";

import { memo } from "react";
import { STATUS_COLORS, statusClassLabel } from "../../../lib/statusColors";
import { fmtTokens, fmtRowCost, fmtMs, fmtTime } from "../../../lib/ledgerFmt";

function LedgerRow({ row, active, onOpen }) {
  const color = STATUS_COLORS[row.statusClass] || "#64748b";
  // W4-C — operator tags ride the row (escape-safe by React + charset
  // allow-list). Show at most two chips; the overflow speaks as +N.
  const tags = row.tags || [];
  const shown = tags.slice(0, 2);
  return (
    <tr
      data-ledger-row
      data-row-id={row.id}
      tabIndex={0}
      aria-selected={active}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(row);
        }
      }}
      className={`cursor-pointer border-b border-border transition-colors outline-none last:border-b-0 hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-primary/50 ${active ? "bg-bg-subtle" : ""}`}
    >
      <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-text-muted" data-i18n-skip="true">{fmtTime(row.timestamp)}</td>
      <td className="max-w-[130px] truncate px-3 py-2 text-xs font-medium text-text" title={row.providerDisplayName || row.provider}>{row.providerDisplayName || row.provider || "—"}</td>
      <td className="max-w-[220px] px-3 py-2">
        <div className="flex min-w-0 items-center gap-1">
          <span className="truncate font-mono text-xs text-text" title={row.model}>{row.model || "—"}</span>
          {shown.length > 0 && (
            <span className="flex shrink-0 items-center gap-1" data-i18n-skip="true">
              {shown.map((name) => (
                <span
                  key={name}
                  className="max-w-[72px] truncate rounded border border-primary/30 bg-primary/10 px-1 py-px text-[9px] font-medium text-text-muted"
                  title={name}
                >
                  {name}
                </span>
              ))}
              {tags.length > shown.length && (
                <span className="text-[9px] font-medium text-text-muted" title={tags.join(", ")}>+{tags.length - shown.length}</span>
              )}
            </span>
          )}
        </div>
      </td>
      <td className="max-w-[120px] truncate px-3 py-2 text-xs text-text-muted" title={row.keyName || row.keyPrefix || undefined}>{row.keyName || row.keyPrefix || "—"}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums text-text" data-i18n-skip="true">{fmtTokens(row.promptTokens)}</td>
      <td className="px-3 py-2 text-right text-xs tabular-nums text-text" data-i18n-skip="true">{fmtTokens(row.completionTokens)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-text" data-i18n-skip="true">~{fmtRowCost(row.cost)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-text-muted" data-i18n-skip="true">{fmtMs(row.latencyMs)}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{ color, backgroundColor: `${color}1a`, border: `1px solid ${color}40` }}
        >
          {statusClassLabel(row.statusClass)}
        </span>
      </td>
    </tr>
  );
}

export default memo(LedgerRow);
