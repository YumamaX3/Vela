"use client";
// TimeoutsCard — the gateway's own network timeouts, given real levers.
//
// These three timeouts governed every upstream call and had NO control surface
// at all: they were env-only (`STREAM_STALL_TIMEOUT_MS`,
// `STREAM_FIRST_CHUNK_TIMEOUT_MS`, `FETCH_CONNECT_TIMEOUT_MS`). The engine now
// reads them as live bindings, so a value set here applies without a restart.
//
// The blank state is honest: an empty field means "inherit the env/default
// floor" — the historical behavior — and the card shows that floor beside it so
// the operator knows what they are inheriting, not guessing it.
import { useEffect, useState } from "react";
import { Card, Button, Input } from "@/shared/components";
import { fetchNetworkStatus } from "../lib/settingsApi";

const FIELDS = [
  {
    key: "streamStallTimeoutMs",
    label: "Stream stall timeout",
    hint: "Abort a stream when no chunk arrives for this long (once tokens are flowing).",
    env: "STREAM_STALL_TIMEOUT_MS",
  },
  {
    key: "streamFirstChunkTimeoutMs",
    label: "First-chunk timeout",
    hint: "Abort when the upstream sends no first token within this window (prompt prefill).",
    env: "STREAM_FIRST_CHUNK_TIMEOUT_MS",
  },
  {
    key: "fetchConnectTimeoutMs",
    label: "Connect timeout",
    hint: "Abort when the upstream returns no response headers within this window.",
    env: "FETCH_CONNECT_TIMEOUT_MS",
  },
];

export default function TimeoutsCard({ deck }) {
  const { settings, loading, pending, patch } = deck;
  const [status, setStatus] = useState({ type: "", message: "" });
  const [draft, setDraft] = useState({});
  const [floor, setFloor] = useState(null);

  // The floor is the env/default value the runtime is actually running with —
  // read from the engine, not assumed, so "inherit" shows its real number.
  useEffect(() => {
    let live = true;
    fetchNetworkStatus()
      .then((d) => { if (live) setFloor(d?.timeouts?.floor || null); })
      .catch(() => { /* the floor is a nicety — its absence never blocks the card */ });
    return () => { live = false; };
  }, []);

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
      if (raw === "") body[f.key] = null;
      else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          setStatus({ type: "error", message: `${f.label} must be a positive number of milliseconds, or blank to inherit.` });
          return;
        }
        body[f.key] = Math.floor(n);
      }
      keys.push(f.key);
    }
    if (!keys.length) {
      setStatus({ type: "info", message: "Nothing changed." });
      return;
    }
    const r = await patch(body, keys);
    setStatus(r.ok ? { type: "success", message: "Timeout policy applied" } : { type: "error", message: r.error });
    if (r.ok) setDraft({});
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">speed</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Timeout policy</h3>
          <p className="text-xs text-text-muted">
            The gateway&apos;s own network timeouts. Blank means inherit the environment floor; a value applies live.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {FIELDS.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <label className="text-sm font-medium text-text-main">{f.label}</label>
              <span className="text-xs text-text-muted tabular-nums">
                floor {floor?.[f.key] != null ? `${floor[f.key]}ms` : "—"}
              </span>
            </div>
            <Input
              inputMode="numeric"
              placeholder="inherit"
              value={valueOf(f.key)}
              disabled={busy || !!pending[f.key]}
              onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            />
            <p className="text-xs text-text-muted">{f.hint} <span className="font-mono">({f.env})</span></p>
          </div>
        ))}
        <div className="pt-2 border-t border-border-subtle flex justify-end">
          <Button variant="primary" loading={FIELDS.some((f) => pending[f.key])} disabled={busy} onClick={apply}>
            Apply
          </Button>
        </div>
        {status.message && (
          <p className={`text-xs sm:text-sm ${status.type === "error" ? "text-red-500" : status.type === "info" ? "text-text-muted" : "text-success"}`}>
            {status.message}
          </p>
        )}
      </div>
    </Card>
  );
}
