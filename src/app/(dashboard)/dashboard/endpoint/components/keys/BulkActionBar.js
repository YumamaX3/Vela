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
  const { selected, clearSelection, setActive, revoke, setCategory, openImport, exportFleet, busy } = deck;
  const [draftCategory, setDraftCategory] = useState("");

  const ids = [...selected];
  if (ids.length === 0) return null;

  const file = () => {
    const name = draftCategory.trim();
    if (!name) return;
    setCategory(ids, name);
    setDraftCategory("");
  };

  return (
    <div className="sticky bottom-4 z-30 mt-4">
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
