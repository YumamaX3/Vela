"use client";

// The quick-actions bar — the fleet's acts, always within reach (sealed plan
// §3.1 · W3, the persistent fleet quick-actions bar).
//
// WHY ALWAYS MOUNTED: the bar used to appear only when a selection existed, so
// the three fleet-level acts (Export, Import, Create Key) lived up in the
// masthead and the four per-selection acts lived down here — and an operator
// who scrolled to the fleet's bottom to pause a key then had to scroll back up
// to mint one. One bar, two modes, no second fetch path: when nothing is
// selected it offers the fleet acts and says what a selection would add; when a
// selection exists it shows the per-selection acts. Every act still routes
// through the deck's own mutation (which owns the confirm ceremony), so a batch
// pause and a row pause are the same code path with a different N.
import { useState } from "react";
import { Button, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";

export default function BulkActionBar({ deck, onCreateKey }) {
  const { selected, clearSelection, setActive, revoke, setCategory, openImport, exportFleet, busy, bulkVerdicts, clearBulkVerdicts } = deck;
  const [draftCategory, setDraftCategory] = useState("");

  const ids = [...selected];
  const hasSelection = ids.length > 0;

  // The last bulk run's refusals, BY NAME. The route has always answered one
  // verdict per key; the bar used to show only a count, so an operator running
  // a 40-key pause learned "38 applied, 2 refused" and never which two. A
  // partial success is shown as exactly that — the count and the reasons.
  const refusals = (bulkVerdicts || []).filter((r) => !r.ok);
  const applied = (bulkVerdicts || []).filter((r) => r.ok).length;

  const file = () => {
    const name = draftCategory.trim();
    if (!name) return;
    setCategory(ids, name);
    setDraftCategory("");
  };

  return (
    <div className="sticky bottom-4 z-30 mt-4">
      {bulkVerdicts && (
        <div className="mb-2 rounded-[12px] border border-border-subtle bg-surface/95 backdrop-blur px-3 py-2 shadow-lg">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">
              {translate("Last bulk run")}: {applied} {translate("applied")}
              {refusals.length > 0 ? `, ${refusals.length} ${translate("refused")}` : ""}
            </span>
            <div className="flex-1" />
            <button
              onClick={clearBulkVerdicts}
              className="motion-control opacity-70 hover:opacity-100"
              title={translate("Dismiss")}
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
          {refusals.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {refusals.map((r, i) => (
                <li key={i} className="text-2xs text-red-600 dark:text-red-400">
                  {r.name || translate("one key")}: {r.error || translate("refused")}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap rounded-[14px] border border-primary/30 bg-surface/95 backdrop-blur px-3 py-2.5 shadow-lg">
        {hasSelection ? (
          <>
            <span className="text-xs font-semibold text-primary whitespace-nowrap">
              {ids.length} {ids.length === 1 ? translate("key selected") : translate("keys selected")}
            </span>

            <div className="flex-1" />

            <Button size="sm" variant="outline" icon="block" disabled={busy} onClick={() => setActive(ids, false)}>
              {translate("Pause")}
            </Button>
            <Button size="sm" variant="outline" icon="check_circle" disabled={busy} onClick={() => setActive(ids, true)}>
              {translate("Resume")}
            </Button>

            <div className="flex items-center gap-1">
              <Input
                value={draftCategory}
                onChange={(e) => setDraftCategory(e.target.value)}
                placeholder={translate("File under…")}
                className="w-[150px]"
              />
              <Button size="sm" variant="outline" icon="label" disabled={busy || !draftCategory.trim()} onClick={file}>
                {translate("File")}
              </Button>
            </div>

            <Button size="sm" variant="danger" icon="delete" disabled={busy} onClick={() => revoke(ids)}>
              {translate("Revoke")}
            </Button>

            <span className="w-px h-6 bg-border mx-1" />

            <button
              onClick={exportFleet}
              className="p-2 rounded-[10px] text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 motion-control"
              title={translate("Export the fleet")}
            >
              <span className="material-symbols-outlined text-base">download</span>
            </button>
            <button
              onClick={openImport}
              className="p-2 rounded-[10px] text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 motion-control"
              title={translate("Import a fleet file")}
            >
              <span className="material-symbols-outlined text-base">file_upload</span>
            </button>
            <button
              onClick={clearSelection}
              className="p-2 rounded-[10px] text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 motion-control"
              title={translate("Clear selection")}
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-text-muted whitespace-nowrap">
              {translate("Select keys to pause, resume, file or revoke")}
            </span>

            <div className="flex-1" />

            <Button size="sm" variant="outline" icon="download" onClick={exportFleet}>
              {translate("Export")}
            </Button>
            <Button size="sm" variant="outline" icon="file_upload" onClick={openImport}>
              {translate("Import")}
            </Button>
            <Button size="sm" icon="add" onClick={onCreateKey}>
              {translate("Create Key")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
