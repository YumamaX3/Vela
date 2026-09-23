"use client";
// DiagnosticsTab — a live probe of the gateway this page administers.
//
// WHY IT IS HONEST: a diagnostics panel that invents a green tick is worse than
// no panel, so every number here is either measured in this browser right now,
// or labelled as coming from the server. The latency probe times a real
// request to /api/health and reports what it measured — including failure.
//
// R-31 / Liveliness:
//   · The probe result is the focal point: one big measured number, in the
//     warm-ink terminal surface, the same vault as the addresses.
//   · The history sparkline is REAL DATA — the last 12 probe durations this
//     session. It is drawn as a bar per sample, not a decorative gradient.
//   · MOTION dial 2: bars fade in; no looping animation.
// Contrast: readouts are --color-terminal-text on --color-terminal; the
// sparkline's idle bars use --color-border (3.4:1 against --color-surface,
// clearing SC 1.4.11's 3:1 for non-text), and active bars use brand-500.
import { useState } from "react";
import { Card, Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";

const PROBE_TIMEOUT_MS = 5000;
const MAX_SAMPLES = 12;

export default function DiagnosticsTab({ c }) {
  const { baseUrl, keys, tunnelEnabled, tunnelReachable, tsEnabled, tsReachable, isRemoteHost } = c;
  const [probe, setProbe] = useState({ state: "idle", ms: null, at: null, error: null });
  const [samples, setSamples] = useState([]);
  const [probing, setProbing] = useState(false);

  async function runProbe() {
    setProbing(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const started = performance.now();
    try {
      const res = await fetch("/api/health", { signal: controller.signal, cache: "no-store" });
      const ms = Math.round(performance.now() - started);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProbe({ state: "up", ms, at: new Date(), error: null });
      setSamples((prev) => [...prev, ms].slice(-MAX_SAMPLES));
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      setProbe({
        state: "down",
        ms: null,
        at: new Date(),
        error: err?.name === "AbortError" ? translate("Timed out after 5s") : String(err?.message || err),
      });
      setSamples((prev) => [...prev, ms].slice(-MAX_SAMPLES));
    } finally {
      clearTimeout(timer);
      setProbing(false);
    }
  }

  const peak = samples.length ? Math.max(...samples, 1) : 1;
  const worst = samples.length ? Math.max(...samples) : null;
  const best = samples.length ? Math.min(...samples) : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-500" aria-hidden="true">monitor_heart</span>
            {translate("Gateway probe")}
          </h2>
          <Button icon="bolt" onClick={runProbe} disabled={probing}>
            {probing ? translate("Probing…") : probe.state === "idle" ? translate("Run probe") : translate("Probe again")}
          </Button>
        </div>

        {/* The measured result — the focal point */}
        <div className="rounded-[12px] p-5" style={{ background: "var(--color-terminal)", color: "var(--color-terminal-text)" }}>
          {probe.state === "idle" ? (
            <p className="text-sm opacity-70">
              {translate("No probe run yet this session. Run one to measure the gateway from this browser.")}
            </p>
          ) : probe.state === "up" ? (
            <>
              <p className="text-[10px] uppercase tracking-wider opacity-60 mb-1">
                {translate("Responded in")}
              </p>
              <p className="font-mono text-3xl font-semibold">{probe.ms}<span className="text-base opacity-60"> ms</span></p>
            </>
          ) : (
            <>
              <p className="text-[10px] uppercase tracking-wider opacity-60 mb-1">
                {translate("No response")}
              </p>
              <p className="font-mono text-lg font-semibold break-all">{probe.error}</p>
            </>
          )}
          {probe.at && (
            <p className="text-[11px] opacity-60 mt-2">
              {translate("Last checked")} {probe.at.toLocaleTimeString()}
            </p>
          )}
        </div>

        {/* Real sample history — one bar per measurement */}
        {samples.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                {translate("This session")}
              </p>
              <p className="text-[11px] text-text-muted">
                {translate("best")} {best} ms · {translate("worst")} {worst} ms
              </p>
            </div>
            <div className="flex items-end gap-1 h-16" role="img"
              aria-label={`${samples.length} probe samples; best ${best} ms, worst ${worst} ms`}>
              {samples.map((s, i) => (
                <div
                  key={`${i}-${s}`}
                  className="flex-1 rounded-t-[3px] bg-brand-500/70 fade-in"
                  style={{ height: `${Math.max(4, (s / peak) * 100)}%`, animationDelay: `${i * 20}ms` }}
                  title={`${s} ms`}
                />
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Facts the page already knows — no extra request */}
      <Card>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-brand-500 text-[18px]" aria-hidden="true">fact_check</span>
          {translate("Known state")}
        </h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
          {[
            { k: translate("Base URL"), v: baseUrl },
            { k: translate("Keys configured"), v: `${keys.length}` },
            { k: translate("Requests are from"), v: isRemoteHost ? translate("a remote host") : translate("this machine") },
            { k: "Cloudflare Tunnel", v: tunnelEnabled ? (tunnelReachable ? translate("enabled, reachable") : translate("enabled, reconnecting")) : translate("disabled") },
            { k: "Tailscale Funnel", v: tsEnabled ? (tsReachable ? translate("enabled, reachable") : translate("enabled, reconnecting")) : translate("disabled") },
          ].map((row) => (
            <div key={row.k} className="flex items-center justify-between gap-3 py-2 border-b border-border-subtle last:border-b-0">
              <dt className="text-xs text-text-muted">{row.k}</dt>
              <dd className="text-xs font-mono truncate">{row.v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[11px] text-text-muted mt-3">
          {translate("The probe measures from this browser to the dashboard's own health route — it does not test an upstream provider.")}
        </p>
      </Card>
    </div>
  );
}
