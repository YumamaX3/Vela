"use client";

// The settings room — one console, eight lenses.
//
// The old `/dashboard/profile` was a single 1,710-line scroll of eleven
// sections, and the three questions an operator actually arrives with ("what is
// this instance?", "who can reach it?", "is anything misconfigured?") were each
// answered by reading the whole page. This is the same surface re-cut along
// those questions: a masthead that answers the first in two lines, then one tab
// per remaining question, and each tab opened by a person who already knows what
// they came for.
//
// Nothing about the wire changed. Every control still writes through
// `PATCH /api/settings` via the deck — the re-composition moved markup, not
// behavior.

import { useCallback, useEffect, useMemo, useState } from "react";
import { TabBar } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import useSettingsDeck from "./hooks/useSettingsDeck";
import SettingsMasthead from "./components/SettingsMasthead";
import SettingsPanel from "./components/SettingsPanel";
import GeneralTab from "./components/tabs/GeneralTab";
import AccessTab from "./components/tabs/AccessTab";
import SsoTab from "./components/tabs/SsoTab";
import RoutingTab from "./components/tabs/RoutingTab";
import NetworkTab from "./components/tabs/NetworkTab";
import DataTab from "./components/tabs/DataTab";
import BillingTab from "./components/tabs/BillingTab";
import AdvancedTab from "./components/tabs/AdvancedTab";

const TAB_IDS = ["general", "access", "sso", "routing", "network", "data", "billing", "advanced"];

// Read `?tab=` straight from the URL. `useSearchParams()` would force this page
// behind a Suspense boundary for no gain — this room needs the value once, on
// mount, and never re-renders on a query change it did not itself write.
function tabFromUrl() {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("tab");
  return TAB_IDS.includes(value) ? value : null;
}

export default function SettingsPage() {
  const deck = useSettingsDeck();
  const [active, setActive] = useState(() => tabFromUrl() || "general");

  // Lazy mount, then never unmount. A visitor who never opens Single Sign-On
  // pays nothing for it; a visitor who does open it and then wanders to Routing
  // does not lose a half-typed issuer URL to an unmount. Visiting a tab is what
  // brings its panel into the DOM, and the panel stays.
  const [mounted, setMounted] = useState(() => {
    const first = tabFromUrl() || "general";
    return new Set([first]);
  });

  const onChange = useCallback((id) => {
    setActive(id);
    setMounted((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    // Keep the URL shareable so a support thread can point at the exact tab.
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id === "general") url.searchParams.delete("tab");
      else url.searchParams.set("tab", id);
      window.history.replaceState(null, "", url);
    }
  }, []);

  // A deep link arrives before the room is interactive; adopt it once the URL is
  // readable and only when it names a real tab.
  useEffect(() => {
    const fromUrl = tabFromUrl();
    if (fromUrl && fromUrl !== active) {
      setActive(fromUrl);
      setMounted((prev) => (prev.has(fromUrl) ? prev : new Set(prev).add(fromUrl)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs = useMemo(() => {
    // One attention signal, and only when it is true: the dashboard is reachable
    // without a password, or it demands one that was never set (which locks the
    // door from the inside on a remote host). Everything else in this room has
    // a settled state, so nothing else earns a badge.
    const unguarded = !deck.requireLogin;
    const locked = deck.requireLogin && !deck.hasPassword;
    return [
      { id: "general", label: translate("General"), icon: "tune" },
      {
        id: "access",
        label: translate("Access"),
        icon: "lock",
        badge: unguarded || locked ? 1 : undefined,
        tone: "warn",
        badgeTitle: unguarded
          ? translate("No password is required to open this dashboard")
          : translate("A password is required but none has been set"),
      },
      { id: "sso", label: translate("Single Sign-On"), icon: "vpn_key" },
      { id: "routing", label: translate("Routing"), icon: "alt_route" },
      { id: "network", label: translate("Network"), icon: "wifi" },
      { id: "data", label: translate("Data"), icon: "database" },
      { id: "billing", label: translate("Billing"), icon: "payments" },
      { id: "advanced", label: translate("Advanced"), icon: "settings_applications" },
    ];
  }, [deck.requireLogin, deck.hasPassword]);

  const panels = {
    general: <GeneralTab deck={deck} />,
    access: <AccessTab deck={deck} />,
    sso: <SsoTab deck={deck} />,
    routing: <RoutingTab deck={deck} />,
    network: <NetworkTab deck={deck} />,
    data: <DataTab deck={deck} />,
    billing: <BillingTab />,
    advanced: <AdvancedTab deck={deck} />,
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsMasthead deck={deck} />

      <TabBar
        tabs={tabs}
        active={active}
        onChange={onChange}
        ariaLabel={translate("Settings sections")}
      />

      {TAB_IDS.filter((id) => mounted.has(id)).map((id) => (
        <SettingsPanel key={id} id={id} active={active === id}>
          {panels[id]}
        </SettingsPanel>
      ))}
    </div>
  );
}
