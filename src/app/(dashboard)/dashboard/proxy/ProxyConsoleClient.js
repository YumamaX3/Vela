"use client";
// The Proxy console — one fleet, four lenses.
//
// WHAT CHANGED AND WHY (R-31, the reason written down):
//   · This replaced two pages, `proxy-pools/page.js` (1,116 lines) and
//     `proxy-fitness/page.js` (357 lines), that described the SAME fleet as if it
//     were two systems: one page owned the pool rows, the other owned the block
//     ledger, and neither could see the other's truth. They are now four tabs over
//     one controller (`useProxyFleet`), and both old routes redirect here.
//   · Behavior is preserved, not rewritten: the Fleet lens keeps every CRUD, test,
//     toggle, delete, batch-import and bulk action the old page had; the Fitness lens
//     keeps the ledger, the filters, clear-one / clear-all and the geo toggle.
//   · Two defects were fixed in the merge, and they are the reason the merge was
//     worth doing rather than a rewrite for its own sake:
//       (1) the health sweep now POSTs `/api/proxy-pools/bulk-health` ONCE, instead
//           of fanning out N client `/test` calls with a browser-side loop and tally;
//       (2) the console renders THREE verdicts — ok / dead / indeterminate — and
//           offers to disable only the PROVEN-dead; indeterminate reads "unknown,
//           left active". The old page collapsed both into "dead" and offered to
//           disable both, which is the fleet's own self-liquidation wound.
//   · Two lenses are NEW, because the facts they hold were scattered across the two
//     old pages or absent entirely: Egress (per-pool IP / country / flapping /
//     history) and Relay (the three edge deploys as first-class rows + forms).
//
// Navigation speaks the house dialect (TabBar → role="tablist"/"tab"/"aria-selected",
// panel → role="tabpanel"), the same as the Endpoint room. The tab is remembered and
// the Sidebar's four lens links deep-link with `?tab=`; a remembered tab and a URL tab
// are both honoured, URL winning.
import { useCallback, useEffect, useState } from "react";
import { CardSkeleton } from "@/shared/components";
import PageShell from "@/shared/components/layouts/PageShell";
import TabBar from "@/shared/components/TabBar";
import { useProxyFleet } from "./hooks/useProxyFleet";
import { ProxyCensus, FleetTab, FitnessTab, EgressTab, RelayTab } from "./components";

const TAB_KEY = "vela.proxy.tab";
const TAB_IDS = ["fleet", "fitness", "egress", "relay"];

function readStoredTab() {
  try {
    const saved = window.localStorage.getItem(TAB_KEY);
    return TAB_IDS.includes(saved) ? saved : "fleet";
  } catch {
    return "fleet"; // private mode — the console still works, it just forgets
  }
}

function writeStoredTab(id) {
  try {
    window.localStorage.setItem(TAB_KEY, id);
  } catch {
    /* private mode — the console still works, it just forgets */
  }
}

export default function ProxyConsoleClient() {
  const c = useProxyFleet();
  const [tab, setTab] = useState("fleet");

  // Restore the remembered lens, and honour a `?tab=` deep link from the Sidebar's
  // four lens links. The setState lives in the effect body on purpose and matches
  // every sibling page's pattern (react-hooks/set-state-in-effect): the server has
  // neither localStorage nor a URL query, so the lens can only be resolved AFTER
  // mount, and a lazy initializer would read it during hydration and desync markup.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(TAB_IDS.includes(fromUrl) ? fromUrl : readStoredTab());
  }, []);

  const change = useCallback((id) => {
    setTab(id);
    writeStoredTab(id);
    // Keep the URL in step so a copied address opens the same lens — replace, not
    // push, so the back button leaves the console rather than stepping through tabs.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", id);
      window.history.replaceState(null, "", url);
    } catch {
      /* history unavailable — the tab still switches */
    }
  }, []);

  const TABS = [
    { id: "fleet", label: "Fleet", icon: "lan", badge: c.census.total, badgeTitle: "Proxy pools" },
    {
      id: "fitness",
      label: "Fitness",
      icon: "monitor_heart",
      badge: c.census.blocked,
      tone: c.census.blocked > 0 ? "warn" : undefined,
      badgeTitle: "Active blocks",
    },
    { id: "egress", label: "Egress", icon: "travel_explore", badge: Object.keys(c.geo).length, badgeTitle: "Pools with a probed egress" },
    { id: "relay", label: "Relay", icon: "cloud_upload", badge: c.census.relayCount, badgeTitle: "Relay pools" },
  ];

  if (c.loading) {
    return (
      <div className="flex flex-col gap-6 px-1 sm:px-0">
        <CardSkeleton />
      </div>
    );
  }

  return (
    <PageShell
      title="Proxy"
      subtitle="One fleet, four lenses: pools, fitness blocks, egress, and edge relays."
      icon="lan"
      bodyClassName="flex flex-col gap-4"
      className="min-w-0 px-1 sm:px-0"
    >

      {c.error && (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          <span>{c.error}</span>
          <button type="button" onClick={c.reload} className="font-medium underline decoration-dotted underline-offset-2">
            Retry
          </button>
        </div>
      )}

      <ProxyCensus census={c.census} />

      <TabBar tabs={TABS} active={tab} onChange={change} ariaLabel="Proxy console sections" />

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="focus-visible:outline-none"
      >
        {tab === "fleet" && <FleetTab c={c} />}
        {tab === "fitness" && <FitnessTab c={c} />}
        {tab === "egress" && <EgressTab c={c} />}
        {tab === "relay" && <RelayTab c={c} />}
      </div>
    </PageShell>
  );
}
