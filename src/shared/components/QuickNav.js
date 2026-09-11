"use client";

// QuickNav — the mast's command grid.
//
// The sidebar is the deep chart (accordions, accordions within, enable-flags).
// This is its pocket instrument: a categorized popover of the four fleets,
// reachable in one click from anywhere, with keyboard navigation and the
// current page marked. Mirrors the group structure of Sidebar.js
// (SOURCE OF TRUTH: Sidebar's NAV_GROUPS; if a page is added there and not
// here, this grid simply shows a shorter list — no crash, no stale link:
// every href below must match a real dashboard route).
//
// Keyboard: Escape closes; Tab walks the grid naturally (real links); the
// trigger announces itself; the current page is marked aria-current="page".

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/shared/utils/cn";

// Four fleets, ordered as the operator sails them: connect the helm,
// watch the signals, tend the fleet, read the deck.
const NAV_FLEETS = [
  {
    label: "Helm",
    icon: "sailing",
    items: [
      { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
      { href: "/dashboard/providers", label: "Providers", icon: "dns" },
      { href: "/dashboard/combos", label: "Combos", icon: "layers" },
      { href: "/dashboard/routed-by-combo", label: "Routed by Combo", icon: "route" },
    ],
  },
  {
    label: "Signals",
    icon: "monitoring",
    items: [
      { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
      { href: "/dashboard/quota", label: "Quota", icon: "data_usage" },
      { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
    ],
  },
  {
    label: "Fleet",
    icon: "directions_boat",
    items: [
      { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
      { href: "/dashboard/media-providers", label: "Media Providers", icon: "perm_media" },
      { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
      { href: "/dashboard/fallback-rules", label: "Fallback Rules", icon: "rule" },
      { href: "/dashboard/prompt-injectors", label: "Prompt Injectors", icon: "edit_note" },
      { href: "/dashboard/skills", label: "Skills", icon: "extension" },
    ],
  },
  {
    label: "Deck",
    icon: "deck",
    items: [
      { href: "/dashboard/logs", label: "Request Logs", icon: "receipt_long" },
      { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
      { href: "/dashboard/translator", label: "Translator", icon: "translate" },
    ],
  },
];

export default function QuickNav({ className = "" }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const wrapRef = useRef(null);

  // Click-outside closes — the same discipline HeaderMenu keeps.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={cn("relative", className)} ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Quick navigation"
        title="Quick navigation"
        className={cn(
          "flex items-center justify-center size-9 rounded-lg",
          "text-text-muted hover:text-text-main",
          "hover:bg-surface-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          open && "text-primary bg-primary/10 hover:bg-primary/10"
        )}
      >
        <span
          className={cn(
            "material-symbols-outlined text-[22px] transition-transform duration-300",
            open && "rotate-90"
          )}
          aria-hidden="true"
        >
          apps
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Quick navigation"
          onClick={(e) => {
            // Any navigation link click closes the panel (close-on-act).
            if (e.target.closest?.("a[href]")) setOpen(false);
          }}
          className={cn(
            "mast-panel absolute right-0 top-full mt-2 z-50",
            "w-[min(92vw,560px)] p-4",
            "bg-surface border border-border rounded-xl shadow-2xl",
            "grid grid-cols-1 sm:grid-cols-2 gap-4"
          )}
        >
          {NAV_FLEETS.map((fleet) => (
            <div key={fleet.label} className="min-w-0">
              <div className="flex items-center gap-1.5 px-1 pb-2">
                <span
                  className="material-symbols-outlined text-[14px] text-text-subtle"
                  aria-hidden="true"
                >
                  {fleet.icon}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  {fleet.label}
                </span>
                <span className="flex-1 h-px bg-border-subtle" aria-hidden="true" />
              </div>
              <div className="flex flex-col">
                {fleet.items.map((item) => {
                  const current = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-[13px]",
                        "text-text-main hover:bg-surface-2 transition-colors",
                        current && "text-primary bg-primary/5 font-medium"
                      )}
                    >
                      <span
                        className={cn(
                          "material-symbols-outlined text-[18px]",
                          current ? "text-primary" : "text-text-muted"
                        )}
                        aria-hidden="true"
                      >
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                      {current && (
                        <span className="ml-auto size-1.5 rounded-full bg-primary" aria-hidden="true" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
