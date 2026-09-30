"use client";
// Log Harbor — the gateway's own record, gathered in one themed room.
//
// Three categorized streams, one harbor:
//   • Console  — live console.* output (level chips, tag filters, rate meter)
//   • Container — the raw stdout/stderr tap: everything `docker logs` sees,
//     captured in-process (Next banner, dependency prints, crash stacks)
//   • Requests — the request ledger (model · provider · account · tokens · status)
//
// The tab lives in the URL (?tab=console|container|requests) so deep links and
// bookmarks land on the right stream. /dashboard/console-log redirects here.
import { useEffect, useMemo, useState } from "react";
import PageShell from "@/shared/components/layouts/PageShell";
import { cn } from "@/shared/utils/cn";
import { translate } from "@/i18n/runtime";
import ConsoleStream from "./ConsoleStream";
import ContainerStream from "./ContainerStream";
import RequestLedger from "./RequestLedger";

const STREAMS = [
  { key: "console", label: "Console", icon: "terminal", hint: "Live console output" },
  { key: "container", label: "Container", icon: "sailing", hint: "Raw process stream" },
  { key: "requests", label: "Requests", icon: "receipt_long", hint: "The request ledger" },
];

function readTab() {
  if (typeof window === "undefined") return "console";
  const t = new URLSearchParams(window.location.search).get("tab");
  return STREAMS.some((s) => s.key === t) ? t : "console";
}

export default function LogHarbor() {
  const [tab, setTab] = useState(readTab);
  // Keep the URL honest without re-rendering the whole shell: replaceState on
  // change, and read back on popstate (back/forward).
  useEffect(() => {
    const onPop = () => setTab(readTab());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const selectStream = (key) => {
    setTab(key);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", key);
    window.history.replaceState(null, "", url);
  };
  const active = useMemo(() => STREAMS.find((s) => s.key === tab) || STREAMS[0], [tab]);
  return (
    <PageShell
      title={translate("Log Harbor")}
      subtitle={translate("The harbor's record, gathered: console, container, and every request")}
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
        {tab === "console" && <ConsoleStream />}
        {tab === "container" && <ContainerStream />}
        {tab === "requests" && <RequestLedger />}
      </div>
    </PageShell>
  );
}
