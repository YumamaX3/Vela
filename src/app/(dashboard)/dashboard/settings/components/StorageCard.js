"use client";
// StorageCard — what this instance occupies, and the retention lever.
//
// Reads /api/backup/inventory (one request: census + backup policy + off-site
// readiness). Shows the DB file trio, the total row count, a per-table
// breakdown, and the usage-retention window with a "Purge now" action.
//
// The purge is a MUTATION, so it re-confirms the dashboard password inside the
// same lockout accounting as every other backup write, and it states the loss
// BEFORE it happens (the dry plan is the count of rows past the window, shown
// on the button's own line). A row count of `null` is a table the schema
// declares but this DB has not migrated yet — surfaced as "—", never as zero,
// because zero and "not yet migrated" are different truths.
import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input } from "@/shared/components";
import Modal from "@/shared/components/Modal";
import { fmtBytes, fmtCount } from "../lib/formatBytes";

export default function StorageCard({ onChanged, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState({ type: "", message: "" });
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/backup/inventory", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && !body.error) setData(body);
    } catch {
      /* fail-open — the card never breaks the room */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh, refreshKey]);

  const purge = async () => {
    setLoading(true);
    setMsg({ type: "", message: "" });
    try {
      const res = await fetch("/api/backup/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: "error", message: body.error || "Purge failed" });
      } else {
        setMsg({ type: body.ok ? "success" : "warn", message: body.message || "Purge complete" });
        setPassword("");
        await refresh();
        onChanged?.();
      }
    } catch (e) {
      setMsg({ type: "error", message: e?.message || "Purge failed" });
    } finally {
      setLoading(false);
      setPurgeOpen(false);
    }
  };

  const inv = data?.inventory;
  const tables = inv?.tables ?? [];
  const sorted = [...tables].sort((a, b) => (b.rows ?? -1) - (a.rows ?? -1));
  const rows = showAll ? sorted : sorted.slice(0, 6);
  const fileBytes = inv?.dbFileBytes;
  const retention = inv?.retention;

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">storage</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Storage</h3>
          <p className="text-xs text-text-muted">
            What this instance occupies on disk, and how long usage is kept.
          </p>
        </div>
        {inv?.mode && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-surface-2 text-text-muted shrink-0">
            {inv.mode}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-xs sm:text-sm">
        <div>
          <p className="text-text-muted">Database file</p>
          <p className="font-medium">{fileBytes == null ? "—" : fmtBytes(fileBytes)}</p>
        </div>
        <div>
          <p className="text-text-muted">Rows (all tables)</p>
          <p className="font-medium">{fmtCount(inv?.totalRows)}</p>
        </div>
        <div>
          <p className="text-text-muted">WAL</p>
          <p className="font-medium">{inv?.walBytes == null ? "—" : fmtBytes(inv.walBytes)}</p>
        </div>
        <div>
          <p className="text-text-muted">Schema</p>
          <p className="font-medium">{inv?.schemaVersion ?? "—"}</p>
        </div>
      </div>

      {inv?.mode === "mysql" && (
        <p className="text-xs text-text-muted mb-3">
          MySQL posture — file sizes live in the server&apos;s own datadir, so they are not read here.
        </p>
      )}

      {sorted.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Largest tables</p>
            {sorted.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="text-xs text-text-muted hover:text-text-main motion-control"
              >
                {showAll ? "Show less" : `Show all ${sorted.length}`}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {rows.map((t) => (
              <div key={t.name} className="flex items-center justify-between py-1 border-b border-border-subtle text-xs sm:text-sm">
                <span className="text-text-muted truncate">{t.name}</span>
                <span className="font-medium tabular-nums">{fmtCount(t.rows)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-[10px] border border-border-subtle p-3 mb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-main">Usage retention</p>
            <p className="text-xs text-text-muted">
              {retention?.days > 0
                ? `Rows older than ${retention.days} days are eligible for purge (${fmtCount(retention.purgeableRows)} now).`
                : "Retention window is 0 — usage is kept forever."}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={loading || !(retention?.purgeableRows > 0)}
            onClick={() => setPurgeOpen(true)}
            className="shrink-0"
          >
            Purge now
          </Button>
        </div>
      </div>

      {msg.message && (
        <p className={`text-xs sm:text-sm ${msg.type === "error" ? "text-red-500" : msg.type === "warn" ? "text-amber-600 dark:text-amber-400" : "text-success"}`}>
          {msg.message}
        </p>
      )}

      <Modal isOpen={purgeOpen} onClose={() => setPurgeOpen(false)} title="Purge old usage">
        <p className="text-sm text-text-muted mb-3">
          Removes usage history and request details older than the {retention?.days}-day window.
          This cannot be undone. A recent backup should hold the rows first.
        </p>
        <Input
          type="password"
          placeholder="Dashboard password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPurgeOpen(false)}>Cancel</Button>
          <Button variant="primary" disabled={loading || !password} onClick={purge}>
            {loading ? "Purging…" : `Purge ${fmtCount(retention?.purgeableRows)} rows`}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
