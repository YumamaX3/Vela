"use client";

// The bulk bar — appears only with a selection, states the count, and offers
// exactly the operations the server's bulk route accepts. Rename and strategy
// open inline rather than in a modal, so the selection stays visible while the
// operator decides.
import { useState } from "react";
import { Button } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import { STRATEGY_OPTIONS } from "../lib/comboMeta";

export default function BulkActionBar({
  selected,
  busy,
  result,
  onClear,
  onSetStrategy,
  onDuplicate,
  onRename,
  onDelete,
  onCopy,
}) {
  const [panel, setPanel] = useState(null); // null | "strategy" | "rename"
  const [prefix, setPrefix] = useState("");
  const [nextPrefix, setNextPrefix] = useState("");

  if (!selected.length) return null;

  const names = selected.map((c) => c.name);

  return (
    <div className="pointer-events-none sticky bottom-3 z-30 flex justify-center motion-control">
      <div className="pointer-events-auto flex w-full max-w-3xl flex-col gap-2 rounded-[14px] border border-border-subtle bg-surface/95 px-3 py-2 shadow-[var(--shadow-elev)] backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
            <span className="tabular-nums">{selected.length}</span> selected
          </span>

          <Button size="sm" variant="ghost" icon="route" onClick={() => setPanel(panel === "strategy" ? null : "strategy")} disabled={busy}>
            Set strategy
          </Button>
          <Button size="sm" variant="ghost" icon="copy_all" onClick={onDuplicate} disabled={busy}>
            Duplicate
          </Button>
          <Button size="sm" variant="ghost" icon="drive_file_rename_outline" onClick={() => setPanel(panel === "rename" ? null : "rename")} disabled={busy}>
            Rename namespace
          </Button>
          <Button size="sm" variant="ghost" icon="content_copy" onClick={() => onCopy(names.join("\n"))} disabled={busy}>
            Copy names
          </Button>
          <Button size="sm" variant="ghost" icon="delete" onClick={onDelete} disabled={busy} className="text-red-600 dark:text-red-300">
            Delete
          </Button>

          <span className="ml-auto flex items-center gap-2">
            {busy && <span className="text-[11px] text-text-muted">Working…</span>}
            <button
              type="button"
              onClick={() => {
                setPanel(null);
                onClear();
              }}
              className="rounded p-1 text-text-muted motion-control hover:text-text-main"
              title="Clear selection"
              aria-label="Clear selection"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </span>
        </div>

        {panel === "strategy" && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2">
            <span className="text-[11px] text-text-muted">Apply to every selected combo:</span>
            {STRATEGY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onSetStrategy({ fallbackStrategy: option.value })}
                disabled={busy}
                className="rounded-md border border-border-subtle px-2 py-1 text-[11px] font-medium motion-control hover:border-primary/40 hover:text-primary"
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onSetStrategy({ judgeModel: "" })}
              disabled={busy}
              className="rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-muted motion-control hover:text-text-main"
              title="Clear any judge model on the selected combos"
            >
              Reset judge → Auto
            </button>
          </div>
        )}

        {panel === "rename" && (
          <form
            className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!prefix.trim() || !nextPrefix.trim()) return;
              onRename(prefix.trim(), nextPrefix.trim());
              setPanel(null);
            }}
          >
            <label className="flex items-center gap-1 text-[11px] text-text-muted">
              from
              <input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="vela/cc"
                className="w-36 rounded border border-border-subtle bg-bg px-1.5 py-1 font-mono text-[11px] text-text-main outline-none focus:border-primary/50"
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-text-muted">
              to
              <input
                value={nextPrefix}
                onChange={(e) => setNextPrefix(e.target.value)}
                placeholder="vela/claude"
                className="w-36 rounded border border-border-subtle bg-bg px-1.5 py-1 font-mono text-[11px] text-text-main outline-none focus:border-primary/50"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !prefix.trim() || !nextPrefix.trim()}
              className={cn(
                "rounded-md border border-border-subtle px-2 py-1 text-[11px] font-medium motion-control hover:border-primary/40 hover:text-primary",
                (!prefix.trim() || !nextPrefix.trim()) && "opacity-40"
              )}
            >
              Rename under prefix
            </button>
          </form>
        )}

        {result && (
          <p className="text-[11px] text-text-muted">
            <span className="tabular-nums text-text-main">{result.changed}</span> changed
            {result.skipped > 0 && <> · {result.skipped} skipped</>}
            {result.detail && <> — {result.detail}</>}
          </p>
        )}
      </div>
    </div>
  );
}
