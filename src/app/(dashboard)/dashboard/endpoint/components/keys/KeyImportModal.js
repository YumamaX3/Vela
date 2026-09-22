"use client";

// The import ceremony — and it is a ceremony on purpose.
//
// An import cannot restore a key. Keys are hash-at-rest and show-once, so every
// entry an import accepts is MINTED ANEW, and the operator must save the strings
// from the resulting response or the entries are dead on arrival. That fact is
// stated on the panel itself, not buried in a tooltip, because it is the single
// thing that determines whether this file is a backup or a liability.
//
// The dry run is the default and the gate: nothing is written until the operator
// has seen each entry's verdict and each collision's resolution. A plan that
// promised one name and a write that produced another would be a lie told at the
// exact moment trust was being extended.
import { useRef, useState } from "react";
import { Button, Modal, Select, Tooltip } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import { IMPORT_CONFLICT_OPTIONS } from "../../hooks/useKeyDeck";

const ACTION_TONE = {
  create: "text-emerald-600 dark:text-emerald-400",
  update: "text-amber-600 dark:text-amber-400",
  skip: "text-text-muted",
};

export default function KeyImportModal({ deck }) {
  const state = deck.importState;
  const fileRef = useRef(null);
  const [showAll, setShowAll] = useState(false);
  if (!state) return null;

  const summary = state.plan?.summary;
  const invalid = state.plan?.invalid || [];
  const plan = state.plan?.plan || [];
  const created = state.applied?.applied?.created || [];
  const applied = state.applied?.applied;

  const rows = showAll ? plan : plan.slice(0, 8);

  return (
    <Modal
      isOpen
      onClose={deck.closeImport}
      title={translate("Import keys")}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={deck.closeImport}>
            {translate("Close")}
          </Button>
          {!state.applied && (
            <Button
              icon="search"
              disabled={!state.envelope || state.busy}
              onClick={deck.previewImport}
            >
              {translate("Preview (writes nothing)")}
            </Button>
          )}
          {state.plan && !state.applied && (
            <Button
              variant="danger"
              icon="file_upload"
              disabled={state.busy || (summary && summary.create + summary.update === 0)}
              onClick={deck.applyImport}
            >
              {translate("Apply & mint")}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
            <span className="material-symbols-outlined text-[14px] mt-0.5">warning</span>
            <span>
              {translate("An import cannot restore a key. Every entry it accepts is minted anew, and the new strings appear in the result below exactly once — save them before you close this panel, or the entries are dead on arrival.")}
            </span>
          </p>
        </div>

        <div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => deck.loadImportFile(e.target.files?.[0])}
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" icon="file_upload" onClick={() => fileRef.current?.click()}>
              {translate("Choose a file")}
            </Button>
            <Button variant="outline" icon="download" onClick={deck.loadImportFromUrl}>
              {translate("Use this fleet's own export")}
            </Button>
            {state.fileName && (
              <span className="text-xs text-text-muted truncate max-w-[240px]">{state.fileName}</span>
            )}
          </div>
        </div>

        <Select
          label={translate("When a name already exists")}
          value={state.onConflict}
          onChange={(e) => deck.setImportState((prev) => ({ ...prev, onConflict: e.target.value, plan: null, applied: null }))}
          options={IMPORT_CONFLICT_OPTIONS.map((o) => ({ value: o.value, label: translate(o.label) }))}
          hint={translate("Overwrite updates the existing key's governance in place — it does not keep its old key string.")}
        />

        {state.error && (
          <p className="text-xs text-red-500">{state.error}</p>
        )}

        {summary && (
          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
            <p className="text-xs font-semibold mb-2">{translate("The plan")}</p>
            <div className="flex items-center gap-4 flex-wrap text-xs">
              <span className="text-emerald-600 dark:text-emerald-400">
                {summary.create} {translate("to mint")}
              </span>
              <span className="text-amber-600 dark:text-amber-400">
                {summary.update} {translate("to overwrite")}
              </span>
              <span className="text-text-muted">
                {summary.skip} {translate("skipped")}
              </span>
              {invalid.length > 0 && (
                <span className="text-red-500">
                  {summary.invalid} {translate("refused")}
                </span>
              )}
            </div>

            {plan.length > 0 && (
              <ul className="mt-3 space-y-1">
                {rows.map((row, i) => (
                  <li key={`${row.name}-${i}`} className="text-[11px] flex items-center gap-2">
                    <span className={`font-semibold w-[62px] shrink-0 ${ACTION_TONE[row.action] || ""}`}>
                      {row.action}
                    </span>
                    <span className="truncate">{row.name}</span>
                    {row.targetName && row.targetName !== row.name && (
                      <span className="text-text-muted truncate">→ {row.targetName}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {plan.length > 8 && (
              <button
                onClick={() => setShowAll((v) => !v)}
                className="text-[11px] text-primary mt-2 motion-control"
              >
                {showAll ? translate("Show fewer") : `${translate("Show all")} ${plan.length}`}
              </button>
            )}

            {invalid.length > 0 && (
              <ul className="mt-3 space-y-1">
                {invalid.map((row, i) => (
                  <li key={`${row.name || "entry"}-${i}`} className="text-[11px] text-red-500">
                    <span className="truncate">{row.name || translate("unnamed entry")}</span>
                    <span className="text-text-muted"> — {row.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {applied && (
          <div className="rounded-[10px] border border-emerald-500/30 bg-emerald-500/5 p-3">
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-2">
              {applied.changed} {applied.changed === 1 ? translate("key changed") : translate("keys changed")}
            </p>

            {created.length > 0 && (
              <>
                <p className="text-[11px] text-text-muted mb-1">
                  {translate("These strings are shown once. Copy them now.")}
                </p>
                <ul className="space-y-1.5">
                  {created.map((entry) => (
                    <li key={entry.keyId} className="flex items-center gap-2">
                      <span className="text-[11px] text-text-muted w-[110px] truncate shrink-0" title={entry.name}>
                        {entry.name}
                      </span>
                      <Tooltip text={translate("Copy this key")}>
                        <button
                          onClick={() => deck.copy(entry.key, entry.keyId)}
                          className="inline-flex items-center gap-1 text-[11px] font-mono bg-surface border border-border rounded px-2 py-1 hover:border-primary/50 motion-control"
                        >
                          <span className="material-symbols-outlined text-[13px]">
                            {deck.copied === entry.keyId ? "check" : "content_copy"}
                          </span>
                          {entry.key}
                        </button>
                      </Tooltip>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => deck.copy(created.map((c) => `${c.name}: ${c.key}`).join("\n"), "__all_import__")}
                  className="text-[11px] text-primary mt-2 motion-control"
                >
                  {translate("Copy all as name: key lines")}
                </button>
              </>
            )}

            {applied.results?.some((r) => !r.ok) && (
              <ul className="mt-3 space-y-1">
                {applied.results.filter((r) => !r.ok).map((r, i) => (
                  <li key={`${r.name}-${i}`} className="text-[11px] text-red-500">
                    <span className="truncate">{r.name}</span>
                    <span className="text-text-muted"> — {r.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
