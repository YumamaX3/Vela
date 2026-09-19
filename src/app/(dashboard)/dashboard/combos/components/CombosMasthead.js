"use client";

// Masthead — the deck's title and its four doors: import, export, reload, new.
import { Button } from "@/shared/components";

export default function CombosMasthead({ hasAny, loading, onNew, onReload, onImportClick }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">Combos</h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Group models under one name, set a strategy per combo, then call it like any model.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon="upload"
          variant="ghost"
          size="sm"
          onClick={onImportClick}
          title="Import combos from a JSON export — previewed before anything lands"
        >
          Import
        </Button>
        <a
          href="/api/combos/export"
          download
          title="Export every combo, with its strategies, as JSON"
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
            hasAny ? "text-text-muted hover:text-primary" : "pointer-events-none opacity-40 text-text-muted"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
            download
          </span>
          Export
        </a>
        <Button
          icon="refresh"
          variant="ghost"
          size="sm"
          onClick={onReload}
          disabled={loading}
          title="Reload the fleet"
        >
          Reload
        </Button>
        <Button icon="add" onClick={onNew} className="whitespace-nowrap">
          New combo
        </Button>
      </div>
    </div>
  );
}
