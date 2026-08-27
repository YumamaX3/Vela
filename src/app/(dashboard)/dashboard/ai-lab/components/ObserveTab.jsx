"use client";

import { useEffect, useState } from "react";
import { Card } from "@/shared/components";
import { translate } from "@/i18n/runtime";

/**
 * Observe tab — the wire viewer: a per-request timeline (mode source →
 * savers → injectors → policy verdict → fallback hops → serving lane) read
 * from usage tags + the AppliedTrace header. Retention inherits
 * VELA_USAGE_RETENTION_DAYS via the usage rows. Gated on the S7
 * observability flag — when off, the panel says so honestly.
 */
export default function ObserveTab({ settings }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [disabled, setDisabled] = useState(false); // observability flag off

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/usage/tags");
        if (!res.ok) throw new Error(`usage tags unavailable (${res.status})`);
        const data = await res.json();
        if (alive) {
          if (data.disabled) setDisabled(true); // S7 flag off — honest off-state
          setRows(Array.isArray(data.tags) ? data.tags.slice(0, 50) : []);
        }
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <Card className="p-4">
      <h2 className="font-semibold mb-1">{translate("Wire Viewer")}</h2>
      <p className="text-xs text-text-muted mb-3">
        {translate("Per-request timeline: mode → savers → injectors → policy verdict → fallback hops → serving lane.")}
      </p>
      {loading ? (
        <p className="text-sm text-text-muted">loading…</p>
      ) : disabled ? (
        <p className="text-sm text-amber-600">
          {translate("Observability is off — no request tags are being recorded. Enable it in Settings → Observability to see the wire here.")}
        </p>
      ) : error ? (
        <p className="text-sm text-amber-600">{error} — {translate("enable the observability flag in Settings to record tags.")}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">{translate("No tagged requests yet — traffic with applied injectors will appear here.")}</p>
      ) : (
        <div className="flex flex-col gap-1.5 max-h-[480px] overflow-auto">
          {rows.map((r, i) => (
            <div key={i} className="text-xs p-2 rounded-lg border border-border-subtle bg-surface-2 font-mono">
              <span className="text-text-muted">{r.usageId || r.id || "—"}</span>
              <span className="mx-2 text-text-muted">→</span>
              {[r.mode, r.policy, r.servingLane].filter(Boolean).map((t, j) => (
                <span key={j} className="px-1.5 py-0.5 mr-1 rounded bg-primary/10 text-primary">{t}</span>
              ))}
              {r.injectors && <span className="text-text-muted">· {r.injectors}</span>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
