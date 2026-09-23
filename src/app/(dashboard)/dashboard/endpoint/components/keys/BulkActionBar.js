"use client";

// The bulk bar — the acts that only make sense across a selection.
//
// It appears the moment one key is selected and states the count, so an
// operator always knows the blast radius before pressing anything. Every action
// routes through the deck's own mutation (which owns the confirm ceremony), so
// a batch pause and a row pause are the same code path with a different N.
import { useState } from "react";
import { Button, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";

export default function BulkActionBar({ deck }) {
  const { selected, clearSelection, setActive, revoke, setCategory, openImport, exportFleet, busy, bulkVerdicts, clearBulkVerdicts } = deck;
  const [draftCategory, setDraftCategory] = useState("");

  const ids = [...selected];
  if (ids.length === 0) return null;
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
            <span className="text-xs font-semibold">
              {applied} {translate("applied")}
              {refusals.length > 0 && ` \u00b7 ${refusals.length} ${translate("refused")}`}
            </span>
            <span className="flex-1" />
            <button
              onClick={clearBulkVerdicts}
              className="motion-control text-text-muted hover:text-text-main"
              title={translate("Dismiss")}
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
          {refusals.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {refusals.map((r) => (
                <li key={r.id || r.name} className="text-[11px] text-red-600 dark:text-red-400">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-text-muted"> \u2014 {r.error || translate("refused")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap rounded-[14px] border border-primary/30 bg-surface/95 backdrop-blur px-3 py-2.5 shadow-lg">
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
          <span className="material-symbols-outlined text-[16px]">download</span>
        </button>
        <button
          onClick={openImport}
          className="p-2 rounded-[10px] text-text-muted hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 motion-control"
          title={translate("Import a fleet file")}
        >
          <span className="material-symbols-outlined text-[16px]">file_upload</span>
        </button>
        <button
          onClick={clearSelection}
          className="p-2 rounded-[10px] text-text-muted hover:text-text-main hover:bg-black/5 dark:hover:bg-white/5 motion-control"
          title={translate("Clear selection")}
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      </div>
    </div>
  );
}
