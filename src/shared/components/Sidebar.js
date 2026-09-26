"use client";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { translate } from "@/i18n/runtime";
import Button from "./Button";
import { ConfirmModal } from "./Modal";
import NineRemotePromoModal from "./NineRemotePromoModal";
import UpdateNoticeModal from "./UpdateNoticeModal";

/* ---- The two keys the nav keeps across tides --------------------- */
const DOCKED_KEY = "vela_nav_docked";
const UPDATE_DISMISSED_KEY = "vela_update_dismissed";

const readDocked = () => {
  try {
    if (typeof localStorage === "undefined") return true;
    return localStorage.getItem(DOCKED_KEY) !== "false";
  } catch {
    // Storage can be refused outright (private mode, hardened browser).
    // The docked shore is the default, so a refused read costs nothing.
    return true;
  }
};

/* ---- The rooms ---------------------------------------------------
   Labels stay raw English. The i18n runtime resolves them at render,
   and an unresolvable key renders as the key itself — which is the
   honest fallback while the seeder is absent at HEAD. */
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
const COMBINED_WEB_ITEM = {
  id: "web",
  label: "Web Fetch & Search",
  icon: "travel_explore",
  href: "/dashboard/media-providers/web",
};
// The proxy console's four lenses. One subsystem, one nav entry, four doors
// into it — the same shape Media Providers already uses. Two separate rows
// for "Proxy Pools" and "Proxy Fitness" said the architecture was two
// systems; it is one.
const PROXY_TABS = [
  { id: "fleet", label: "Fleet", icon: "lan" },
  { id: "fitness", label: "Fitness", icon: "monitor_heart" },
  { id: "egress", label: "Egress", icon: "travel_explore" },
  { id: "relay", label: "Relay", icon: "cloud_upload" },
];

const MEDIA_CHILDREN = [
  ...MEDIA_PROVIDER_KINDS.filter((kind) => VISIBLE_MEDIA_KINDS.includes(kind.id)).map((kind) => ({
    id: `media-${kind.id}`,
    label: kind.label,
    icon: kind.icon,
    href: `/dashboard/media-providers/${kind.id}`,
  })),
  {
    id: "media-web",
    label: COMBINED_WEB_ITEM.label,
    icon: COMBINED_WEB_ITEM.icon,
    href: COMBINED_WEB_ITEM.href,
  },
];

const PROXY_CHILDREN = PROXY_TABS.map((lens) => ({
  id: `proxy-${lens.id}`,
  label: lens.label,
  icon: lens.icon,
  href: `/dashboard/proxy?tab=${lens.id}`,
}));

/* The dock is a map of places, not a list of links. Grouping the rooms
   under six glyphs is the whole redesign: an operator who returns forty
   times a day should never have to scan twenty rows to find the one door
   they came for. `exact` is only ever true for Home, because `/dashboard`
   is a prefix of every other room and would otherwise light for all of
   them. */
