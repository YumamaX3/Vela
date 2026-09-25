"use client";
// ObservabilityCard — the four orphan keys, given a writer at last.
//
// `observabilityMaxRecords`, `observabilityBatchSize`,
// `observabilityFlushIntervalMs` and `observabilityMaxJsonSize` were declared
// in DEFAULT_SETTINGS and READ by requestDetailsRepo on every request — but no
// code anywhere ever WROTE them. They could only be changed by the
// `OBSERVABILITY_*` env fallbacks, which meant the dashboard's own recording
// budget was unreachable from the dashboard. This card is their first writer.
//
// The master on/off toggle stays in the Advanced lens (one switch, one home —
// this card never duplicates it), and `ENABLE_REQUEST_LOGS` is shown read-only
// because it is an env flag the process reads, not a setting it stores.
import { useState } from "react";
import { Card, Button, Input } from "@/shared/components";

const FIELDS = [
  { key: "observabilityMaxRecords", label: "Max records", hint: "How many request details to retain.", env: "OBSERVABILITY_MAX_RECORDS", unit: "records" },
  { key: "observabilityBatchSize", label: "Batch size", hint: "Rows written per flush.", env: "OBSERVABILITY_BATCH_SIZE", unit: "rows" },
  { key: "observabilityFlushIntervalMs", label: "Flush interval", hint: "How often buffered records are written.", env: "OBSERVABILITY_FLUSH_INTERVAL_MS", unit: "ms" },
  { key: "observabilityMaxJsonSize", label: "Max JSON size", hint: "Per-record cap before truncation.", env: "OBSERVABILITY_MAX_JSON_SIZE", unit: "KB" },
];

export default function ObservabilityCard({ deck }) {
  const { settings, loading, pending, patch } = deck;
  const [status, setStatus] = useState({ type: "", message: "" });
  const [draft, setDraft] = useState({});
  const busy = loading;

  const valueOf = (key) => {
    if (key in draft) return draft[key];
    const v = settings?.[key];
    return v == null ? "" : String(v);
  };

  const apply = async () => {
    setStatus({ type: "", message: "" });
    const body = {};
    const keys = [];
    for (const f of FIELDS) {
      if (!(f.key in draft)) continue;
      const raw = String(draft[f.key] ?? "").trim();
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) {
        setStatus({ type: "error", message: `${f.label} must be a positive number.` });
        return;
      }
      body[f.key] = Math.floor(n);
      keys.push(f.key);
    }
    if (!keys.length) {
      setStatus({ type: "info", message: "Nothing changed." });
      return;
    }
    const r = await patch(body, keys);
    setStatus(r.ok ? { type: "success", message: "Recording budget applied" } : { type: "error", message: r.error });
    if (r.ok) setDraft({});
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">health_and_safety</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Recording budget</h3>
          <p className="text-xs text-text-muted">
            How much request detail this instance keeps. The master switch lives in the Advanced lens.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-text-main">{f.label}</label>
            <Input
              inputMode="numeric"
              value={valueOf(f.key)}
              disabled={busy || !!pending[f.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            />
            <p className="text-xs text-text-muted">{f.hint} <span className="font-mono">({f.unit})</span></p>
          </div>
        ))}
      </div>

      <div className="pt-4 mt-4 border-t border-border-subtle flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-text-muted">
          Request-log tracing <span className="font-mono">ENABLE_REQUEST_LOGS</span> is an environment flag — set it in the launch environment.
        </p>
        <Button variant="primary" loading={FIELDS.some((f) => pending[f.key])} disabled={busy} onClick={apply} className="shrink-0">
          Apply
        </Button>
      </div>
      {status.message && (
        <p className={`mt-3 text-xs sm:text-sm ${status.type === "error" ? "text-red-500" : status.type === "info" ? "text-text-muted" : "text-success"}`}>
          {status.message}
        </p>
      )}
    </Card>
  );
}
