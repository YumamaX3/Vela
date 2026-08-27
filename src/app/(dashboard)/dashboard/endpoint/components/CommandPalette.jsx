"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { translate } from "@/i18n/runtime";

/**
 * CommandPalette — ⌘K / ctrl+K quick-navigation for the Observatory. Pure
 * client; no new dependencies. Every command is a facet patch (tab/status/q)
 * or a page action (create key, sweep, export). Keyboard-nav: ↑/↓ to move,
 * Enter to run, Esc to close. Filtered live by the query.
 */
export default function CommandPalette({ open, onClose, onRunCommand, commands }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  const list = useMemo(() => {
    if (!Array.isArray(commands)) return [];
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      (c.label || "").toLowerCase().includes(q) ||
      (c.hint || "").toLowerCase().includes(q)
    );
  }, [commands, query]);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Focus the input after the panel mounts.
      const t = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Global hotkey — only attached while open (the overlay owns Esc).
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(list.length - 1, i + 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const cmd = list[activeIndex];
        if (cmd) { run(cmd); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, list, activeIndex, onClose]);

  const run = useCallback((cmd) => {
    if (!cmd) return;
    onRunCommand?.(cmd);
    onClose();
  }, [onRunCommand, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-surface border border-border-subtle rounded-[14px] shadow-[var(--shadow-elev)] overflow-hidden">
        {/* Search */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
          <span className="material-symbols-outlined text-[18px] text-text-muted">search</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
            placeholder={translate("Type a command or search keys…")}
            className="flex-1 bg-transparent text-sm text-text-main placeholder:text-text-muted focus:outline-none"
          />
          <kbd className="text-[10px] font-mono text-text-muted border border-border-subtle rounded px-1.5 py-0.5">esc</kbd>
        </div>

        {/* Commands */}
        <div className="max-h-[50vh] overflow-y-auto custom-scrollbar py-1.5">
          {list.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-muted">{translate("No matching commands")}</p>
          ) : (
            list.map((cmd, i) => (
              <button
                key={cmd.id || `${cmd.label}-${i}`}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => run(cmd)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                  i === activeIndex ? "bg-primary/10" : ""
                }`}
              >
                <span className={`material-symbols-outlined text-[18px] shrink-0 ${i === activeIndex ? "text-primary" : "text-text-muted"}`}>
                  {cmd.icon || "chevron_right"}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-text-main font-medium truncate">{cmd.label}</span>
                  {cmd.hint && <span className="block text-[11px] text-text-muted truncate">{cmd.hint}</span>}
                </span>
                {cmd.kbd && <kbd className="text-[10px] font-mono text-text-muted shrink-0">{cmd.kbd}</kbd>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
