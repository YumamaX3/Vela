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
import { useRef, useState } from "react";
import { Button, Card, Input, Modal } from "@/shared/components";
import { exportDatabase, importDatabase, downloadBackup } from "../../lib/settingsApi";
import StatusLine from "../StatusLine";
import BackupCard from "../BackupCard";

export default function DataTab({ deck }) {
  const { reload } = deck;
  const fileRef = useRef(null);
  const pendingFileRef = useRef(null);

  const [busy, setBusy] = useState(false);
  // Which leg is running, held separately from `busy`. The modal clears its own
  // `mode` before dispatching, so reading the spinner off `auth.mode` made the
  // export button spin during an import — a control reporting an operation it
  // was not performing.
  const [running, setRunning] = useState("");
  const [status, setStatus] = useState({ type: "", message: "" });
  const [auth, setAuth] = useState({ open: false, mode: "", password: "" });

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

  const runImport = async (password) => {
    const file = pendingFileRef.current;
    if (!file) return;
    setBusy(true);
    setRunning("import");
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);
      await importDatabase(payload, password);
      await reload();
      setStatus({ type: "success", message: "Database imported successfully" });
    } catch (err) {
      setStatus({ type: "error", message: err.message || "Invalid backup file" });
    } finally {
      pendingFileRef.current = null;
      setBusy(false);
      setRunning("");
    }
  };

  const onPickFile = (event) => {
    const file = event.target.files?.[0];
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    pendingFileRef.current = file;
    setStatus({ type: "", message: "" });
    setAuth({ open: true, mode: "import", password: "" });
  };

  const confirmAuth = async () => {
    const { mode, password } = auth;
    setAuth({ open: false, mode: "", password: "" });
    if (mode === "export") await runExport(password);
    else if (mode === "import") await runImport(password);
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

      <BackupCard />

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
          Enter your current password to {auth.mode === "export" ? "export" : "import"} the database.
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
