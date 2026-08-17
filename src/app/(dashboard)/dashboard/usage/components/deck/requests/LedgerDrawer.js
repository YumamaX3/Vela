// Usage Observatory W2-E — the row drawer (sealed plan Deck-3).
// The deep-dive on one request: every telemetry column the engine returns,
// plus the honesty note that conversation payloads stay redacted here. The
// ledger row is the enriched metadata shape (buildLedgerRow) — it carries no
// request/response bodies, so there is nothing to leak; the drawer says so
// rather than pretending to an old deep-view it never had. Redaction-
// inheritance (the phase13 obligation) is proven in the security tests:
// whatever surface renders stored details applies the /api/usage/
// request-details redaction keys verbatim.
"use client";

import Drawer from "@/shared/components/Drawer";
import { t } from "../../../lib/t";
import { STATUS_COLORS, statusClassLabel } from "../../../lib/statusColors";
import { fmtTokens, fmtRowCost, fmtMs, fmtDateTime } from "../../../lib/ledgerFmt";
import TagEditor from "./TagEditor";

function Field({ label, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className="break-words text-sm tabular-nums text-text" data-i18n-skip="true">{children}</span>
    </div>
  );
}

export default function LedgerDrawer({ row, onClose, onRowUpdate }) {
  if (!row) return null;
  const color = STATUS_COLORS[row.statusClass] || "#64748b";
  const totalTokens = (row.promptTokens || 0) + (row.completionTokens || 0);

  return (
    <Drawer isOpen onClose={onClose} title={t("Request Details")} width="lg">
      <div className="space-y-5">
        {/* Status header — the row's class, full-size */}
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium"
            style={{ color, backgroundColor: `${color}1a`, border: `1px solid ${color}40` }}
          >
            {statusClassLabel(row.statusClass)}
          </span>
          {row.status && row.status !== row.statusClass && (
            <span className="font-mono text-xs text-text-muted">{row.status}</span>
          )}
          {row.httpStatus != null && (
            <span className="rounded border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-xs text-text-muted" data-i18n-skip="true">
              HTTP {row.httpStatus}
            </span>
          )}
        </div>

        {/* Identity */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t("Timestamp")}>{fmtDateTime(row.timestamp)}</Field>
          <Field label={t("Provider")}>{row.providerDisplayName || row.provider || "—"}</Field>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] uppercase tracking-wide text-text-muted">{t("Model")}</span>
            <span className="break-all font-mono text-sm text-text" data-i18n-skip="true">{row.model || "—"}</span>
          </div>
          <Field label={t("Key")}>{row.keyName || row.keyPrefix || "—"}</Field>
          {row.accountName && <Field label={t("Account")}>{row.accountName}</Field>}
          {row.endpoint && <Field label={t("Endpoint")}>{row.endpoint}</Field>}
        </div>

        {/* W4-C — request tags. Operator annotations about this request;
            saved through the validated PUT route, echoed back by the server. */}
        <div className="rounded-lg border border-border bg-bg-subtle p-4">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">{t("Tags")}</span>
          <TagEditor
            usageId={row.id}
            tags={row.tags || []}
            onChange={(tags) => onRowUpdate && onRowUpdate({ ...row, tags })}
          />
        </div>

        {/* Tokens + cost */}
        <div className="rounded-lg border border-border bg-bg-subtle p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label={t("Input")}>{fmtTokens(row.promptTokens)}</Field>
            <Field label={t("Output")}>{fmtTokens(row.completionTokens)}</Field>
            <Field label={t("Cached")}>{fmtTokens(row.cachedTokens)}</Field>
            <Field label={t("Total")}>{fmtTokens(totalTokens)}</Field>
            <Field label={t("Est. cost")}>~{fmtRowCost(row.cost)}</Field>
            {row.rtk && <Field label={t("RTK saved")}>~{fmtRowCost(row.rtkSavedCostUsd)}</Field>}
          </div>
        </div>

        {/* Latency — the two-tier honesty */}
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Latency")}>{fmtMs(row.latencyMs)}</Field>
          <Field label={t("TTFT")}>{fmtMs(row.ttftMs)}</Field>
        </div>

        {/* The honesty clause — payloads stay redacted */}
        <div className="flex items-start gap-2 rounded-lg border border-border bg-bg-subtle p-3 text-xs text-text-muted">
          <span className="material-symbols-outlined mt-0.5 text-[16px]">lock</span>
          <span>{t("Conversation payloads stay redacted in the Observatory")}</span>
        </div>
      </div>
    </Drawer>
  );
}
