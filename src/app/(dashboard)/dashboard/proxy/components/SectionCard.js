"use client";
// SectionCard — the separated shores' one panel.
//
// The hub, the ledger, usage and the tools page each open a titled block with a
// header row (title, a live count, an action on the right) over a body. The
// console had this shape once, inline, per tab; four shores copying it is four
// chances to drift on the padding, the count's placement, or whether an empty
// state is inside or outside the frame. So the frame lives here and each shore
// supplies only what is its own.
import { Badge } from "@/shared/components";

export default function SectionCard({ title, icon, count = null, countVariant = "default", actions = null, description = null, children, className = "" }) {
  return (
    <section className={`flex flex-col gap-3 rounded-[14px] border border-border-subtle bg-surface p-4 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? (
            <span className="material-symbols-outlined text-lg text-brand-500/80" aria-hidden="true">
              {icon}
            </span>
          ) : null}
          <h2 className="text-sm font-semibold text-text-main">{title}</h2>
          {count !== null ? (
            <Badge variant={countVariant} size="sm">
              {count}
            </Badge>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {description ? <p className="text-xs text-text-muted">{description}</p> : null}
      {children}
    </section>
  );
}
