"use client";
// LiveRequestPulse — the gateway's live heartbeat, as a strip (sealed plan
// §3.1 · W3, the live request pulse).
//
// WHY A STRIP AND NOT A PANEL: the question it answers — "is the gateway
// serving right now?" — is asked constantly and answered by two numbers. A
// panel would bury them; a strip sits beside the posture census and answers at
// a glance. It reads the SAME wire the Usage Observatory reads
// (`/api/usage/stream?period=<window>`), so there is exactly one live feed in
// the client, not an endpoint-shaped second copy of it.
//
// THE ADDITIVE LAW (W2-A): the stream merges ONLY the real-time fields
// (`activeRequests`, `recentRequests`, `errorProvider`, `pending`) and NEVER
// overwrites a REST picture. The strip is additive by construction: it holds no
// REST data of its own to overwrite, and a stream that never connects leaves
// every other number on the page standing — the strip renders its "live feed
// unavailable" line and nothing else changes.
//
// PERIOD-KEYED: a window change closes the EventSource and opens the new one,
// the same keying the usage hook uses — a slow frame from the previous window
// can never land on the new one.
import { useEffect, useState } from "react";
import { translate } from "@/i18n/runtime";

/** Format a recent-request row's time — compact, no locale drift. */
function rowTime(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export default function LiveRequestPulse({ period }) {
  const [live, setLive] = useState(null);
  const [state, setState] = useState("connecting"); // connecting | live | unavailable

  useEffect(() => {
    const es = new EventSource(`/api/usage/stream?period=${encodeURIComponent(period)}`);

    es.onopen = () => setState("live");
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setState("live");
        setLive({
          activeRequests: data.activeRequests ?? 0,
          pending: data.pending ?? 0,
          errorProvider: data.errorProvider ?? null,
          recentRequests: Array.isArray(data.recentRequests) ? data.recentRequests.slice(0, 5) : [],
        });
      } catch { /* a malformed frame is not a reason to drop the feed */ }
    };
    es.onerror = () => setState("unavailable");

    return () => es.close();
  }, [period]);

  if (state === "unavailable") {
    return (
      <div className="flex items-center gap-2 rounded-[12px] border border-border-subtle bg-surface px-3 py-2">
        <span className="material-symbols-outlined text-sm text-text-muted" aria-hidden="true">cloud_off</span>
        <span className="text-2xs text-text-muted">{translate("Live feed unavailable")}</span>
      </div>
    );
  }

  return (
    <div className="rounded-[12px] border border-border-subtle bg-surface px-3 py-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="flex items-center gap-1.5 text-2xs font-medium">
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${state === "live" ? "bg-emerald-500" : "bg-text-muted/40"}${state === "live" ? " motion-fill" : ""}`}
            aria-hidden="true"
          />
          {state === "live" ? translate("Live") : translate("Connecting…")}
        </span>
        <span className="text-2xs text-text-muted font-mono tabular-nums">
          {live?.activeRequests ?? 0} {translate("active")}
        </span>
        {live?.pending > 0 && (
          <span className="text-2xs text-amber-600 dark:text-amber-400 font-mono tabular-nums">
            {live.pending} {translate("pending")}
          </span>
        )}
        {live?.errorProvider && (
          <span className="text-2xs text-red-500 font-mono">
            {live.errorProvider} {translate("erroring")}
          </span>
        )}
      </div>
      {live && live.recentRequests.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {live.recentRequests.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-3xs text-text-muted font-mono tabular-nums">
              <span className="shrink-0">{rowTime(r.at ?? r.t ?? r.timestamp)}</span>
              <span className="truncate min-w-0">{r.keyPrefix || r.key || r.model || "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
