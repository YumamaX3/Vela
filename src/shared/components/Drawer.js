"use client";

import { useEffect } from "react";
import { useId } from "react";
import { cn } from "@/shared/utils/cn";
import { useScrollLock } from "@/shared/hooks/useScrollLock";
import { useFocusTrap } from "@/shared/hooks/useFocusTrap";

export default function Drawer({
  isOpen,
  onClose,
  title,
  children,
  width = "md",
  className
}) {
  const widths = {
    sm: "w-[400px]",
    md: "w-[500px]",
    lg: "w-[600px]",
    xl: "w-[800px]",
    full: "w-full",
  };

  // useId, not a module constant: a hardcoded id would duplicate across two
  // rendered drawers and make aria-labelledby point at the wrong heading.
  const titleId = useId();

  // Ref-counted with Modal.js and NineRemotePromoModal.js — see useScrollLock for
  // the unlock-while-open bug this replaces. This effect was byte-for-byte
  // identical to Modal.js:26-34.
  useScrollLock(isOpen);

  // Drawer had no focus handling at all: keyboard users could tab out into the
  // page behind it, and focus was never restored to the trigger on close.
  const { ref: panelRef } = useFocusTrap(isOpen);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // ── Mobile: the width map has no max guard ──────────────────────────────────
  // Both call sites pass width="lg" = w-[600px] (SkillsPageClient.js:397,
  // RequestDetailsTab.js:359). On a 375px viewport a 600px panel anchored
  // `right-0` pushes its left 225px off-screen, taking the title and — because
  // the close button sits in the header's justify-between — leaving it flush
  // against the right edge with the panel's own left content unreachable.
  // width="xl" (w-[800px]) is worse at 425px off-screen.
  //
  // `max-w-full` clamps the panel to the viewport at any resolution without
  // changing a single width token, so the desktop layout is untouched.
  //
  // NOTE: this fix DEPENDS on cn() really merging. Under the join-only cn the
  // result was "w-[600px] max-w-full" with the winner decided by Tailwind's
  // emission order; tailwind-merge keeps both because w- and max-w- are
  // different groups. That exact case is pinned in
  // tests/unit/cn-conflict-resolution.test.js ("keeps w- and max-w-").
  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay — aria-hidden because the panel itself carries the dialog role */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] fade-in cursor-pointer"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "absolute right-0 top-0 h-full max-w-full bg-surface flex flex-col",
          "shadow-[var(--shadow-elev)]",
          "slide-in-right",
          "border-l border-border-subtle",
          widths[width] || widths.md,
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-3">
            {title && (
              <h2 id={titleId} className="text-lg font-semibold text-text-main">{title}</h2>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-[10px] text-text-muted hover:bg-surface-2 hover:text-text-main transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
          {children}
        </div>
      </div>
    </div>
  );
}
