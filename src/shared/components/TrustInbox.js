"use client";

// TrustInbox — the mast's unread bell.
//
// The trust inbox (migration 030, /api/trust-events) holds the handful of acts
// that deserve the operator's glance: a key revoked, a guardrail blocking
// traffic. This is the bell that says so, and the dropdown that lets each one
// be dismissed.
//
// THE ZERO-SUPPRESSION LAW: an unread count of 0 renders NOTHING — not the
// bell, not a "0" badge. A silent inbox is not an instrument, and a badge that
// says zero is noise dressed as a signal. The bell appears only when there is
// something to tell, and leaves again when the last notice is read.
//
// Fail-open at the edge: a failed poll leaves the last known count in place and
// never throws into the header. Reads are cheap and local; the interval is slow
// and pauses while the dropdown is open (the list already shows what arrived).
//
// Accessibility: the trigger announces its count via aria-label, the panel is
// a labelled list, Escape and an outside click close it (QuickNav's idiom).

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/shared/utils/cn";

const POLL_MS = 60_000;

/** "3m ago" — compact, honest, no locale machinery for a 5-line notice. */
function relTime(ms) {
  const diff = Date.now() - Number(ms || 0);
  if (!Number.isFinite(diff) || diff < 0) return "";
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const KIND_ICON = {
  "key.revoked": "vpn_key",
  "guardrail.block": "shield",
};

export default function TrustInbox({ className = "" }) {
  const [unread, setUnread] = useState(0);
  const [events, setEvents] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  const loadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/trust-events?limit=1", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.unread === "number") setUnread(data.unread);
    } catch {
      // The header never breaks on a failed poll.
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trust-events?limit=20", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.events)) setEvents(data.events);
      if (typeof data?.unread === "number") setUnread(data.unread);
    } catch {
      // keep the last list
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll the count; pause while the panel is open.
  useEffect(() => {
    loadCount();
    if (open) return undefined;
    const id = setInterval(loadCount, POLL_MS);
    return () => clearInterval(id);
  }, [loadCount, open]);

  // Opening fetches the fresh list; closing discards nothing (count stays).
  useEffect(() => {
    if (open) loadList();
  }, [open, loadList]);

  // Click-outside + Escape close — the QuickNav discipline.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = async (id) => {
    // Optimistic: flip locally, then reconcile with the server's own count.
    setEvents((prev) => prev.map((ev) => (ev.id === id ? { ...ev, read: true } : ev)));
    setUnread((n) => Math.max(0, n - 1));
    try {
      const res = await fetch("/api/trust-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.unread === "number") setUnread(data.unread);
      }
    } catch {
      // A failure here only means the badge is stale for one poll.
    }
  };

  const markAll = async () => {
    setEvents((prev) => prev.map((ev) => ({ ...ev, read: true })));
    setUnread(0);
    try {
      const res = await fetch("/api/trust-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read-all" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data?.unread === "number") setUnread(data.unread);
      }
    } catch {
      // stale for one poll — acceptable
    }
  };

  // ZERO-SUPPRESSION: nothing to tell, nothing rendered. No bell for a silent
  // inbox — the button would be a dead instrument the operator must learn to
  // ignore. It appears with the first unread act and leaves with the last.
  if (unread <= 0) return null;

  const badge = unread > 99 ? "99+" : String(unread);

  return (
    <div className={cn("relative", className)} ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Trust inbox — ${unread} unread`}
        title={`Trust inbox — ${unread} unread`}
        className={cn(
          "relative flex items-center justify-center size-9 rounded-lg",
          "text-text-muted hover:text-text-main",
          "hover:bg-surface-2 motion-control",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          open && "text-primary bg-primary/10 hover:bg-primary/10"
        )}
      >
        <span className="material-symbols-outlined text-[22px]" aria-hidden="true">
          inbox
        </span>
        <span
          className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-danger text-[10px] font-semibold leading-4 text-white text-center shadow"
          aria-hidden="true"
        >
          {badge}
        </span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Trust inbox"
          className={cn(
            "mast-panel absolute right-0 top-full mt-2 z-50",
            "w-[min(92vw,360px)] p-0",
            "bg-surface border border-border rounded-xl shadow-2xl"
          )}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
            <span className="text-3xs font-semibold uppercase tracking-wider text-text-muted">
              Trust inbox
            </span>
            <button
              type="button"
              onClick={markAll}
              className="text-3xs font-medium text-primary hover:underline motion-control"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-[320px] overflow-y-auto">
            {loading && events.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-text-muted">Loading…</div>
            ) : events.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-text-muted">Nothing to review.</div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {events.map((ev) => (
                  <li key={ev.id} className={cn("flex items-start gap-2 px-3 py-2", !ev.read && "bg-primary/5")}>
                    <span
                      className={cn("material-symbols-outlined text-lg mt-0.5", ev.read ? "text-text-subtle" : "text-primary")}
                      aria-hidden="true"
                    >
                      {KIND_ICON[ev.kind] || "inbox"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text-main truncate" title={ev.title}>
                        {ev.title}
                      </div>
                      <div className="text-3xs text-text-muted">
                        {relTime(ev.createdAt)}
                        {ev.detail?.keyPrefix ? ` · ${ev.detail.keyPrefix}` : ""}
                        {Array.isArray(ev.detail?.entities) && ev.detail.entities.length
                          ? ` · ${ev.detail.entities.join(", ")}`
                          : ""}
                      </div>
                    </div>
                    {!ev.read && (
                      <button
                        type="button"
                        onClick={() => markRead(ev.id)}
                        aria-label={`Mark "${ev.title}" read`}
                        title="Mark read"
                        className="shrink-0 text-text-muted hover:text-text-main p-0.5 rounded motion-control"
                      >
                        <span className="material-symbols-outlined text-base">check</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
