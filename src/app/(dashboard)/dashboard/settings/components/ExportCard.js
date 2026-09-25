"use client";
// ExportCard — the export studio: take this instance's state OUT.
//
// Three exports, each with its own honest shape:
//   • DATABASE — the seven sections, selectable. A section-projected file is
//     importable by the same `sections` vocabulary the import ceremony uses
//     (one vocabulary, both doors). Password re-confirm: a database file is
//     the whole state, so it is never handed out on a single click.
//   • API KEYS — the fleet's GOVERNANCE as JSON. Key strings cannot be
//     exported (hash-at-rest, show-once); this file mints new keys on import.
//   • USAGE — the Observatory ledger as CSV, windowed by the same periods the
//     analytics room knows (today…all).
//
// The two direct downloads ride a real <a download> wearing the Button skin,
// NOT a <button> nested inside an <a> (that is invalid HTML and a keyboard
// trap) — the browser's own download UI and the server's Content-Disposition
// filename are what the operator sees. The database leg posts its password in
// a header, never the URL.
import { useState } from "react";
import { Card, Button, Input, Modal, Select } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { exportDatabaseSections, downloadBackup } from "../lib/settingsApi";

const SECTIONS = [
  { id: "settings", label: "Settings" },
  { id: "connections", label: "Connections" },
  { id: "pools", label: "Proxy pools" },
  { id: "keys", label: "API keys" },
  { id: "combos", label: "Combos" },
  { id: "kv", label: "Models & pricing" },
  { id: "usage", label: "Usage data" },
];

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "60d", label: "Last 60 days" },
  { value: "all", label: "All time" },
];

// The Button skin, worn by an <a> — one visual language, valid markup.
const ANCHOR_BTN = "inline-flex items-center justify-center gap-2 font-semibold motion-control cursor-pointer active:scale-[0.97] h-9 px-4 text-sm rounded-[10px] bg-surface-2 hover:bg-surface-3 text-text-main border border-border";

export default function ExportCard() {
  const [dbOpen, setDbOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [selected, setSelected] = useState(() => new Set(SECTIONS.map((s) => s.id)));
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ type: "", message: "" });
  const [period, setPeriod] = useState("30d");

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = selected.size === SECTIONS.length;

  const runDatabaseExport = async () => {
    setBusy("db");
    setMsg({ type: "", message: "" });
    try {
      const payload = await exportDatabaseSections(password, allSelected ? null : [...selected]);
      downloadBackup(payload);
      setMsg({ type: "success", message: allSelected ? "Full database downloaded" : `Downloaded ${selected.size} section(s)` });
      setDbOpen(false);
      setPassword("");
    } catch (err) {
      setMsg({ type: "error", message: err.message || "Export failed" });
    } finally {
      setBusy("");
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-brand-500/10 text-brand-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">download</span>
        </div>
        <div className="min-w-0">
          <h3 className="text-base sm:text-lg font-semibold">Export</h3>
          <p className="text-xs text-text-muted">
            Take this instance&apos;s state out — as a database file, a key catalogue, or a usage ledger.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border-subtle p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-main">Database</p>
            <p className="text-xs text-text-muted">The whole state, or only the sections you pick. Importable as-is.</p>
          </div>
          <Button variant="secondary" className="shrink-0" onClick={() => setDbOpen(true)}>
            Export
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-border-subtle p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-main">API keys</p>
            <p className="text-xs text-text-muted">Governance only — key strings are hash-at-rest and cannot be exported.</p>
          </div>
          <a href="/api/keys/export" download className={cn(ANCHOR_BTN, "shrink-0")}>
            <span className="material-symbols-outlined text-[18px]">download</span>
            Export
          </a>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-[10px] border border-border-subtle p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-main">Usage ledger (CSV)</p>
            <p className="text-xs text-text-muted">The Observatory ledger for a window, formula-safe.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              options={PERIODS}
              aria-label="Usage export window"
              className="w-[150px]"
            />
            <a href={`/api/usage/metrics/export?period=${period}`} download className={ANCHOR_BTN}>
              <span className="material-symbols-outlined text-[18px]">download</span>
              Export
            </a>
          </div>
        </div>
      </div>

      {msg.message && (
        <p className={`mt-3 text-xs sm:text-sm ${msg.type === "error" ? "text-red-500" : "text-success"}`}>
          {msg.message}
        </p>
      )}

      <Modal isOpen={dbOpen} onClose={() => setDbOpen(false)} title="Export database">
        <p className="text-sm text-text-muted mb-3">
          Choose what to include. A file exported with a selection can be re-imported with the same
          selection. Enter your dashboard password to confirm.
        </p>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-text-muted">{selected.size} of {SECTIONS.length} sections</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(SECTIONS.map((s) => s.id)))}>All</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>None</Button>
          </div>
        </div>
        <div className="flex flex-col rounded-[10px] border border-border-subtle overflow-hidden mb-3">
          {SECTIONS.map((s, i) => (
            <label
              key={s.id}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer motion-control hover:bg-surface-2 ${i > 0 ? "border-t border-border-subtle" : ""}`}
            >
              <input
                type="checkbox"
                className="accent-[var(--color-brand-500,#E56A4A)] w-4 h-4 shrink-0"
                checked={selected.has(s.id)}
                onChange={() => toggle(s.id)}
              />
              <span className="text-sm text-text-main">{s.label}</span>
            </label>
          ))}
        </div>
        <Input
          type="password"
          placeholder="Dashboard password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-3"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDbOpen(false)}>Cancel</Button>
          <Button
            variant="primary"
            icon="download"
            disabled={busy === "db" || !password || selected.size === 0}
            onClick={runDatabaseExport}
          >
            {busy === "db" ? "Exporting…" : "Export"}
          </Button>
        </div>
      </Modal>
    </Card>
  );
}
