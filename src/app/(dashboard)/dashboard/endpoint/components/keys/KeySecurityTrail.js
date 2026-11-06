"use client";
// KeySecurityTrail — one key's audit events, inside the detail drawer (sealed
// plan §3.1 · W3, the per-key security trail).
//
// WHY IT LIVES IN THE DRAWER: the row shows what a key IS and what it COSTS;
// the drawer shows what it has DONE. The security trail is the third of those —
// every refused or admitted request the audit log kept for this key. It is a
// per-key question, so it belongs beside the key, not on a page of its own.
//
// THE MASKING LAW: the route answers masked prefixes only — `keyId` becomes
// `keyPrefix` (the stored prefix, or a derived form), and the raw id never
// leaves the server. This component prints the row's own masked fields and
// nothing else; it never receives, echoes or displays a raw key.
//
// THE ID SHAPE: `ID_KEY` (/^[0-9a-f]{8,64}$/i) is the route's own guard — a
// pasted `vela-v1-…` string is a malformed id and answers 400. The drawer
// passes the key's id unchanged and SHOWS the error, never silence: a failed
// read says "could not be read", an empty log says "no events recorded", and
// those are different truths.
//
// THE RETENTION WINDOW: the route reports `retentionDays`; the drawer says
// "events within N days" rather than implying forever.
import { useEffect, useState } from "react";
import { translate } from "@/i18n/runtime";

/** One event's time — compact, no locale drift. */
function eventTime(t) {
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function KeySecurityTrail({ keyId }) {
  const [events, setEvents] = useState(null);
  const [retentionDays, setRetentionDays] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setEvents(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/security-log?keyId=${encodeURIComponent(keyId)}&limit=50`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        if (controller.signal.aborted) return;
        setEvents(Array.isArray(data?.events) ? data.events : []);
        setRetentionDays(typeof data?.retentionDays === "number" ? data.retentionDays : null);
      } catch (err) {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        setError(err?.message || "could not be read");
      }
    })();
    return () => controller.abort();
  }, [keyId]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-sm text-brand-500" aria-hidden="true">history</span>
        <p className="text-xs font-medium">{translate("Security trail")}</p>
        {retentionDays !== null && (
          <span className="text-3xs text-text-muted">{translate("events within")} {retentionDays} {translate("days")}</span>
        )}
      </div>

      {error ? (
        <p className="text-2xs text-text-muted">
          {translate("Trail could not be read")} — {error}
        </p>
      ) : events === null ? (
        <p className="text-2xs text-text-muted">{translate("Reading the trail…")}</p>
      ) : events.length === 0 ? (
        <p className="text-2xs text-text-muted">{translate("No events recorded")}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {events.map((e, i) => (
            <li key={e.id ?? i} className="flex items-center gap-2 text-3xs font-mono tabular-nums">
              <span className="text-text-muted shrink-0">{eventTime(e.createdAt)}</span>
              <span className="text-text-main truncate min-w-0">{e.kind || "event"}</span>
              {e.ip ? <span className="text-text-muted shrink-0 ml-auto">{e.ip}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
