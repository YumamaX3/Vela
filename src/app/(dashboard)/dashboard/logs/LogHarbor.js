"use client";
// Log Harbor — the gateway's own record, gathered in one themed room.
//
// Four views in one harbor (M9 · "The Harbor Reborn", §7):
//   • Unified  — the ONE tail: console + container + request + persisted
//     events behind a single filter bar, virtualized, with the voyage view
//   • Console  — live console.* output (level chips, tag filters, rate meter)
//   • Container— the raw stdout/stderr tap, still the RAW ANSI view (§1
//     exempts it explicitly), now with the parity controls the console tab
//     already had
//   • Requests — the request ledger (model · provider · account · tokens ·
//     status), live against the stream door
//
// ── THE URL CONTRACT ────────────────────────────────────────────────────────
// `?tab=` is the tab mechanism this room shipped with and it is PRESERVED:
// `?tab=console`, `?tab=container`, `?tab=requests` and now `?tab=unified` all
// land on the right view, and `/dashboard/console-log`'s redirect (which points
// at `?tab=console`) keeps working untouched. `?view=unified` is the §7
// deep-link, accepted alongside `?tab=` so a shared "unified" link works
// whichever word the sender reached for. Both write the SAME param on change,
// so the address bar never carries two competing answers to "what am I
// looking at".
import { useEffect, useMemo, useState } from "react";
import PageShell from "@/shared/components/layouts/PageShell";
import { cn } from "@/shared/utils/cn";
import { translate } from "@/i18n/runtime";
import ConsoleStream from "./ConsoleStream";
import ContainerStream from "./ContainerStream";
import RequestLedger from "./RequestLedger";
import UnifiedTail from "./UnifiedTail";

const STREAMS = [
  { key: "unified", label: "Unified", icon: "view_timeline", hint: "One tail, every stream" },
  { key: "console", label: "Console", icon: "terminal", hint: "Live console output" },
  { key: "container", label: "Container", icon: "sailing", hint: "Raw process stream" },
  { key: "requests", label: "Requests", icon: "receipt_long", hint: "The request ledger" },
];

/** What both the server and the first client render show: the unified tail. */
const DEFAULT_VIEW = "unified";

/**
 * Read the active view from the URL.
 *
 * `?view=unified` is checked FIRST and independently of `?tab=`, so the two
 * params compose rather than shadow: a link carrying both is not ambiguous,
 * and `?tab=` wins only when `?view=` says nothing the tab list recognises.
 *
 * There is no `window` on the server, so a `readTab()` call inside a
 * `useState` initializer can only ever return the fallback — the server has no
 * way to know which view the visitor asked for. The HTML therefore ships the
 * fallback for EVERY deep link, and the URL only wins after hydration.
 *
 * That was true before M9 as well; M9 made it visible because "unified" is not
 * the old "console" fallback, so the wrong first paint now disagrees with what
 * a reader expects from `?tab=`. The mend is to make the first CLIENT render
 * agree with the server's (so hydration never mismatches) and then reconcile to
 * the real URL one tick later. `useEffect` is where that belongs: by the time
 * it runs, `window.location` exists and is authoritative.
 */
function readTab() {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view && STREAMS.some((s) => s.key === view)) return view;
  const tab = params.get("tab");
  return STREAMS.some((s) => s.key === tab) ? tab : "unified";
}

export default function LogHarbor() {
  // The SERVER-render value, on both sides of hydration. Reading the URL here
  // would make the client's first render differ from the server's, which is
  // the hydration mismatch React warns about — and which React resolves by
  // throwing away the server HTML anyway.
  const [tab, setTab] = useState(DEFAULT_VIEW);
  // Reconcile to the URL once the browser is here. Runs on mount and on every
  // back/forward, so a deep link and a history entry both land correctly.
  useEffect(() => {
    const sync = () => setTab(readTab());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const selectStream = (key) => {
    setTab(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    // One authority in the address bar: changing the view drops `view` so a
    // stale `?view=unified` can never outvote the tab the operator just chose.
    url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  };
  const active = useMemo(() => STREAMS.find((s) => s.key === tab) || STREAMS[0], [tab]);
  return (
    <PageShell
      title={translate("Log Harbor")}
      subtitle={translate("The harbor's record, gathered: one tail over console, container, and every request")}
      icon="waves"
      bodyClassName="flex flex-col gap-4"
      className="min-w-0 px-1 sm:px-0"
    >
      {/* ── Stream rail ─────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label={translate("Log streams")}
        className="flex flex-wrap items-stretch gap-2 rounded-[14px] border border-border-subtle bg-surface p-2 shadow-[var(--shadow-soft)]"
      >
        {STREAMS.map((s) => {
          const on = s.key === tab;
          return (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => selectStream(s.key)}
              className={cn(
                "inline-flex min-h-[40px] flex-1 items-center gap-2.5 rounded-[10px] border px-3.5 py-2 text-left motion-control",
                on
                  ? "border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-300"
                  : "border-transparent bg-surface-2 text-text-muted hover:text-text-main"
              )}
            >
              <span aria-hidden="true" className="material-symbols-outlined text-xl">
                {s.icon}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold leading-tight">{translate(s.label)}</span>
                <span className="truncate text-2xs leading-tight text-text-subtle">{translate(s.hint)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {/* ── Active stream ───────────────────────────────────────────────── */}
      <div role="tabpanel" aria-label={translate(active.label)}>
        {tab === "unified" && <UnifiedTail />}
        {tab === "console" && <ConsoleStream />}
        {tab === "container" && <ContainerStream />}
        {tab === "requests" && <RequestLedger />}
      </div>
    </PageShell>
  );
}