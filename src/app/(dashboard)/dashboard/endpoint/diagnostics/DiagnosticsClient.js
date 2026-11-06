"use client";
// DiagnosticsClient — the Diagnostics shore: a live probe of the gateway this
// page administers. The old `?tab=diagnostics`, now a URL (§3.1 · W3).
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
import EndpointShore from "../components/EndpointShore";
import { useEndpointFacade } from "../hooks/useEndpointFacade";

const PROBE_TIMEOUT_MS = 5000;
const MAX_SAMPLES = 12;

export default function DiagnosticsClient() {
  const c = useEndpointFacade();
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
    <EndpointShore
      title="Diagnostics"
      subtitle="What this browser measured just now — one real request, its latency, and the transports' live posture."
      icon="monitor_heart"
      error={c.error}
      onRetry={c.reload}
      loading={c.loading}
    >
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
                <p className="text-3xs uppercase tracking-wider opacity-60 mb-1">
                  {translate("Responded in")}
                </p>
                <p className="font-mono text-3xl font-semibold">{probe.ms}<span className="text-base opacity-60"> ms</span></p>
              </>
            ) : (
              <>
                <p className="text-3xs uppercase tracking-wider opacity-60 mb-1">
                  {translate("No response")}
                </p>
                <p className="font-mono text-lg font-semibold break-all">{probe.error}</p>
              </>
            )}
          </div>

          {/* The history — the last 12 real measurements this session */}
          <div className="mt-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-xs font-medium text-text-muted">{translate("Latency history")}</p>
              {samples.length > 0 && (
                <p className="text-2xs text-text-muted font-mono tabular-nums">
                  best {best} ms · worst {worst} ms · {samples.length}/{MAX_SAMPLES}
                </p>
              )}
            </div>
            <div className="flex items-end gap-1 h-16" role="img" aria-label={translate("Recent probe latencies")}>
              {samples.length === 0 ? (
                <p className="text-xs text-text-muted self-center">
                  {translate("No samples yet — run the probe to start the history.")}
                </p>
              ) : (
                samples.map((ms, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t motion-enter"
                    style={{
                      height: `${Math.max((ms / peak) * 100, 4)}%`,
                      background: i === samples.length - 1 ? "var(--color-brand-500)" : "var(--color-border)",
                    }}
                    title={`${ms} ms`}
                  />
                ))
              )}
            </div>
          </div>
        </Card>

        {/* What this browser can see — the transports' live posture */}
        <Card>
          <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-500" aria-hidden="true">lan</span>
            {translate("Reachability from here")}
          </h2>
          <p className="text-xs text-text-muted mb-3">
            {translate("Measured by this browser directly — independent of the server's own DNS.")}
          </p>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 py-2 border-b border-border-subtle last:border-b-0">
              <span className="text-sm">Local</span>
              <span className="text-2xs font-medium text-green-600 dark:text-green-400">reachable</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2 border-b border-border-subtle last:border-b-0">
              <span className="text-sm">Cloudflare Tunnel</span>
              <span className={`text-2xs font-medium ${
                !tunnelEnabled
                  ? "text-text-muted"
                  : tunnelReachable
                    ? "text-green-600 dark:text-green-400"
                    : "text-amber-600 dark:text-amber-400"
              }`}>
                {!tunnelEnabled ? "disabled" : tunnelReachable ? "reachable" : "unreachable"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2 border-b border-border-subtle last:border-b-0">
              <span className="text-sm">Tailscale</span>
              <span className={`text-2xs font-medium ${
                !tsEnabled
                  ? "text-text-muted"
                  : tsReachable
                    ? "text-green-600 dark:text-green-400"
                    : "text-amber-600 dark:text-amber-400"
              }`}>
                {!tsEnabled ? "disabled" : tsReachable ? "reachable" : "unreachable"}
              </span>
            </div>
          </div>
        </Card>

        {/* The endpoint address, for the copy-paste moment */}
        <Card>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-brand-500" aria-hidden="true">api</span>
            {translate("Endpoint address")}
          </h2>
          <div className="rounded-[12px] p-4 font-mono text-sm break-all" style={{ background: "var(--color-terminal)", color: "var(--color-terminal-text)" }}>
            {baseUrl}
          </div>
          <p className="text-xs text-text-muted mt-2">
            {keys.length === 0
              ? translate("No keys yet — the endpoint refuses every request until one exists.")
              : translate("Send requests here with an Authorization: Bearer <key> header.")}
          </p>
          {isRemoteHost && (
            <p className="text-xs text-text-muted mt-1">
              {translate("You are viewing this dashboard from a remote host.")}
            </p>
          )}
        </Card>
      </div>
    </EndpointShore>
  );
}
