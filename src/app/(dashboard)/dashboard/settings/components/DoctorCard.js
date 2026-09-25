"use client";
// DoctorCard — the Network Doctor: the phase sweep.
//
// A single "reachable / unreachable" answer hides WHERE a path broke. This card
// shows the phases separately — DNS, TCP, TLS, HTTP — so a failure names itself
// (a host that will not resolve reads differently from a certificate that
// expired). Targets are operator-typed and cross the SSRF gate inside the
// engine; a refused target returns a refusal verdict, never a dial.
import { useState } from "react";
import { Card, Button, Input } from "@/shared/components";
import { runNetworkDiagnose } from "../lib/settingsApi";

const VERDICT_TONE = {
  ok: "text-success",
  dns: "text-red-500",
  tcp: "text-red-500",
  tls: "text-red-500",
  http: "text-amber-600 dark:text-amber-400",
  refused: "text-amber-600 dark:text-amber-400",
};

function ms(v) {
  return typeof v === "number" ? `${v}ms` : "—";
}

function PhaseCell({ label, phase, extra }) {
  if (!phase) return <span className="text-text-muted">—</span>;
  return (
    <span className={phase.ok ? "text-success" : "text-red-500"}>
      {phase.ok ? "✓" : "✗"} {ms(phase.ms)}{extra ? <span className="text-text-muted"> · {extra}</span> : null}
    </span>
  );
}

function EndpointRow({ e }) {
  const tone = VERDICT_TONE[e.verdict] || "text-text-muted";
  return (
    <div className="rounded-[10px] border border-border-subtle p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-text-main truncate">{e.host || e.url || "—"}</span>
        <span className={`text-xs font-semibold uppercase tracking-wide shrink-0 ${tone}`}>{e.verdict}</span>
      </div>
      {e.reason && <p className="text-xs text-text-muted">{e.reason}</p>}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div><div className="text-text-muted">DNS</div><PhaseCell label="dns" phase={e.dns} /></div>
        <div><div className="text-text-muted">TCP</div><PhaseCell label="tcp" phase={e.tcp} /></div>
        <div><div className="text-text-muted">TLS</div><PhaseCell label="tls" phase={e.tls} extra={e.tls?.daysRemaining != null ? `${e.tls.daysRemaining}d cert` : null} /></div>
        <div><div className="text-text-muted">HTTP</div><PhaseCell label="http" phase={e.http} extra={e.http?.status ? `status ${e.http.status}` : null} /></div>
      </div>
    </div>
  );
}

export default function DoctorCard({ defaultTargets = [] }) {
  const [urls, setUrls] = useState(() => (defaultTargets.length ? defaultTargets.join("\n") : ""));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const list = urls.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const data = await runNetworkDiagnose({ urls: list });
      setResult(data);
    } catch (err) {
      setError(err.message || "Diagnostics failed");
    } finally {
      setBusy(false);
    }
  };

  const egress = result?.egress;
  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">monitor_heart</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Network Doctor</h3>
          <p className="text-xs text-text-muted">
            Measure each phase on its own clock — DNS, TCP, TLS, HTTP — so a failure names where the path stopped.
          </p>
        </div>
      </div>

      <textarea
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder={"https://api.openai.com/v1\nhttps://api.anthropic.com"}
        className="w-full text-sm font-mono bg-surface-2 border border-transparent rounded-[10px] px-3 py-2 text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 motion-control"
      />
      <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
        <p className="text-xs text-text-muted">
          One URL per line. Each target is judged by the SSRF gate before it is dialled.
        </p>
        <Button variant="primary" icon="monitor_heart" loading={busy} onClick={run} className="shrink-0">
          Run diagnostics
        </Button>
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      {result && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-[10px] border border-border-subtle p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-text-main">This harbor&apos;s egress</span>
              <span className={`text-xs font-semibold ${egress?.ok ? "text-success" : "text-amber-600 dark:text-amber-400"}`}>
                {egress?.ok ? `via ${egress.via}` : (egress?.error || "unknown")}
              </span>
            </div>
            {egress?.ok ? (
              <p className="text-xs text-text-muted mt-1 tabular-nums">
                {egress.ip}{egress.city ? ` · ${egress.city}` : ""}{egress.country ? `, ${egress.country}` : ""}{egress.org ? ` · ${egress.org}` : ""}
                <span className="text-text-muted"> · source {egress.source} · {ms(egress.ms)}</span>
              </p>
            ) : (
              <p className="text-xs text-text-muted mt-1">No egress identity could be resolved.</p>
            )}
          </div>
          {result.endpoints?.length ? (
            result.endpoints.map((e, i) => <EndpointRow key={e.host || i} e={e} />)
          ) : (
            <p className="text-xs text-text-muted">No targets given — only the egress identity was checked.</p>
          )}
        </div>
      )}
    </Card>
  );
}
