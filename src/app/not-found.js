import Link from "next/link";

// Root not-found (v1.0.30 "The Beacon Shore").
//
// The (dashboard)/dashboard/not-found.js handles notFound() throws inside
// dashboard rooms, but an unmatched URL never traverses that boundary — it
// renders the root boundary or the framework default. This file gives every
// stray address the house's voice instead of Next's bare "This page could not
// be found". Self-contained by necessity: the root boundary renders outside
// every layout shell, so it carries its own centered frame and relies on the
// global tokens (bg-bg, surface, border) for the look.
export default function RootNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-6 text-center">
      <div className="flex flex-col items-center justify-center rounded-[14px] border border-border-subtle bg-surface px-6 py-14 shadow-[var(--shadow-soft)]">
        <span
          className="material-symbols-outlined mb-3 text-[40px] text-text-subtle"
          aria-hidden="true"
        >
          wrong_location
        </span>
        <p className="text-sm font-medium text-text-main">No shore at this address</p>
        <p className="mt-1 max-w-sm text-xs text-text-muted">
          The page you followed does not exist here. It may have been renamed,
          moved, or the link was mistyped.
        </p>
        <Link
          href="/dashboard"
          className="mt-4 inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-main motion-control hover:bg-surface-2"
        >
          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
            home
          </span>
          Back to the Dashboard
        </Link>
      </div>
    </div>
  );
}
