"use client";
// EndpointShore — the five separated endpoint pages' common body (sealed plan
// §3.1 · W3).
//
// WHY IT EXISTS: separating the console into five routes means five pages each
// need the same three things around their subject — the masthead, the store's
// error banner, and the loading skeleton — and the console used to carry those
// once, in EndpointPageClient. Copying them five times would be five chances
// to drift (one page gains the retry link, another loses it), which is the same
// argument the house already made for ProxyShore and for bulk-health. So the
// surround lives here and each page supplies only its title, its subtitle, its
// icon and its subject.
//
// WHAT IT DELIBERATELY DOES NOT DO:
//   · It does not own the posture census. The hub owns the census; a shore may
//     show it, but that is the shore's decision, not the frame's.
//   · It does not call useEndpointFacade. The frame is dumb on purpose: each
//     shore mounts the facade itself (which is what arms the one bootstrap
//     load), and it hands the frame its error/reload. A frame that also mounted
//     the facade would subscribe every page to the whole fleet for a status
//     line.
//   · It does not gate the room. A failed load shows the banner ABOVE the
//     subject — the room still renders, still links onward, and its empty
//     states explain what is missing. A page that renders nothing on error is a
//     page that has vanished, and the navigation promises the door opens.
import { CardSkeleton } from "@/shared/components";
import PageShell from "@/shared/components/layouts/PageShell";

export default function EndpointShore({ title, subtitle, icon, actions, error, onRetry, loading, children }) {
  return (
    // The shell already owns the page's width and padding; `px-1 sm:px-0` matches
    // the endpoint console this family replaces, so the separation does not shift
    // a single pixel of the room's measure.
    <PageShell
      title={title}
      subtitle={subtitle}
      eyebrow="Endpoint"
      icon={icon}
      actions={actions}
      bodyClassName="flex flex-col gap-4"
      className="min-w-0 px-1 sm:px-0"
    >
      {error ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <span>{error}</span>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="font-medium underline decoration-dotted underline-offset-2"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? <CardSkeleton /> : children}
    </PageShell>
  );
}
