"use client";

// Storage Covenant Wave B4 — the dashboard Backup card.
// Policy is env-only (VELA_BACKUP_*); this card surfaces status, triggers
// run/restore/drill through /api/backup/*, and lists the ledger (metadata
// only — never artifact bytes, never keys). S4: every mutating action
// re-confirms the dashboard password inside lockout accounting.
import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input } from "@/shared/components";
import Modal, { ConfirmModal } from "@/shared/components/Modal";

function fmtBytes(n) {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupCard() {
  const [status, setStatus] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [drillOpen, setDrillOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [adoptSecrets, setAdoptSecrets] = useState(false);
  const [backupId, setBackupId] = useState("");
  const [msg, setMsg] = useState({ type: "", message: "" });

  const refresh = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([
        fetch("/api/backup/status").then((r) => r.json()),
        fetch("/api/backup/list?limit=8").then((r) => r.json()),
      ]);
      if (s && !s.error) setStatus(s);
      if (l?.entries) setLedger(l.entries);
    } catch { /* fail-open — the card never breaks the page */ }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const act = async (path, body, successMsg) => {
    setLoading(true);
    setMsg({ type: "", message: "" });
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ type: "error", message: data.error || "Operation failed" });
        return;
      }
      setMsg({ type: "success", message: data.message || successMsg });
      setPassword("");
      setAdoptSecrets(false);
      await refresh();
    } catch (e) {
      setMsg({ type: "error", message: e?.message || "Operation failed" });
    } finally {
      setLoading(false);
    }
  };

  const enabled = status?.enabled === true;

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">backup</span>
        </div>
        <h3 className="text-base sm:text-lg font-semibold">Backup</h3>
        {status?.degraded && (
          <span className="ml-auto text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-500">degraded</span>
        )}
      </div>

      {/* Status row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-xs sm:text-sm">
        <div>
          <p className="text-text-muted">Enabled</p>
          <p className="font-medium">{enabled ? "on" : "off (env)"}</p>
        </div>
        <div>
          <p className="text-text-muted">Interval</p>
          <p className="font-medium">{status ? `${status.intervalHours}h` : "—"}</p>
        </div>
        <div>
          <p className="text-text-muted">Last run</p>
          <p className="font-medium">
            {status?.lastResult?.ok
              ? status.lastResult.artifactId
                ? status.lastResult.at?.slice(0, 19).replace("T", " ")
                : "ok"
              : status?.lastResult ? "failed" : "never"}
          </p>
        </div>
        <div>
          <p className="text-text-muted">Next run</p>
          <p className="font-medium">{status?.nextRunAt ? status.nextRunAt.slice(0, 19).replace("T", " ") : "—"}</p>
        </div>
      </div>

      {!enabled && (
        <p className="text-xs text-text-muted mb-3">
          Backups are off. Set <code className="bg-bg-tertiary px-1 rounded">VELA_BACKUP_ENABLED=true</code> and{" "}
          <code className="bg-bg-tertiary px-1 rounded">VELA_BACKUP_ENCRYPTION_KEY</code> in the environment to enable
          the scheduled engine. Manual run/restore/drill work regardless.
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={loading} onClick={() => setRunOpen(true)}>
          <span className="material-symbols-outlined text-[16px] mr-1">upload_file</span>
          Backup now
        </Button>
        <Button variant="secondary" disabled={loading} onClick={() => setRestoreOpen(true)}>
          <span className="material-symbols-outlined text-[16px] mr-1">restore</span>
          Restore
        </Button>
        <Button variant="secondary" disabled={loading} onClick={() => setDrillOpen(true)}>
          <span className="material-symbols-outlined text-[16px] mr-1">fact_check</span>
          Restore drill
        </Button>
      </div>

      {msg.message && (
        <p className={`text-xs sm:text-sm pt-2 ${msg.type === "error" ? "text-red-500" : "text-green-500"}`}>
          {msg.message}
        </p>
      )}

      {/* Ledger */}
      {ledger.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-muted border-b border-border/50">
                <th className="py-1 pr-2">When</th>
                <th className="py-1 pr-2">Kind</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2">Artifact</th>
                <th className="py-1">Size</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((row) => (
                <tr key={row.id} className="border-b border-border/30">
                  <td className="py-1 pr-2 whitespace-nowrap">{row.createdAt?.slice(0, 19).replace("T", " ")}</td>
                  <td className="py-1 pr-2">{row.kind}</td>
                  <td className={`py-1 pr-2 ${row.status === "ok" ? "text-green-500" : "text-red-500"}`}>{row.status}</td>
                  <td className="py-1 pr-2 max-w-[180px] truncate">{row.artifactId || "—"}</td>
                  <td className="py-1">{fmtBytes(row.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Run-now modal */}
      <Modal
        isOpen={runOpen}
        onClose={() => setRunOpen(false)}
        title="Backup now"
      >
        <p className="text-sm text-text-muted mb-3">
          Runs an immediate encrypted backup. Re-enter the dashboard password to confirm.
        </p>
        <Input
          type="password"
          placeholder="Dashboard password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRunOpen(false)}>Cancel</Button>
          <Button disabled={loading || !password} onClick={() => { setRunOpen(false); act("/api/backup/run", { password }, "Backup complete"); }}>
            {loading ? "Running…" : "Backup"}
          </Button>
        </div>
      </Modal>

      {/* Restore modal — S1 trust crossing */}
      <Modal
        isOpen={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        title="Restore from backup"
      >
        <p className="text-sm text-text-muted mb-3">
          Restores the newest artifact. A pre-restore safety backup is taken first. The current
          password and auth settings are preserved unless you explicitly adopt them from the artifact.
        </p>
        <Input
          type="password"
          placeholder="Dashboard password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3"
        />
        <label className="flex items-center gap-2 text-sm mb-1">
          <input type="checkbox" checked={adoptSecrets} onChange={(e) => setAdoptSecrets(e.target.checked)} />
          Adopt secrets from the artifact (password, auth mode, key hashes)
        </label>
        {adoptSecrets && (
          <p className="text-xs text-red-500 mb-3">
            ⚠ This crosses the trust boundary — the restored artifact&apos;s password hash and auth
            settings REPLACE the current ones. A restart is required afterwards. Only do this when
            you trust the artifact&apos;s origin.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRestoreOpen(false)}>Cancel</Button>
          <Button
            disabled={loading || !password}
            onClick={() => {
              setRestoreOpen(false);
              act(
                "/api/backup/restore",
                { password, backupId: backupId || undefined, adoptSecrets, confirmSecrets: adoptSecrets },
                "Restore complete"
              );
            }}
          >
            {loading ? "Restoring…" : "Restore"}
          </Button>
        </div>
      </Modal>

      {/* Drill modal */}
      <ConfirmModal
        isOpen={drillOpen}
        onClose={() => setDrillOpen(false)}
        title="Run restore drill"
        message="Decrypts the newest backup into a scratch database and smoke-checks it. The live database is never touched. Continue?"
        confirmText="Drill"
        onConfirm={() => { setDrillOpen(false); act("/api/backup/drill", {}, "Drill complete"); }}
      />
    </Card>
  );
}
