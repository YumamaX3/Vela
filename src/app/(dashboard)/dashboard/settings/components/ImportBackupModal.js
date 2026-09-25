"use client";
// ImportBackupModal — the selective-import ceremony.
//
// A backup file is the whole database, but an operator should not have to
// restore the whole database to move one part of it. This modal is the
// ceremony the keys room already established (dry-run gate, then apply),
// widened to the seven sections of a database backup:
//
//   1. SELECT — the file's contents, counted per section, checkboxes for what
//      to move. Client-side counts give immediate feedback; the server's
//      dry-run plan is the authoritative answer.
//   2. REVIEW — the server plan (dryRun: true — NOTHING is written), plus
//      the file's provenance and the adopt-secrets warning if enabled.
//   3. APPLY — the same sections re-sent with dryRun: false.
//
// The honest limits, stated on the panel itself:
//   • each SELECTED section is REPLACED — its existing rows are removed and
//     refilled from the file; unselected sections are untouched;
//   • quarantined secrets (dashboard password, SSO config, key hashes) stay
//     with the CURRENT instance unless "adopt secrets" is explicitly enabled;
//   • an imported key without its hash cannot authenticate — the hash crosses
//     only under "adopt secrets", and the file must have carried it.
//
// The section map is imported from src/lib/db/repos/backupSecurity.js — the
// SAME source the engine reads — so this checklist can never name a section
// the engine does not know, nor omit one it restores.
import { useMemo, useState } from "react";
import { Button, Input, Modal, Toggle } from "@/shared/components";
import { importDatabaseWithOptions } from "../lib/settingsApi";
import { IMPORT_SECTIONS, IMPORT_SECTION_FIELDS } from "@/lib/db/repos/backupSecurity.js";

const SECTION_META = {
  settings: { label: "Settings", description: "Dashboard settings and preferences", icon: "settings" },
  connections: { label: "Connections", description: "Provider connections and nodes", icon: "link" },
  pools: { label: "Proxy pools", description: "Proxy pool definitions", icon: "shield" },
  keys: { label: "API keys", description: "Key entries and governance; key strings cannot be restored", icon: "key" },
  combos: { label: "Combos", description: "Model combos", icon: "call_merge" },
  kv: { label: "Models & pricing", description: "Aliases, custom models, pricing, disabled models", icon: "tune" },
  usage: { label: "Usage data", description: "Usage history, daily aggregates, request logs", icon: "monitoring" },
};

/** Client-side first look: how many items the file carries per section. The
 *  server's dry run answers the same question authoritatively in step 2. */
function countFileSections(payload) {
  const counts = {};
  for (const section of IMPORT_SECTIONS) {
    let count = 0;
    for (const field of IMPORT_SECTION_FIELDS[section] || []) {
      const value = payload?.[field];
      if (Array.isArray(value)) count += value.length;
      else if (value && typeof value === "object") count += Object.keys(value).length;
    }
    counts[section] = count;
  }
  return counts;
}