const SECTIONS = [
  {
    id: "home",
    label: "Home",
    icon: "home",
    rooms: [{ id: "dashboard", label: "Dashboard", icon: "home", href: "/dashboard", exact: true }],
  },
  {
    id: "gateway",
    label: "Gateway",
    icon: "hub",
    rooms: [
      { id: "endpoint", label: "Endpoint & Key", icon: "api", href: "/dashboard/endpoint" },
      { id: "providers", label: "Providers", icon: "dns", href: "/dashboard/providers" },
      { id: "combos", label: "Combos", icon: "layers", href: "/dashboard/combos" },
      { id: "routed-by-combo", label: "Routed by Combo", icon: "route", href: "/dashboard/routed-by-combo" },
      { id: "fallback-rules", label: "Fallback Rules", icon: "rule", href: "/dashboard/fallback-rules" },
      { id: "prompt-injectors", label: "Prompt Injectors", icon: "edit_note", href: "/dashboard/prompt-injectors" },
      // { id: "basic-chat", label: "Basic Chat", icon: "chat", href: "/dashboard/basic-chat" }, // Hidden
      // { id: "pxpipe", label: "PXPIPE", icon: "image", href: "/dashboard/pxpipe" }, // Hidden
    ],
  },
  {
    id: "traffic",
    label: "Traffic",
    icon: "monitoring",
    rooms: [
      { id: "usage", label: "Usage", icon: "bar_chart", href: "/dashboard/usage" },
      { id: "quota", label: "Quota", icon: "data_usage", href: "/dashboard/quota" },
      { id: "token-saver", label: "Token Saver", icon: "savings", href: "/dashboard/token-saver" },
      { id: "logs", label: "Request Logs", icon: "receipt_long", href: "/dashboard/logs", badge: "NEW" },
      { id: "console-log", label: "Console Log", icon: "terminal", href: "/dashboard/console-log" },
    ],
  },
  {
    id: "network",
    label: "Network",
    icon: "lan",
    rooms: [
      {
        id: "proxy",
        label: "Proxy",
        icon: "lan",
        href: "/dashboard/proxy",
        children: PROXY_CHILDREN,
        disclosure: "proxy",
      },
      {
        id: "media-providers",
        label: "Media Providers",
        icon: "perm_media",
        href: "/dashboard/media-providers",
        children: MEDIA_CHILDREN,
        disclosure: "media",
      },
      // Restored: /dashboard/mitm is a live room (page + MitmPageClient) that
      // had no door anywhere in the nav.
      { id: "mitm", label: "MITM Proxy", icon: "vpn_lock", href: "/dashboard/mitm" },
    ],
  },
  {
    id: "toolkit",
    label: "Toolkit",
    icon: "extension",
    rooms: [
      { id: "cli-tools", label: "CLI Tools", icon: "terminal", href: "/dashboard/cli-tools" },
      { id: "skills", label: "Skills", icon: "extension", href: "/dashboard/skills" },
      { id: "translator", label: "Translator", icon: "translate", href: "/dashboard/translator", gate: "translator" },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: "settings",
    rooms: [
      { id: "settings", label: "Settings", icon: "settings", href: "/dashboard/settings" },
      { id: "remote", label: "9Remote", icon: "computer", action: "remote" },
      { id: "english", label: "9English", icon: "language", href: "https://9english.net/", external: true },
    ],
  },
];

/* ---- Resolving the standing section ------------------------------ */
const baseOf = (href) => href.split("?")[0];
/* The four proxy lenses share one base path and differ only by `?tab=`, so a row that carries
   a query is "here" only when that query matches too, or every lens would light at once. */
const tabOf = (href) => {
  const q = typeof href === "string" ? href.split("?")[1] : "";
  return q ? new URLSearchParams(q).get("tab") : null;
};

const matchesPath = (href, pathname, exact) => {
  const base = baseOf(href);
  if (exact) return pathname === base;
  return pathname.startsWith(base);
};

/* Longest base wins, so `/dashboard/providers/new` resolves through
   `/dashboard/providers` to Gateway and never through `/dashboard` to Home. */
function sectionForPath(pathname) {
  let bestId = SECTIONS[0].id;
  let bestLen = -1;
  for (const section of SECTIONS) {
    for (const room of section.rooms) {
      if (!room.href || room.external || room.action) continue;
      const base = baseOf(room.href);
      if (matchesPath(room.href, pathname, room.exact) && base.length > bestLen) {
        bestId = section.id;
        bestLen = base.length;
      }
    }
  }
  return bestId;
}

export default function Sidebar({ onClose, variant = "dock" }) {
  const pathname = usePathname();
  const { copied, copy } = useCopyToClipboard(2000);
  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;

  const [selected, setSelected] = useState(() => sectionForPath(pathname));
  const [peek, setPeek] = useState(null);
  const [currentTab, setCurrentTab] = useState(null);
  const [docked, setDocked] = useState(readDocked);
  const [shellFocus, setShellFocus] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const [mediaOpen, setMediaOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showNoticeModal, setShowNoticeModal] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState(() => {
    try {
      if (typeof localStorage === "undefined") return "";
      return localStorage.getItem(UPDATE_DISMISSED_KEY) || "";
    } catch {
      return "";
    }
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);

  const searchRef = useRef(null);
  const activeChipRef = useRef(null);

  // Not state: the modifier glyph is a property of the machine, not of the
  // render, and a lazy read keeps it out of every effect's dependency list.
  const [keyHint] = useState(() =>
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl K",
  );

  // Declared ABOVE the shortcut effect on purpose. That effect names this
  // callback in its dependency array, and React evaluates a dep array during
  // render — so a `const` declared further down the body would still be in its
  // temporal dead zone on the first paint and throw. The order here is
  // load-bearing, not stylistic.
  const toggleDock = useCallback(() => {
    setDocked((prev) => {
      const next = !prev;
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(DOCKED_KEY, String(next));
      } catch {
        // Denied storage simply means the choice does not outlive the tab.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        if (data.enableTranslator) setEnableTranslator(true);
      })
      .catch(() => {});
  }, []);

  // The horizon bell — probe for a new tide on mount, then every 6 hours.
  // A dismissed version stays dismissed until an even newer one arrives.
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch("/api/version", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (!alive) return;
          if (data.hasUpdate && data.latestVersion && data.latestVersion !== dismissedVersion) {
            setUpdateInfo(data);
          }
        })
        .catch(() => {});
    check();
    const id = setInterval(check, 6 * 60 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [dismissedVersion]);

  // The drawer and the dock are both mounted at once (the drawer is held
  // off-screen, not unmounted), so a listener on each would fire every
  // shortcut twice. Only the dock binds the document.
  useEffect(() => {
    if (variant !== "dock") return undefined;
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (key === "b") {
        event.preventDefault();
        toggleDock();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [variant, toggleDock]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  // The narrow shore runs the dock as a sideways strip, so a chip selected
  // from elsewhere must be walked back into view. jsdom implements no layout
  // and therefore no `scrollIntoView` at all.
  useEffect(() => {
    const chip = activeChipRef.current;
    if (chip && typeof chip.scrollIntoView === "function") {
      chip.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selected, variant]);

  const selectSection = useCallback((id) => {
    setSelected(id);
    setPeek(null);
    setQuery("");
    setSearchOpen(false);
    // Deliberately does not call `onClose`: on the narrow shore the drawer
    // must survive a section tap, or the operator can never reach a room.
  }, []);

  /* `usePathname` never reports the query, so the standing `?tab=` is read from the address bar
     and kept in step on route changes, on back/forward, and on every room click. */
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const sync = () => setCurrentTab(tabOf(window.location.search));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [pathname]);

  // Render-phase adjustment, deliberately not `useState(pathname)`: seeding
  // from the path would make every later route change a no-op, so a deep link
  // into the proxy console would arrive with its disclosure shut.
  const [routedFrom, setRoutedFrom] = useState(null);
  if (pathname !== routedFrom) {
    setRoutedFrom(pathname);
    setSelected(sectionForPath(pathname));
    if (pathname.startsWith("/dashboard/proxy")) setProxyOpen(true);
    else if (pathname.startsWith("/dashboard/media-providers")) setMediaOpen(true);
  }

  const isRouteActive = useCallback(
    (href, exact) => {
      const want = tabOf(href);
      if (want !== null && want !== currentTab) return false;
      return matchesPath(href, pathname, exact);
    },
    [pathname, currentTab],
  );

  const handleDismissUpdate = () => {
    const v = updateInfo?.latestVersion || "";
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(UPDATE_DISMISSED_KEY, v);
    } catch {
      // storage unavailable
    }
    setDismissedVersion(v);
    setUpdateInfo(null);
  };

  const handleRoomClick = (href) => {
    setCurrentTab(tabOf(href));
    setQuery("");
    setSearchOpen(false);
    setPeek(null);
    if (onClose) onClose();
  };

  const handleRemote = () => {
    setShowRemoteModal(true);
    if (onClose) onClose();
  };

  const handleUpdate = () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
  };

  const handleCopyAndShutdown = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD);
    } catch {
      // clipboard blocked
    }
    copy(INSTALL_CMD);
    let remaining = UPDATER_CONFIG.shutdownCountdownSec;
    setShutdownCountdown(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      setShutdownCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        fetch("/api/version/shutdown", { method: "POST" }).catch(() => {});
        setIsDisconnected(true);
      }
    }, 1000);
  };

  const handleCancelUpdate = () => {
    setIsUpdating(false);
    setShutdownCountdown(0);
  };

  const searched = query.trim().length > 0;
  const shown = SECTIONS.find((section) => section.id === (peek ?? selected)) || SECTIONS[0];

  /* The panel is open when the operator has said so once — by docking it,
     by hovering another section, by focusing anything inside the shell, or
     by searching. A keyboard user tabs out of the last dock glyph and into
     the panel because `shellFocus` holds it. */
  const panelOpen = variant === "drawer" ? true : docked || peek !== null || shellFocus || searchOpen || searched;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return SECTIONS.map((section) => ({
      id: section.id,
      label: section.label,
      rooms: section.rooms
        .flatMap((room) => [room, ...(room.children || [])])
        .filter((room) => room.gate !== "translator" || enableTranslator)
        .filter((room) => {
          const resolved = translate(room.label);
          return resolved.toLowerCase().includes(q) || room.label.toLowerCase().includes(q);
        }),
    })).filter((group) => group.rooms.length > 0);
  }, [query, enableTranslator]);

  const renderRoom = (room) => {
    if (room.gate === "translator" && !enableTranslator) return null;

    if (!room.children) {
      return (
        <RoomRow
          key={room.id}
          room={room}
          active={room.href ? isRouteActive(room.href, room.exact) : false}
          onClick={() => handleRoomClick(room.href)}
          onRemote={handleRemote}
        />
      );
    }

    const isMedia = room.disclosure === "media";
    const open = isMedia ? mediaOpen : proxyOpen;
    const toggle = isMedia ? () => setMediaOpen((v) => !v) : () => setProxyOpen((v) => !v);
    const active = isRouteActive(room.href);

    return (
      <div key={room.id}>
        <button
          type="button"
          className="nav-room"
          data-active={active ? "true" : "false"}
          aria-expanded={open}
          onClick={toggle}
        >
          {active && <span className="nav-active-bar" />}
          <span className="material-symbols-outlined" aria-hidden="true">{room.icon}</span>
          <span className="nav-room-label">{translate(room.label)}</span>
          <span className="material-symbols-outlined nav-room-chevron" aria-hidden="true">expand_more</span>
        </button>
        {open && (
          <div className="nav-sub">
            {room.children.map((child) => (
              <RoomRow
                key={child.id}
                room={child}
                active={isRouteActive(child.href)}
                onClick={() => handleRoomClick(child.href)}
                onRemote={handleRemote}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <aside
        className="nav-shell"
        data-docked={docked ? "true" : "false"}
        data-variant={variant}
        // `docked` and `keyHint` are read from the machine before first
        // paint so a chosen shore never flashes the other one. The server
        // cannot know either, so this one element is allowed to differ on
        // hydration rather than jitter on every load.
        suppressHydrationWarning
        onMouseLeave={() => setPeek(null)}
        onFocusCapture={() => setShellFocus(true)}
        onBlurCapture={(event) => {
          // Peek is released only when focus leaves the whole shell — releasing
          // it from the glyph would change the panel's content the instant a
          // keyboard user tabbed from the glyph into the panel they were
          // reading, and take their focus with it.
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setShellFocus(false);
            setPeek(null);
          }
        }}
      >
        <nav className="nav-dock" aria-label={translate("Main navigation")}>
          <Link href="/dashboard" onClick={() => handleRoomClick()} className="nav-brand" aria-label="Vela home">
            <span className="nav-brand-mark">
              <img src="/vela-logo.svg" alt="Vela" width={34} height={34} />
            </span>
            <span className="nav-brand-text">
              <span className="nav-brand-name">{APP_CONFIG.name}</span>
              <span className="nav-brand-sub">{translate("AI Gateway")}</span>
            </span>
          </Link>

          <div className="nav-dock-list">
            {SECTIONS.map((section) => {
              const active = section.id === shown.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  ref={active ? activeChipRef : null}
                  className="nav-dock-btn"
                  data-active={active ? "true" : "false"}
                  aria-label={translate(section.label)}
                  aria-current={section.id === selected ? "true" : undefined}
                  title={translate(section.label)}
                  onClick={() => selectSection(section.id)}
                  onMouseEnter={() => setPeek(section.id === selected ? null : section.id)}
                  onFocus={() => setPeek(section.id === selected ? null : section.id)}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">{section.icon}</span>
                  <span className="nav-dock-text">{translate(section.label)}</span>
                  {active && <span className="nav-dock-count">{section.rooms.length}</span>}
                </button>
              );
            })}
          </div>

          <div className="nav-dock-foot">
            <button
              type="button"
              className="nav-icon-btn"
              aria-label={translate(docked ? "Undock the panel" : "Dock the panel")}
              title={`${translate(docked ? "Undock the panel" : "Dock the panel")} (${keyHint.replace("K", "B")})`}
              aria-pressed={docked}
              onClick={toggleDock}
            >
              <span className="material-symbols-outlined" aria-hidden="true">{docked ? "unfold_less" : "unfold_more"}</span>
            </button>
            <button
              type="button"
              className="nav-icon-btn"
              aria-label={translate("Search rooms")}
              title={`${translate("Search rooms")} (${keyHint})`}
              onClick={() => setSearchOpen(true)}
            >
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
            </button>
          </div>
        </nav>

        <div
          className="nav-panel"
          data-open={panelOpen ? "true" : "false"}
          data-peek={peek !== null ? "true" : "false"}
        >
          <div className="nav-panel-head">
            <div className="nav-panel-title">
              <span className="material-symbols-outlined" aria-hidden="true">{searched ? "search" : shown.icon}</span>
              <span>{searched ? translate("Search") : translate(shown.label)}</span>
            </div>
            {/* A label, not a div: the whole 32px field answers a pointer, and the input's own
                aria-label keeps the name, so the wider berth costs the name nothing. */}
            <label className="nav-search">
              <span className="material-symbols-outlined" aria-hidden="true">search</span>
              <input
                ref={searchRef}
                type="text"
                value={query}
                placeholder={translate("Search rooms...")}
                aria-label={translate("Search rooms")}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.stopPropagation();
                  if (query) setQuery("");
                  else {
                    setSearchOpen(false);
                    event.currentTarget.blur();
                  }
                }}
              />
              {searched ? (
                <button
                  type="button"
                  className="nav-search-clear"
                  aria-label={translate("Clear search")}
                  title={translate("Clear search")}
                  onClick={() => setQuery("")}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              ) : (
                <span className="nav-search-key">{keyHint}</span>
              )}
            </label>
          </div>

          {/* Outside the body on purpose: the notice is a bulletin, not a room,
              and letting it take a stagger slot would delay every row below it. */}
          {updateInfo && !searched && (
            <div className="nav-notice">
              <span className="nav-notice-glow" aria-hidden="true" />
              <div className="nav-notice-head">
                <span className="nav-notice-ping" aria-hidden="true">
                  <span />
                  <span />
                </span>
                <div className="nav-notice-line">
                  {translate("New tide")}: v{updateInfo.currentVersion} → v{updateInfo.latestVersion}
                </div>
                <button
                  type="button"
                  className="nav-notice-close"
                  aria-label={translate("Dismiss update notice")}
                  title={translate("Dismiss until a newer tide")}
                  onClick={handleDismissUpdate}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </div>
              <div className="nav-notice-actions">
                <button type="button" className="nav-notice-go" onClick={() => setShowNoticeModal(true)}>
                  <span className="material-symbols-outlined" aria-hidden="true">sailing</span>
                  {translate("Details")}
                </button>
                <button
                  type="button"
                  className="nav-notice-cmd"
                  title={INSTALL_CMD}
                  onClick={() => copy(INSTALL_CMD)}
                >
                  {copied ? "✓ copied!" : INSTALL_CMD}
                </button>
              </div>
            </div>
          )}

          {/* Re-keyed on the shown section so the staggered room entrance
              replays when the operator changes sections or starts searching. */}
          <div className="nav-panel-body" key={searched ? "search" : shown.id}>
            {searched ? (
              groups.length === 0 ? (
                <p className="nav-empty">{translate("No rooms match that current.")}</p>
              ) : (
                groups.map((group) => (
                  <div className="nav-result-group" key={group.id}>
                    <div className="nav-result-head">{translate(group.label)}</div>
                    {group.rooms.map((room) => (
                      <RoomRow
                        key={room.id}
                        room={room}
                        active={room.href ? isRouteActive(room.href, room.exact) : false}
                        onClick={() => handleRoomClick(room.href)}
                        onRemote={handleRemote}
                      />
                    ))}
                  </div>
                ))
              )
            ) : (
              shown.rooms.map((room) => renderRoom(room))
            )}
          </div>

          <div className="nav-panel-foot">
            <span>v{APP_CONFIG.version}</span>
            <span>{translate("AI Gateway")}</span>
          </div>
        </div>
      </aside>

      <NineRemotePromoModal isOpen={showRemoteModal} onClose={() => setShowRemoteModal(false)} />

      <ConfirmModal
        isOpen={showUpdateModal}
        onClose={() => setShowUpdateModal(false)}
        onConfirm={handleUpdate}
        title="Update Vela"
        message={`Show install command for v${updateInfo?.latestVersion || ""}? You can copy it and shutdown to install manually.`}
        confirmText="Show Command"
        cancelText="Cancel"
        variant="primary"
      />

      <UpdateNoticeModal
        isOpen={showNoticeModal}
        onClose={() => setShowNoticeModal(false)}
        info={updateInfo}
        onTriggerLegacyUpdate={() => setShowUpdateModal(true)}
      />

      {(isDisconnected || isUpdating) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          {isUpdating ? (
            <ManualUpdatePanel
              latestVersion={updateInfo?.latestVersion}
              installCmd={INSTALL_CMD}
              copied={copied}
              onCopyAndShutdown={handleCopyAndShutdown}
              onCancel={handleCancelUpdate}
              countdown={shutdownCountdown}
              isDisconnected={isDisconnected}
            />
          ) : (
            <div className="text-center p-8">
              <div className="flex items-center justify-center size-16 rounded-full bg-red-500/20 text-red-500 mx-auto mb-4">
                <span className="material-symbols-outlined text-[32px]" aria-hidden="true">power_off</span>
              </div>
              <h2 className="text-xl font-semibold text-white mb-2">{translate("Server Disconnected")}</h2>
              <p className="text-text-muted mb-6">{translate("The gateway has been stopped.")}</p>
              <Button variant="secondary" onClick={() => globalThis.location.reload()}>
                {translate("Reload Page")}
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

Sidebar.propTypes = {
  onClose: PropTypes.func,
  variant: PropTypes.oneOf(["dock", "drawer"]),
};

/* One room, three possible natures: a link to a room, a door off the shore,
   or an act that opens a modal. `aria-current` is the accessibility
   contract; `data-active` is only the styling hook. */
function RoomRow({ room, active, onClick, onRemote }) {
  const inner = (
    <>
      {active && <span className="nav-active-bar" />}
      <span className="material-symbols-outlined" aria-hidden="true">{room.icon}</span>
      <span className="nav-room-label">{translate(room.label)}</span>
      {room.badge && <span className="nav-badge">{room.badge}</span>}
    </>
  );

  if (room.external) {
    return (
      <a
        href={room.href}
        target="_blank"
        rel="noreferrer"
        className="nav-room"
        data-active={active ? "true" : "false"}
        onClick={onClick}
      >
        {inner}
      </a>
    );
  }

  if (room.action === "remote") {
    return (
      <button
        type="button"
        className="nav-room"
        data-active={active ? "true" : "false"}
        onClick={onRemote}
      >
        {inner}
      </button>
    );
  }

  return (
    <Link
      href={room.href}
      className="nav-room"
      data-active={active ? "true" : "false"}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {inner}
    </Link>
  );
}

RoomRow.propTypes = {
  room: PropTypes.shape({
    id: PropTypes.string,
    label: PropTypes.string.isRequired,
    icon: PropTypes.string,
    href: PropTypes.string,
    badge: PropTypes.string,
    external: PropTypes.bool,
    action: PropTypes.string,
  }).isRequired,
  active: PropTypes.bool,
  onClick: PropTypes.func,
  onRemote: PropTypes.func,
};

/* The manual-update berth. Preserved whole: its markup, its three-branch
   status line, and its install rite all predate this redesign and still
   carry the only in-place upgrade path the CLI berth has. */
function ManualUpdatePanel({
  latestVersion,
  installCmd,
  copied,
  onCopyAndShutdown,
  onCancel,
  countdown,
  isDisconnected,
}) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <span className="material-symbols-outlined flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400" aria-hidden="true">
          content_copy
        </span>
        <div>
          <h2 className="text-lg font-semibold">Update Vela{latestVersion ? ` to v${latestVersion}` : ""}</h2>
          <p className="text-sm text-white/60">
            {isDisconnected
              ? "The gateway has stopped. Reload once the new hull is in place."
              : isCountingDown
                ? "Shutting down now. The command is on your clipboard."
                : "Copy the command, then shut the gateway down to install it."}
          </p>
        </div>
      </div>

      <div className="rounded-lg bg-black/40 border border-white/10 p-3 mb-4">
        <code className="text-xs font-mono text-amber-400 break-all">{installCmd}</code>
      </div>

      <ol className="text-sm text-white/70 space-y-1 mb-5 list-decimal list-inside">
        <li>Copy the install command.</li>
        <li>Shut the gateway down.</li>
        <li>Paste the command into your terminal.</li>
      </ol>

      {isDisconnected ? (
        <Button variant="secondary" fullWidth onClick={() => globalThis.location.reload()}>
          Reload Page
        </Button>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={isCountingDown}>
            Cancel
          </Button>
          <Button variant="primary" fullWidth onClick={onCopyAndShutdown} disabled={isCountingDown}>
            {copied ? "✓ Copied, shutting down..." : isCountingDown ? `Shutting down in ${countdown}s` : "Copy & Shutdown"}
          </Button>
        </div>
      )}
    </div>
  );
}

ManualUpdatePanel.propTypes = {
  latestVersion: PropTypes.string,
  installCmd: PropTypes.string.isRequired,
  copied: PropTypes.bool,
  onCopyAndShutdown: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  countdown: PropTypes.number,
  isDisconnected: PropTypes.bool,
};
