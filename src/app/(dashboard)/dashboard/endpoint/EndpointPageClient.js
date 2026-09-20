"use client";
// The Endpoint room — one controller, five rooms.
//
// WHAT CHANGED AND WHY (R-31, the reason written down):
//   · This file was 2,063 lines: state, handlers, four unrelated surfaces, and
//     six modals in one scroll. Every visit paid for every part.
//   · Behavior is UNTOUCHED. The controller was lifted verbatim into
//     hooks/useEndpointController.js; the JSX was lifted verbatim into
//     components/. Only addresses changed. No expression was rewritten.
//   · Navigation speaks the house dialect already in SkillsPageClient
//     (role="tablist"/"tab"/"aria-selected") rather than inventing a second one.
//
// R-37 / R-23 — the two rules that run in every mode, resolved and recorded:
//   · Direction: the Star chose five tabs, both feature depths, Dial 2.
//   · The old deep link `#require-api-key` pointed at a card that now lives in
//     the Security tab. Rather than silently break a link that the page's own
//     SecurityWarning banners still emit, the hash is mapped to its new room.
//
// The last-used tab is remembered, so returning to the room returns you to the
// work you were doing — with a safe wrapper, because localStorage throws in
// private mode and a dashboard should not care.
import { useState, useEffect } from "react";
import { CardSkeleton } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import useEndpointController from "./hooks/useEndpointController";
import TabBar from "@/shared/components/TabBar";
import EndpointCard from "./components/endpoint/EndpointCard";
import KeysCard from "./components/keys/KeysCard";
import EndpointModals from "./components/modals/EndpointModals";
import OverviewTab from "./components/tabs/OverviewTab";
import SecurityTab from "./components/tabs/SecurityTab";
import DiagnosticsTab from "./components/tabs/DiagnosticsTab";

const TAB_KEY = "vela.endpoint.tab";

// Anchors that used to be scroll targets on the one-page layout. They now name
// a room instead — same intent, new address.
const HASH_TO_TAB = { "#require-api-key": "security" };

function readTab() {
  try {
    const saved = window.localStorage.getItem(TAB_KEY);
    return ["overview", "keys", "access", "security", "diagnostics"].includes(saved) ? saved : "overview";
  } catch {
    return "overview";
  }
}

function writeTab(id) {
  try {
    window.localStorage.setItem(TAB_KEY, id);
  } catch {
    /* private mode — the room still works, it just forgets */
  }
}

export default function APIPageClient() {
  const c = useEndpointController();
  const [tab, setTab] = useState("overview");

  // Restore the remembered room, and honour any deep link on arrival.
  // The disable is deliberate and matches every sibling page's pattern
  // (react-hooks/set-state-in-effect): the server has no localStorage and no
  // hash, so the remembered room can only be resolved AFTER mount. A lazy
  // useState initializer would read it during hydration and desync the markup,
  // which is a worse failure than one extra render on arrival.
  useEffect(() => {
    const fromHash = HASH_TO_TAB[window.location.hash];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(fromHash || readTab());
    const onHash = () => {
      const next = HASH_TO_TAB[window.location.hash];
      if (next) setTab(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const change = (id) => {
    setTab(id);
    writeTab(id);
  };

  if (c.loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  // A control is "missing" objectively; whether it MATTERS depends on exposure.
  // This gateway runs at home with login off by choice, and the house's own gate
  // agrees that is legitimate — it blocks *enabling* a transport while unsafe
  // rather than demanding a password from someone who never exposes one. So the
  // count is always true, but only warns once something is actually reachable.
  const missingControls = (c.requireApiKey ? 0 : 1) + (c.requireLogin && c.hasPassword ? 0 : 1);
  const exposed = Boolean(c.tunnelEnabled || c.tsEnabled);

  const TABS = [
    { id: "overview", label: translate("Overview"), icon: "dashboard" },
    { id: "keys", label: translate("API Keys"), icon: "vpn_key", badge: c.keys.length, badgeTitle: translate("Keys configured") },
    { id: "access", label: translate("Access"), icon: "lan" },
    {
      id: "security",
      label: translate("Security"),
      icon: "shield_lock",
      badge: missingControls,
      tone: exposed ? "warn" : undefined,
      badgeTitle: exposed
        ? translate("Controls needing attention while exposed")
        : translate("Controls to set before exposing this gateway"),
    },
    { id: "diagnostics", label: translate("Diagnostics"), icon: "monitor_heart" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <TabBar tabs={TABS} active={tab} onChange={change} />

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="focus-visible:outline-none"
      >
        {tab === "overview" && <OverviewTab c={c} />}
        {tab === "keys" && <KeysCard c={c} />}
        {tab === "access" && <EndpointCard c={c} />}
        {tab === "security" && <SecurityTab c={c} />}
        {tab === "diagnostics" && <DiagnosticsTab c={c} />}
      </div>

      {/* Modals are overlays, not panels — they stay mounted across every room,
          which is why the tab switch can never strand an open dialog. */}
      <EndpointModals c={c} />
    </div>
  );
}
