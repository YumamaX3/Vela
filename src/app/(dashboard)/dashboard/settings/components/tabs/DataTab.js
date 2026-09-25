"use client";
// Data — everything that moves this instance's state in or out.
//
// The old room split the two halves of one job across 1,600 lines: the export
// and import buttons sat in the top card, and the scheduled-backup ledger sat
// nine cards lower. They are the same question ("how do I get my state out, and
// is anything already keeping a copy?") so they now share one room.
//
// The wire is unchanged: the export leg still carries the operator's password in
// the `x-9r-password` header, the import leg still posts the parsed backup with
// the password in the body, and the confirm modal still gates both — a backup
// file is the whole database, so it is never moved on a single click.
import { useEffect, useRef, useState } from "react";
import { Button, Card, Input, Modal } from "@/shared/components";
import { exportDatabase, downloadBackup } from "../../lib/settingsApi";
import StatusLine from "../StatusLine";
import BackupCard from "../BackupCard";
import ImportBackupModal from "../ImportBackupModal";
import StorageCard from "../StorageCard";
import ArtifactsCard from "../ArtifactsCard";
import OffsiteCard from "../OffsiteCard";
import ExportCard from "../ExportCard";

export default function DataTab({ deck }) {
  const { reload } = deck;
  const fileRef = useRef(null);

  const [busy, setBusy] = useState(false);
  // Which leg is running, held separately from `busy`. The modal clears its own
  // `mode` before dispatching, so reading the spinner off `auth.mode` made the
  // export button spin during an import — a control reporting an operation it
  // was not performing.
  const [running, setRunning] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [auth, setAuth] = useState({ open: false, mode: "", password: "" });
  // A bump the cockpit cards share: a purge or a prune changes what the OTHER
  // cards should show, so one counter nudges them all to re-read.
  const [roomKey, setRoomKey] = useState(0);
  const refreshRoom = () => setRoomKey((k) => k + 1);
  // ONE census for the whole room: the off-site card reads this block rather
  // than asking the same endpoint a second time (two fetches, one truth).
  const [offsite, setOffsite] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/backup/inventory", { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (alive && res.ok && body.offsite) setOffsite(body.offsite);
      } catch {
        /* fail-open — the card falls back to its own read */
      }
    })();
    return () => { alive = false; };
  }, [roomKey]);

  const runExport = async (password) => {
    setBusy(true);
    setRunning("export");
    setStatus({ type: "", message: "" });
    try {
      const payload = await exportDatabase(password);
      downloadBackup(payload);
      setStatus({ type: "success", message: "Database backup downloaded" });
    } catch (err) {
      setStatus({ type: "error", message: err.message || "Failed to export database" });
    } finally {
      setBusy(false);
      setRunning("");
    }
  };

  // The import ceremony lives in ImportBackupModal now; this tab holds only
  // the picked file (name + parsed payload) and hands it over. Parsing here
  // means a malformed file is refused BEFORE any modal opens.
  const [importFile, setImportFile] = useState(null); // { name, payload }
  const onPickFile = (event) => {
    const file = event.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setStatus({ type: "", message: "" });
    file.text().then(
      (raw) => {
        try {
          const payload = JSON.parse(raw);
          setImportFile({ name: file.name, payload });
        } catch {
          setStatus({ type: "error", message: "That file is not valid JSON — not a Vela backup" });
        }
      },
      () => setStatus({ type: "error", message: "Could not read that file" })
    );
  };

  const closeImport = () => setImportFile(null);
  const finishImport = async (message) => {
    setImportFile(null);
    setStatus({ type: "success", message });
    try {
      await reload();
    } catch {
      /* the deck's own reload error path owns this */
    }
  };

  const confirmAuth = async () => {
    const { mode, password } = auth;
    setAuth({ open: false, mode: "", password: "" });
    if (mode === "export") await runExport(password);
  };

  return (
    <>
      <Card>
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 rounded-[10px] bg-brand-500/10 text-brand-500 shrink-0">
            <span className="material-symbols-outlined text-[20px] leading-none">database</span>
          </div>
          <div>
            <h3 className="text-text-main font-semibold">Manual backup</h3>
            <p className="text-sm text-text-muted mt-0.5">
              The full database as one JSON file — keys, usage, sessions and settings.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="secondary"
              icon="download"
              loading={running === "export"}
              onClick={() => setAuth({ open: true, mode: "export", password: "" })}
              className="w-full sm:w-auto"
            >
              Download Backup
            </Button>
            <Button
              variant="outline"
              icon="upload"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="w-full sm:w-auto"
            >
              Import Backup
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={onPickFile}
            />
          </div>

          <StatusLine status={status} />

          <p className="text-sm text-text-muted pt-4 border-t border-border-subtle">
            The location of this file on disk, and this instance&apos;s appearance, live under
            General.
          </p>
        </div>
      </Card>

      <ExportCard />
      <BackupCard onChanged={refreshRoom} />
      <StorageCard onChanged={refreshRoom} refreshKey={roomKey} />
      <ArtifactsCard onChanged={refreshRoom} refreshKey={roomKey} />
      <OffsiteCard data={offsite} refreshKey={roomKey} />
      {importFile && (
        <ImportBackupModal
          fileName={importFile.name}
          payload={importFile.payload}
          onClose={closeImport}
          onDone={finishImport}
        />
      )}
      <Modal
        isOpen={auth.open}
        onClose={() => setAuth({ open: false, mode: "", password: "" })}
        title="Confirm Password"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setAuth({ open: false, mode: "", password: "" })}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmAuth} loading={busy} disabled={!auth.password}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="text-text-muted mb-3 text-sm">
          Enter your current password to export the database.
        </p>
        <Input
          type="password"
          value={auth.password}
          onChange={(e) => setAuth((s) => ({ ...s, password: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && auth.password) confirmAuth();
          }}
          placeholder="Current password"
          autoFocus
        />
      </Modal>
    </>
  );
}
