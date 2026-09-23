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
//     the Keys room. Rather than silently break a link that the page's own
//     SecurityWarning banners still emit, the hash is mapped to its new room.
//
// The last-used tab is remembered, so returning to the room returns you to the
// work you were doing — with a safe wrapper, because localStorage throws in
// private mode and a dashboard should not care. The room also writes the lens
// to the URL (`?tab=keys`) so a view can be shared or reloaded.
import { useState, useEffect } from "react";
import { CardSkeleton } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import useEndpointController from "./hooks/useEndpointController";
import useKeyDeck from "./hooks/useKeyDeck";
import TabBar from "@/shared/components/TabBar";
import EndpointCard from "./components/endpoint/EndpointCard";
import KeysCard from "./components/keys/KeysCard";
import EndpointModals from "./components/modals/EndpointModals";
import OverviewTab from "./components/tabs/OverviewTab";
import SecurityTab from "./components/tabs/SecurityTab";
import DiagnosticsTab from "./components/tabs/DiagnosticsTab";
const TAB_KEY = "vela.endpoint.tab";
const TAB_IDS = ["overview", "keys", "access", "security", "diagnostics"];
// Anchors that used to be scroll targets on the one-page layout. They now name
// a room instead — same intent, new address.
//
// `#require-api-key` resolves to the KEYS room, because that is where its
// target lives: the anchor is the keys masthead's own card (`KeysMasthead.js:18`,
// `id="require-api-key"`). Mapping it to `security` — as this table once did —
// sent the operator to a room with no such id, and because `SecurityWarning`
// preventDefaults a hash action and scrolls instead of navigating
// (`SecurityWarning.js:13-16`), the "Enable" link from the Overview's warning
// landed on nothing at all: the scroll found no element and the hash never
// changed the tab. One address, one room, and they now agree.
const HASH_TO_TAB = { "#require-api-key": "keys" };
/** The lens named in the URL (`?tab=keys`) — shareable, and honest to the back
 *  button. The shell persisted to localStorage alone before this, so a lens
 *  could never be linked to another operator. */
function readTabParam() {
  try {
    const t = new URLSearchParams(window.location.search).get("tab");
    return TAB_IDS.includes(t) ? t : null;
  } catch {
    return null;
  }
}
function readTab() {
  try {
    const saved = window.localStorage.getItem(TAB_KEY);
    return TAB_IDS.includes(saved) ? saved : "overview";
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
/** Put the lens in the URL without stacking history — one room, one address.
 *  `replaceState`, not `pushState`: tab switching is not a navigation, and a
 *  back button that walked five tabs would be a worse lie than a stale URL. */
function writeTabParam(id) {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") === id) return;
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  } catch {
    /* no history API — the room still works, the lens is just not shareable */
  }
}
export default function APIPageClient() {
  const c = useEndpointController();
  // The key deck is hoisted ABOVE the tab switch ON PURPOSE. It owns the
  // filters, the selection, the open drawer and the import ceremony — and a
  // deck mounted inside the Keys room unmounts with it, so switching to
  // Diagnostics and back silently discarded every filter and closed every
  // drawer. The comment below promises the tab switch can never strand an open
  // dialog; that was true for the shared modals and FALSE for the keys
  // overlays until this current was lifted here.
  const deck = useKeyDeck(c);
  const [tab, setTab] = useState("overview");
  // Restore the remembered room, and honour any deep link on arrival. A `?tab=`
  // in the URL wins over the hash and the remembered room, so a shared link
  // lands where it says.
  // The disable is deliberate and matches every sibling page's pattern
  // (react-hooks/set-state-in-effect): the server has no localStorage and no
  // hash, so the remembered room can only be resolved AFTER mount. A lazy
  // useState initializer would read it during hydration and desync the markup,
  // which is a worse failure than one extra render on arrival.
  useEffect(() => {
    const fromHash = HASH_TO_TAB[window.location.hash];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(readTabParam() || fromHash || readTab());
    const onHash = () => {
      const next = HASH_TO_TAB[window.location.hash];
      if (next) {
        setTab(next);
        writeTabParam(next);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const change = (id) => {
    setTab(id);
    writeTab(id);
    writeTabParam(id);
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
        {tab === "keys" && <KeysCard c={c} deck={deck} />}
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
