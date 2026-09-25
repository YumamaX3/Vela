"use client";
// ArtifactsCard — every sealed backup on disk, and proof it still opens.
//
// The room has always shown a ledger of what the engine DID; it has never shown
// the artifacts themselves, nor answered the only question that matters about a
// backup — does it still decrypt? This card lists each sealed artifact (read
// from its unencrypted header, no key needed) and verifies one on demand
// (openArtifact's GCM tag check + a section census), so "a backup never
// restored is a hope" becomes a button an operator can press.
//
// Prune is a MUTATION: password re-confirm inside lockout accounting, and a
// dry run FIRST — the operator sees which artifacts would leave the disk before
// any of them do.
import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input } from "@/shared/components";
import Modal from "@/shared/components/Modal";
import { fmtBytes, fmtWhen } from "../lib/formatBytes";

export default function ArtifactsCard({ onChanged, refreshKey }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [verify, setVerify] = useState(null); // { id, result, error, busy }
  const [pruneOpen, setPruneOpen] = useState(false);
  const [plan, setPlan] = useState(null);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState({ type: "", message: "" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/backup/artifacts", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.artifacts) setArtifacts(body.artifacts);
    } catch {
      /* fail-open */
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh, refreshKey]);

  const runVerify = async (id) => {
    setVerify({ id, busy: true, result: null, error: "" });
    try {
      const res = await fetch(`/api/backup/artifacts?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setVerify({ id, busy: false, result: null, error: body.error || "Verification failed" });
      else setVerify({ id, busy: false, result: body, error: "" });
    } catch (e) {
      setVerify({ id, busy: false, result: null, error: e?.message || "Verification failed" });
    }
  };

  const openPrune = async () => {
    setPruneOpen(true);
    setPlan(null);
    setMsg({ type: "", message: "" });
  };

  const post = async (path, body) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, body: await res.json().catch(() => ({})) };
  };

  const loadPlan = async () => {
    setLoading(true);
    try {
      const { ok, body } = await post("/api/backup/prune", { password, dryRun: true });
      if (!ok) setMsg({ type: "error", message: body.error || "Could not plan the prune" });
      else setPlan(body);
    } finally {
      setLoading(false);
    }
  };

  const applyPrune = async () => {
    setLoading(true);
    try {
      const { ok, body } = await post("/api/backup/prune", { password });
      if (!ok) {
        setMsg({ type: "error", message: body.error || "Prune failed" });
      } else {
        setMsg({ type: "success", message: body.message || "Prune complete" });
        setPassword("");
        setPruneOpen(false);
        setPlan(null);
        await refresh();
        onChanged?.();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">inventory_2</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Backup artifacts</h3>
          <p className="text-xs text-text-muted">
            Sealed backups on disk. Verify one to prove it still restores.
          </p>
        </div>
        <Button variant="outline" className="ml-auto shrink-0" disabled={loading} onClick={openPrune}>
          Prune
        </Button>
      </div>

      {artifacts.length === 0 ? (
        <p className="text-sm text-text-muted">
          No sealed artifacts yet. Run a backup to create one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="text-left text-text-muted border-b border-border-subtle">
                <th className="py-1.5 pr-3 font-medium">Created</th>
                <th className="py-1.5 pr-3 font-medium">Trigger</th>
                <th className="py-1.5 pr-3 font-medium">Schema</th>
                <th className="py-1.5 pr-3 font-medium">Size</th>
                <th className="py-1.5 font-medium sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {artifacts.map((a) => (
                <tr key={a.id} className="border-b border-border-subtle/60 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap">{fmtWhen(a.created || a.modifiedAt)}</td>
                  <td className="py-1.5 pr-3">{a.trigger || "—"}</td>
                  <td className="py-1.5 pr-3">
                    {a.schemaVersion ?? "—"}
                    {!a.headerOk && <span className="ml-2 text-amber-600 dark:text-amber-400">header unreadable</span>}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{fmtBytes(a.bytes)}</td>
                  <td className="py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={verify?.id === a.id && verify.busy}
                      onClick={() => runVerify(a.id)}
                    >
                      {verify?.id === a.id && verify.busy ? "Verifying…" : "Verify"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {verify?.result && (
        <div className="mt-3 rounded-[10px] p-3 bg-surface-2">
          <p className="flex items-center gap-2 text-sm text-success mb-2">
            <span className="material-symbols-outlined text-[18px]">verified</span>
            Verified — this artifact decrypts and carries data
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            {Object.entries(verify.result.sections || {}).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-text-muted">{k}</span>
                <span className="font-medium tabular-nums">{v}</span>
              </div>
            ))}
          </div>
          {verify.result.secretBundleFiles?.length > 0 && (
            <p className="text-xs text-text-muted mt-2">
              Secret bundle: {verify.result.secretBundleFiles.join(", ")} — a restore returns restartRequired.
            </p>
          )}
        </div>
      )}
      {verify?.error && (
        <p className="mt-3 text-xs sm:text-sm text-red-500">{verify.error}</p>
      )}

      {msg.message && (
        <p className={`mt-3 text-xs sm:text-sm ${msg.type === "error" ? "text-red-500" : "text-success"}`}>
          {msg.message}
        </p>
      )}

      <Modal isOpen={pruneOpen} onClose={() => setPruneOpen(false)} title="Prune old artifacts">
        <p className="text-sm text-text-muted mb-3">
          Retention keeps the newest artifact per day (7 days) and the newest per ISO week (4 weeks).
          Plan it first to see exactly what would be removed.
        </p>
        <Input
          type="password"
          placeholder="Dashboard password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3"
        />
        {plan && (
          <div className="mb-3 rounded-[10px] p-3 bg-surface-2 text-xs">
            <p className="text-text-main font-medium mb-1">
              {plan.remove?.length ? `${plan.remove.length} artifact(s) would be pruned, ${plan.kept} kept` : "Nothing to prune"}
            </p>
            {plan.remove?.length > 0 && (
              <ul className="text-text-muted space-y-0.5 max-h-32 overflow-y-auto">
                {plan.remove.map((id) => (
                  <li key={id} className="truncate" title={id}>{id}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPruneOpen(false)}>Cancel</Button>
          {!plan ? (
            <Button variant="secondary" disabled={loading || !password} onClick={loadPlan}>
              {loading ? "Planning…" : "Plan prune"}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={loading || !password || (plan.remove?.length ?? 0) === 0}
              onClick={applyPrune}
            >
              {loading ? "Pruning…" : `Prune ${plan.remove.length}`}
            </Button>
          )}
        </div>
      </Modal>
    </Card>
  );
}
