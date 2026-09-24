"use client";
// Auth Hardening W1 — the session ledger's reading surface.
//
// The roll was written from v0.9.76 (every minted session records a row) and
// named from v0.9.78 (the login page offers a device label) — and until this
// card there was no window onto it: `GET /api/auth/sessions` answered, and
// nothing asked. A ledger nobody can read is a ledger nobody can act on, and
// the whole point of keying a row by the JWT's own `jti` was that a session
// could be *seen* and *struck*.
//
// Two honest distinctions this card keeps, because collapsing either one would
// mislead an operator:
//   • revoked rows are SHOWN, not hidden — the `revokedAt` is the record of a
//     kill, and a vanished row would read as "never existed"
//   • the caller's own session is marked, because "log out everywhere" that
//     signs you out is a different button from one that spares you
//
// The label is the operator's own words, never an identity: the card renders it
// beside the user agent, and a row without one says so plainly.
import { useState, useEffect, useCallback } from "react";
import { Card, Button } from "@/shared/components";

/** Short, honest rendering of a timestamp the ledger stored as ISO. */
function fmtWhen(iso) {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const delta = Date.now() - ms;
  const mins = Math.round(delta / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** A browser user agent, shortened to something a person reads. */
function fmtAgent(ua) {
  if (!ua) return "unknown client";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : /curl\//i.test(ua) ? "curl"
    : null;
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux"
    : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser || os || ua.slice(0, 40);
}

export default function SessionsCard() {
  const [sessions, setSessions] = useState([]);
  const [currentId, setCurrentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [msg, setMsg] = useState({ type: "", message: "" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/sessions");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: "error", message: data.error || "Could not read the session ledger." });
        return;
      }
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      setCurrentId(data.currentId || null);
    } catch {
      /* fail-open — the card never breaks the page */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const revokeOne = async (id) => {
    setBusyId(id);
    setMsg({ type: "", message: "" });
    try {
      const res = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ type: "error", message: data.error || "Could not revoke the session." });
      else if (id === currentId) {
        // The caller just struck their own session; the cookie is gone with it,
        // so the honest next step is the door, not a stale dashboard.
        window.location.assign("/login");
        return;
      } else setMsg({ type: "success", message: "Session revoked." });
      await refresh();
    } catch {
      setMsg({ type: "error", message: "Could not reach the server." });
    } finally {
      setBusyId(null);
    }
  };

  const revokeAll = async (keepCurrent) => {
    setBusyId("all");
    setMsg({ type: "", message: "" });
    try {
      const res = await fetch("/api/auth/sessions/revoke-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepCurrent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ type: "error", message: data.error || "Could not revoke the sessions." });
      else setMsg({ type: "success", message: `Revoked ${data.revoked ?? 0} session${data.revoked === 1 ? "" : "s"}.` });
      await refresh();
    } catch {
      setMsg({ type: "error", message: "Could not reach the server." });
    } finally {
      setBusyId(null);
      setRevokeAllOpen(false);
    }
  };

  const live = sessions.filter((s) => !s.revokedAt && !s.expired);

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">devices</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Sessions</h3>
          <p className="text-xs sm:text-sm text-text-muted">
            {loading
              ? "Reading the ledger…"
              : `${live.length} live session${live.length === 1 ? "" : "s"} — each device that holds a key to this dashboard.`}
          </p>
        </div>
        {!loading && live.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setRevokeAllOpen((v) => !v)} disabled={busyId === "all"}>
            Revoke all
          </Button>
        )}
      </div>

      {msg.message && (
        <p className={`text-xs sm:text-sm mb-3 ${msg.type === "error" ? "text-red-500" : "text-green-500"}`}>
          {msg.message}
        </p>
      )}

      {revokeAllOpen && (
        <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex flex-col gap-2">
          <p className="text-xs sm:text-sm text-amber-600 dark:text-amber-400">
            Strike every session, or every session but this one?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => revokeAll(true)} disabled={busyId === "all"}>
              Keep this device
            </Button>
            <Button variant="danger" size="sm" onClick={() => revokeAll(false)} disabled={busyId === "all"}>
              Sign out everywhere
            </Button>
          </div>
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <p className="text-xs sm:text-sm text-text-muted">
          No sessions in the ledger. A session appears the moment someone signs in.
        </p>
      )}

      <div className="flex flex-col divide-y divide-border/50">
        {sessions.map((s) => {
          const revoked = !!s.revokedAt;
          const expired = !!s.expired;
          const dead = revoked || expired;
          return (
            <div key={s.id} className="flex items-start sm:items-center justify-between gap-3 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm font-medium truncate ${dead ? "text-text-muted line-through" : ""}`}>
                    {s.label || "Unnamed device"}
                  </p>
                  {s.current && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                      this device
                    </span>
                  )}
                  {revoked && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/15 text-red-500">
                      revoked
                    </span>
                  )}
                  {!revoked && expired && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-border/60 text-text-muted">
                      expired
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted truncate">
                  {s.ip || "unknown ip"} · {fmtAgent(s.userAgent)} · last seen {fmtWhen(s.lastSeenAt)}
                </p>
                {revoked && (
                  <p className="text-[11px] text-text-subtle">
                    revoked {fmtWhen(s.revokedAt)}
                    {s.revokedReason ? ` (${s.revokedReason})` : ""}
                  </p>
                )}
              </div>
              {!dead && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => revokeOne(s.id)}
                  disabled={busyId === s.id}
                >
                  {s.current ? "Sign out" : "Revoke"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
