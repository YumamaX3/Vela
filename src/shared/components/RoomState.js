"use client";
// RoomState — one component, three honest states (v1.0.30 "The Beacon Shore").
//
// WHY: a sweep this tide measured zero error.js/loading.js/not-found.js in the
// whole deck. Rooms either filled the screen with a spinner forever on a dead
// fetch, or rendered a blank void. R-27's three states, issued once as a
// component instead of twenty ad-hoc JSX blocks.
//
// CONTRACT:
//  · `loading` renders skeletons, never a blocking spinner — the room's
//    masthead (PageShell) stays visible above it.
//  · `error` is honest: what failed, one action. `retry` hands the room's own
//    refetch back to the visitor rather than a page reload.
//  · `empty` says what is missing and how to fill it, never a bare "No data".
//
// Reuses the deck's existing primitives (Skeleton, CardSkeleton, Button) —
// no parallel loading family is minted (R-05/R-11: reuse over re-creation).
import Button from "./Button";
import { Skeleton, CardSkeleton } from "./Loading";

function EmptyState({ icon = "inbox", title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[14px] border border-border-subtle bg-surface px-6 py-14 text-center shadow-[var(--shadow-soft)]">
      <span
        className="material-symbols-outlined mb-3 text-[40px] text-text-subtle"
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="text-sm font-medium text-text-main">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function ErrorState({ icon = "error", title, description, detail, retry }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-[14px] border border-border-subtle bg-surface px-6 py-14 text-center shadow-[var(--shadow-soft)]"
    >
      <span
        className="material-symbols-outlined mb-3 text-[40px] text-danger"
        aria-hidden="true"
      >
        {icon}
      </span>
      <p className="text-sm font-medium text-text-main">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-text-muted">{description}</p>
      ) : null}
      {/* detail is for the operator's eye only — rendered small, never the
          raw error object. The full shape belongs in the console. */}
      {detail ? (
        <p className="mt-2 max-w-md break-words font-mono text-2xs text-text-subtle">
          {detail}
        </p>
      ) : null}
      {retry ? (
        <Button variant="outline" size="sm" className="mt-4" onClick={retry}>
          <span className="material-symbols-outlined text-base" aria-hidden="true">
            refresh
          </span>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One room's honest state.
 *
 * @param {"loading"|"error"|"empty"} state - which truth to tell. Anything
 *   else renders children untouched, so the normal path pays zero wrapper.
 * @param {string}  [title]       - heading for error/empty.
 * @param {string}  [description] - one line under the title.
 * @param {string}  [detail]      - optional small technical detail (error).
 * @param {fn}      [retry]       - when given on error, offers "Try again".
 * @param {string}  [emptyIcon]   - ligature for the empty glyph.
 * @param {node}    [action]      - call-to-action for empty (e.g. "Add").
 * @param {node}    [children]    - the room's content on the normal path.
 * @param {string}  [className]   - extra classes on the wrapper.
 */
export default function RoomState({
  state,
  title,
  description,
  detail,
  retry,
  emptyIcon,
  action,
  children,
  className,
}) {
  if (state === "loading") {
    return (
      <div className={className} aria-busy="true">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className={className}>
        <ErrorState
          title={title || "Something went wrong"}
          description={description || "The room could not load its data."}
          detail={detail}
          retry={retry}
        />
      </div>
    );
  }
  if (state === "empty") {
    return (
      <div className={className}>
        <EmptyState
          icon={emptyIcon}
          title={title || "Nothing here yet"}
          description={description}
          action={action}
        />
      </div>
    );
  }
  return children ?? null;
}
