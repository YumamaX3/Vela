"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  // White on brand-500 measured 3.94:1, a FAIL on both shores. brand-600 is
  // 5.09:1 and still reads as the same coral CTA, so the ground lifts one step
  // and the hover takes the step below it.
  primary: "bg-brand-600 hover:bg-brand-700 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted",
  // A filled or outlined control must be identifiable at rest: border-border
  // measured 1.26:1 light and 1.39:1 dark, both under the 3:1 the non-text
  // ledger asks, so both take the control boundary.
  secondary: "bg-surface-2 hover:bg-surface-3 text-text-main border border-border-strong disabled:opacity-50",
  outline: "border border-border-strong text-text-main hover:bg-surface-2 hover:border-brand-500/40",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main",
  // White on red-500 measured 3.76:1 on both shores; red-600 is 4.83:1.
  danger: "bg-red-600 hover:bg-red-700 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted",
  // White on green-600 measured 3.30:1; green-700 is 5.02:1.
  success: "bg-green-700 hover:bg-green-800 text-white shadow-sm disabled:bg-surface-3 disabled:text-text-muted",
};

const sizes = {
  sm: "h-7 px-3 text-xs rounded-[8px]",
  md: "h-9 px-4 text-sm rounded-[10px]",
  lg: "h-11 px-6 text-sm rounded-[10px]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  // A glyph is decoration, never a word. `.material-symbols-outlined` renders
  // its ligature as real text, so an unblinded icon joins the accessible name:
  // the Requests ledger's Refresh button announced "refresh Refresh" — measured
  // live in a real browser. Blind the span whenever the button carries a
  // name of its own (visible children, or a label the caller supplied); an
  // icon-only button keeps its glyph as the name, because silencing a control
  // nobody has named is worse than the redundancy.
  const hasOwnName = Boolean(children) || Boolean(props["aria-label"]) || Boolean(props.title);
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold motion-control cursor-pointer",
        "active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span aria-hidden={hasOwnName ? "true" : undefined} className="material-symbols-outlined animate-spin text-lg">
          progress_activity
        </span>
      ) : icon ? (
        <span aria-hidden={hasOwnName ? "true" : undefined} className="material-symbols-outlined text-lg">
          {icon}
        </span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span aria-hidden={hasOwnName ? "true" : undefined} className="material-symbols-outlined text-lg">
          {iconRight}
        </span>
      )}
    </button>
  );
}
