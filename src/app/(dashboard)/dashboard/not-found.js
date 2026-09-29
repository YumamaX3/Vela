import Link from "next/link";

// Dashboard group not-found (v1.0.30 "The Beacon Shore").
//
// Without this file an unknown /dashboard/* URL fell through to the framework
// default, out of the deck's voice entirely. This one keeps the shell, names
// the miss, and hands the visitor the honest way home.
export default function DashboardNotFound() {
  return (
    <div className="flex flex-col items-center justify-center rounded-[14px] border border-border-subtle bg-surface px-6 py-14 text-center shadow-[var(--shadow-soft)]">
      <span
        className="material-symbols-outlined mb-3 text-[40px] text-text-subtle"
        aria-hidden="true"
      >
        wrong_location
      </span>
      <p className="text-sm font-medium text-text-main">No room at this berth</p>
      <p className="mt-1 max-w-sm text-xs text-text-muted">
        The address you followed does not match any room on the deck. It may have
        been renamed, or the link was mistyped.
      </p>
      <Link
        href="/dashboard"
        className="mt-4 inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-main motion-control hover:bg-surface-2"
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          home
        </span>
        Back to the Dashboard
      </Link>
    </div>
  );
}
