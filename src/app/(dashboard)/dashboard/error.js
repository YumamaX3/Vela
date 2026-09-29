"use client";
// Dashboard error boundary (v1.0.30 "The Beacon Shore").
//
// WHY: zero error.js files existed in the whole deck — an exception inside any
// room rendered a blank void with no word of what broke. Next's App Router
// error boundary catches the render-time throw and offers the one honest
// action: try the room again. `reset()` remounts the route segment without a
// full page reload, so the shell (dock, header, theme) survives.
import { useEffect } from "react";

export default function DashboardError({ error, reset }) {
  useEffect(() => {
    // The full shape belongs in the console where the operator can read it;
    // the visitor sees only the digest-sized line below.
    console.error(error);
  }, [error]);

  const detail =
    typeof error?.digest === "string" ? `digest ${error.digest}` : null;

  return (
    <div className="flex flex-col items-center justify-center rounded-[14px] border border-border-subtle bg-surface px-6 py-14 text-center shadow-[var(--shadow-soft)]">
      <span
        className="material-symbols-outlined mb-3 text-[40px] text-danger"
        aria-hidden="true"
      >
        error
      </span>
      <p className="text-sm font-medium text-text-main">This room hit rough water</p>
      <p className="mt-1 max-w-sm text-xs text-text-muted">
        The page threw an exception while rendering. Trying again re-mounts just
        this room — the rest of the deck stays put.
      </p>
      {detail ? (
        <p className="mt-2 font-mono text-2xs text-text-subtle">{detail}</p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-main motion-control hover:bg-surface-2"
      >
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          refresh
        </span>
        Try again
      </button>
    </div>
  );
}