export default function ImportBackupModal({ fileName, payload, busy, onClose, onDone }) {
  const [step, setStep] = useState("select"); // select → review → done
  const [selected, setSelected] = useState(() => new Set(IMPORT_SECTIONS));
  const [adoptSecrets, setAdoptSecrets] = useState(false);
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const fileCounts = useMemo(() => countFileSections(payload), [payload]);
  const carriedSections = IMPORT_SECTIONS.filter((s) => fileCounts[s] > 0);
  const hasSelection = selected.size > 0;
  const meta = payload?._meta ?? null;
  const toggleSection = (section) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };
  const analyze = async () => {
    setWorking(true);
    setError("");
    try {
      const res = await importDatabaseWithOptions(payload, password, {
        sections: [...selected],
        dryRun: true,
      });
      setPlan(res.plan || []);
      setStep("review");
    } catch (err) {
      setError(err.message || "Could not analyze this backup file");
    } finally {
      setWorking(false);
    }
  };
  const apply = async () => {
    setWorking(true);
    setError("");
    try {
      const res = await importDatabaseWithOptions(payload, password, {
        sections: [...selected],
        dryRun: false,
        adoptSecrets,
      });
      const moved = res.appliedSections?.length ?? 0;
      onDone(`Imported ${moved} section${moved === 1 ? "" : "s"} (${res.appliedSections?.join(", ") || "none"})`);
    } catch (err) {
      setError(err.message || "Import failed");
      setWorking(false);
    }
  };
  const planRow = (section) => plan?.find((p) => p.section === section);
  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Import backup"
      size="lg"
      footer={
        step === "select" ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={working || busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon="fact_check"
              onClick={analyze}
              loading={working}
              disabled={!hasSelection || !password}
            >
              Review Import
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => { setStep("select"); setPlan(null); }} disabled={working}>
              Back
            </Button>
            <Button variant="primary" icon="upload" onClick={apply} loading={working}>
              Apply Import
            </Button>
          </div>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-sm">
          <span className="material-symbols-outlined text-[18px] text-text-muted">description</span>
          <span className="text-text-main font-medium truncate" title={fileName}>{fileName}</span>
          {meta?.exportedAt && (
            <span className="text-xs text-text-muted shrink-0">
              exported {new Date(meta.exportedAt).toLocaleString()}
            </span>
          )}
        </div>

        {step === "select" && (
          <>
            <p className="text-sm text-text-muted">
              Choose what this import replaces. Each selected section&apos;s current data is
              removed and refilled from the file; sections you leave unchecked are untouched.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-muted">
                {carriedSections.length} of {IMPORT_SECTIONS.length} sections present in this file
              </span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(IMPORT_SECTIONS))}>
                  All
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  None
                </Button>
              </div>
            </div>
            <div className="flex flex-col rounded-[10px] border border-border-subtle overflow-hidden">
              {IMPORT_SECTIONS.map((section, index) => {
                const info = SECTION_META[section];
                const count = fileCounts[section];
                const inFile = count > 0;
                return (
                  <label
                    key={section}
                    className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer motion-control hover:bg-surface-2 ${index > 0 ? "border-t border-border-subtle" : ""} ${!inFile ? "opacity-50" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--color-brand-500,#E56A4A)] w-4 h-4 shrink-0"
                      checked={selected.has(section)}
                      disabled={!inFile}
                      onChange={() => toggleSection(section)}
                    />
                    <span className="material-symbols-outlined text-[18px] text-text-muted shrink-0">{info.icon}</span>
                    <span className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm text-text-main font-medium">{info.label}</span>
                      <span className="text-xs text-text-muted truncate">{info.description}</span>
                    </span>
                    <span className={`text-xs shrink-0 ${inFile ? "text-text-muted" : "text-text-muted/60"}`}>
                      {inFile ? `${count} item${count === 1 ? "" : "s"}` : "not in file"}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="pt-1">
              <Toggle
                size="sm"
                checked={adoptSecrets}
                onChange={setAdoptSecrets}
                label="Adopt secrets from this file"
                description="Restores quarantined fields: dashboard password, SSO config, key hashes. Off keeps this instance's current secrets."
              />
            </div>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && password && hasSelection) analyze();
              }}
              placeholder="Current password"
            />
          </>
        )}

        {step === "review" && (
          <>
            <p className="text-sm text-text-muted">
              The plan below was verified against the file; nothing has been written yet.
              Applying will replace the selected sections.
            </p>
            <div className="flex flex-col rounded-[10px] border border-border-subtle overflow-hidden">
              {[...selected].map((section) => {
                const info = SECTION_META[section];
                const row = planRow(section);
                return (
                  <div key={section} className="flex items-center gap-3 px-3 py-2.5 border-t border-border-subtle first:border-t-0">
                    <span className="material-symbols-outlined text-[18px] text-text-muted shrink-0">{info.icon}</span>
                    <span className="text-sm text-text-main font-medium flex-1">{info.label}</span>
                    <span className="text-xs text-text-muted">
                      {row ? `${row.items} item${row.items === 1 ? "" : "s"}` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
            {adoptSecrets && (
              <p className="flex items-start gap-2 text-xs rounded-md p-3 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <span className="material-symbols-outlined text-[16px] shrink-0">warning</span>
                Secrets from this file will REPLACE this instance&apos;s dashboard password, SSO
                configuration and key hashes. A restart is required before sessions are trusted again.
              </p>
            )}
          </>
        )}

        {error && (
          <p className="flex items-start gap-2 text-xs rounded-md p-3 bg-red-500/10 text-red-500">
            <span className="material-symbols-outlined text-[16px] shrink-0">error</span>
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
