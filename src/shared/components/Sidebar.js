"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import useNavPulse from "@/shared/hooks/useNavPulse";
import { translate } from "@/i18n/runtime";
import Button from "./Button";
import { ConfirmModal } from "./Modal";
import NineRemotePromoModal from "./NineRemotePromoModal";
import UpdateNoticeModal from "./UpdateNoticeModal";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

// The proxy console's four lenses. One subsystem, one nav entry, four doors into
// it, the same shape Media Providers already uses.
const PROXY_TABS = [
  { id: "fleet", label: "Fleet", icon: "lan" },
  { id: "fitness", label: "Fitness", icon: "monitor_heart" },
  { id: "egress", label: "Egress", icon: "travel_explore" },
  { id: "relay", label: "Relay", icon: "cloud_upload" },
];

// Children of the two disclosure rooms. Each keeps the icon the previous helm
// gave it, so the glyph subset is never re-minted.
const PROXY_CHILDREN = PROXY_TABS.map((lens) => ({
  href: `/dashboard/proxy?tab=${lens.id}`,
  label: lens.label,
  icon: lens.icon,
}));
const MEDIA_CHILDREN = [
  ...MEDIA_PROVIDER_KINDS.filter((kind) => VISIBLE_MEDIA_KINDS.includes(kind.id)).map((kind) => ({
    href: `/dashboard/media-providers/${kind.id}`,
    label: kind.label,
    icon: kind.icon,
  })),
  { href: COMBINED_WEB_ITEM.href, label: COMBINED_WEB_ITEM.label, icon: COMBINED_WEB_ITEM.icon },
];

/**
 * The six sections, in rail order — the sealed chart's §4.1, room for room.
 *
 * `chip` names the pulse field a room may carry a live number from; a room
 * without one renders no chip at all. `state` marks the single room whose dot
 * carries a fleet health word (see §4.5).
 */
const SECTIONS = [
  {
    id: "home",
    label: "Home",
    icon: "home",
    rooms: [{ href: "/dashboard", label: "Home", icon: "home" }],
  },
  {
    id: "gateway",
    label: "Gateway",
    icon: "hub",
    rooms: [
      { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api", chip: "keys" },
      { href: "/dashboard/providers", label: "Providers", icon: "dns", chip: "providers", state: "providers" },
      { href: "/dashboard/combos", label: "Combos", icon: "layers", chip: "combos" },
      { href: "/dashboard/routed-by-combo", label: "Routed by Combo", icon: "route" },
    ],
  },
  {
    id: "traffic",
    label: "Traffic",
    icon: "monitoring",
    rooms: [
      { href: "/dashboard/usage", label: "Usage", icon: "bar_chart", chip: "usage" },
      { href: "/dashboard/quota", label: "Quota", icon: "data_usage" },
      { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
    ],
  },
  {
    id: "network",
    label: "Network",
    icon: "lan",
    rooms: [
      { href: "/dashboard/proxy", label: "Proxy", icon: "lan", chip: "proxy", children: PROXY_CHILDREN },
      // The MITM interception room. Chart line 88 originally struck this door —
      // "do not add `/dashboard/mitm`, `basic-chat`, `pxpipe`, `proxy-pools` or
      // `proxy-fitness`: the current nav deliberately omits them." The Star
      // restored mitm alone on 2026-09-29 and the chart was amended in the same
      // edit, so the two cannot disagree again. The other four stay omitted.
      //
      // No `chip`: the room has no counts-only source, and a tile with no honest
      // number carries no chip at all — the §4.5 law, not an oversight.
      { href: "/dashboard/mitm", label: "MITM", icon: "security" },
    ],
  },
  {
    id: "toolkit",
    label: "Toolkit",
    icon: "tune",
    rooms: [
      { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
      { href: "/dashboard/media-providers", label: "Media Providers", icon: "perm_media", children: MEDIA_CHILDREN },
      { href: "/dashboard/fallback-rules", label: "Fallback Rules", icon: "rule" },
      { href: "/dashboard/prompt-injectors", label: "Prompt Injectors", icon: "edit_note" },
      { href: "/dashboard/skills", label: "Skills", icon: "extension" },
    ],
  },
  {
    id: "system",
    label: "System",
    icon: "shield",
    rooms: [
      { href: "/dashboard/logs", label: "Request Logs", icon: "receipt_long", badge: "NEW", chip: "errors" },
      { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
      { href: "/dashboard/translator", label: "Translator", icon: "translate", requiresEnableTranslator: true },
      { href: "/dashboard/profile", label: "Settings", icon: "settings" },
      // The two duties: one opens a modal, one leaves the harbor entirely.
      { duty: "remote", label: "9Remote", icon: "computer" },
      { duty: "external", label: "9English", icon: "translate", href: "https://9english.net/" },
    ],
  },
];

/**
 * Redirect aliases — a section ALSO claims the route its own doors land on.
 *
 * The resolver runs against the URL the browser is showing, not the one a door
 * asked for, so a door that redirects leaves its section behind. `/dashboard/
 * profile` is System's Settings tile, and it `redirect()`s to `/dashboard/
 * settings` (v0.9.93 kept it as a redirect because bookmarks and muscle memory
 * still resolve there) — a route no room renders. So the moment a user walked
 * through the rail's own door, the rail lit Home and the System panel they were
 * working in vanished.
 *
 * Each entry is a redirect TARGET, not a room: a room belongs in `rooms`, where
 * it also earns a tile. Only targets belong here, and only targets that no room
 * already covers — the claim set below is derived from the doors, so this table
 * exists purely to stop a redirect from stranding its section.
 */
const SECTION_ALIASES = {
  system: ["/dashboard/settings"],
};
/** Every room across every section, so a pin can be re-rendered from its href alone. */
const ROOMS_BY_HREF = new Map();
for (const section of SECTIONS) {
  for (const room of section.rooms) {
    if (room.href) ROOMS_BY_HREF.set(room.href, { ...room, sectionId: section.id, sectionLabel: section.label });
  }
}

/** `worst` (one word from the pulse door) → the dot's state, or nothing. */
const DOT_STATE = {
  healthy: "healthy",
  cooling: "cooling",
  idle: "idle",
  degraded: "degraded",
  down: "down",
};

const PIN_KEY = "vela_nav_pinned";
const COLLAPSE_KEY = "vela_nav_collapsed";
// The mooring strip is a shortcut, not a second navigation. Six is what fits
// above the first group without pushing the rooms it exists to shorten below
// the fold; a seventh pin would make the strip longer than the section it
// stands in for.
const PIN_CAP = 6;

// The rail's own geometry, mirrored here so the sliding marker's transform can
// be computed from the active index. No DOM measurement — the shell is mounted
// in happy-dom by tests/unit/dashboard-layout-drawer.test.jsx, which has no
// layout engine at all.
const RAIL_BTN_H = 50;
const RAIL_BTN_GAP = 2;
const RAIL_MARKER_H = 30;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * The live number a room may carry, or `null` when no honest one exists.
 *
 * The law is the sealed chart's §4.5, taken verbatim: *a tile shows a number
 * only when the pulse carries it, and **never** renders `0`, `—`, or a
 * placeholder to fill a gap.* Every count below therefore collapses to `null`
 * at zero — so a rail cannot read "Combos 0" beside a fleet that is merely
 * idle, which is exactly the misreading a bare zero invites.
 *
 * (An earlier cut of this function let counts through at zero, on the reasoning
 * that "you have none configured" is information. That was a re-litigation of a
 * sealed line, and it was found on a live shore before it was found here. The
 * chart is the contract; the zero-suppression on money and errors was never a
 * separate rule, only the same one applied to two more sources.)
 *
 * The one thing that survives a zero total is the providers DOT: the dot
 * reports fleet STATE, and a fleet with nothing configured still has one — it
 * is honest whether or not there is a count to print beside it.
 */
function readChip(kind, pulse) {
  if (!kind || !pulse) return null;
  const src = pulse.sources || {};
  switch (kind) {
    case "keys": {
      if (!src.keys || !isNum(pulse.keys?.total) || pulse.keys.total <= 0) return null;
      return { count: pulse.keys.total, title: translate("Configured keys") };
    }
    case "providers": {
      const p = pulse.providers || {};
      // A zero total prints no count, but it does not suppress the dot: the
      // fleet's state is real whether or not there is a number beside it.
      const count = src.providers && isNum(p.total) && p.total > 0 ? p.total : null;
      const state = src.providers ? DOT_STATE[p.worst] || null : null;
      if (count === null && !state) return null;
      return { count, state, title: count !== null ? translate("Configured providers") : undefined };
    }
    case "combos": {
      if (!src.combos || !isNum(pulse.combos?.active) || pulse.combos.active <= 0) return null;
      return { count: pulse.combos.active, title: translate("Combos running") };
    }
    case "proxy": {
      const p = pulse.proxy || {};
      if (!src.proxy || !isNum(p.total) || p.total <= 0) return null;
      const blocked = isNum(p.blocked) ? p.blocked : 0;
      // The blocked count rides alongside the total, and the warn tone with it.
      return blocked > 0
        ? { count: `${p.total} · ${blocked}`, tone: "warn", title: translate("Blocked") }
        : { count: p.total };
    }
    case "usage": {
      if (!src.usage || !isNum(pulse.usage?.cost) || pulse.usage.cost <= 0) return null;
      return { count: `$${pulse.usage.cost.toFixed(2)}`, title: translate("Spent today") };
    }
    case "errors": {
      if (!src.errors || !isNum(pulse.errors?.count) || pulse.errors.count <= 0) return null;
      return { count: pulse.errors.count, tone: "warn", title: translate("Errors") };
    }
    default:
      return null;
  }
}

export default function Sidebar({ onClose, variant = "dock" }) {
  const pathname = usePathname();
  const router = useRouter();
  const isDrawer = variant === "drawer";

  // ── The live numbers. One counts-only door for the whole helm. ──────────
  const { pulse } = useNavPulse();

  // ── Section state. The ROUTE is the single source of truth, and the rail's
  //    only job is to move the route — that is the whole contract.
  //    There is deliberately no second `selected` state here. An earlier cut
  //    kept one, and because the clause below resolves on every real page it
  //    was never read: a click wrote a name nothing consulted, so the rail was
  //    inert and nineteen of the twenty rooms were unreachable from
  //    /dashboard. A state nothing reads IS the defect. ─────────────────────
  //
  //    The claim set is every href the rail can render, plus the redirect
  //    targets those hrefs land on (SECTION_ALIASES) — derived from the doors
  //    rather than written out a second time, so a room added to a section is
  //    claimed by it automatically. The LONGEST match wins: a broad claim can
  //    therefore never shadow a specific sibling, which is the failure mode a
  //    first-match `find` invites. `isActivePath` keeps `/dashboard` exact, so
  //    Home cannot swallow the other five sections.
  const activeSectionId = SECTIONS
    .flatMap((section) =>
      [...section.rooms.map((r) => r.href), ...(SECTION_ALIASES[section.id] || [])]
        .filter(Boolean)
        .map((href) => ({ id: section.id, href }))
    )
    .filter(({ href }) => isActivePath(pathname, href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.id || "home";
  const activeIndex = Math.max(0, SECTIONS.findIndex((s) => s.id === activeSectionId));

  const tabRefs = useRef([]);

  // ── The room panel: collapse, and the mooring strip ────────────────────
  const [collapsed, setCollapsed] = useState(false);
  const [pinned, setPinned] = useState([]);

  // Hydrate both from localStorage. `localStorage` does not exist during SSR, so
  // this is React's documented "adjust state when a prop changes" shape applied
  // to an external store: it runs during render, on the client only, and
  // re-renders before the first commit. The `hydrated` latch is what keeps it
  // from looping, and the render phase is what keeps it clear of
  // react-hooks/set-state-in-effect — the same reason the disclosure state
  // below is adjusted here rather than in an effect.
  const [hydrated, setHydrated] = useState(false);
  if (!hydrated && typeof window !== "undefined") {
    setHydrated(true);
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
      const raw = localStorage.getItem(PIN_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setPinned(parsed.filter((h) => typeof h === "string").slice(0, PIN_CAP));
    } catch { /* storage unavailable — the nav works unmoored */ }
  }

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch { /* storage unavailable */ }
  }, [collapsed]);

  const togglePin = useCallback((href) => {
    setPinned((current) => {
      const next = current.includes(href)
        ? current.filter((h) => h !== href)
        : [...current, href].slice(-PIN_CAP);
      try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  // ── Disclosure rooms (Proxy's lenses, Media Providers' kinds) ──────────
  const [openRooms, setOpenRooms] = useState({});
  const [openedRoute, setOpenedRoute] = useState(null);
  // A deep link into a disclosure room opens it by itself, so the operator can
  // see where they are instead of a closed row hiding it. Adjusting state during
  // render is React's documented pattern and re-renders immediately with no
  // committed frame — which is exactly what react-hooks/set-state-in-effect
  // rightly flags in the effect form.
  if (pathname !== openedRoute) {
    setOpenedRoute(pathname);
    const inside = {};
    for (const section of SECTIONS) {
      for (const room of section.rooms) {
        if (room.children && room.href && pathname.startsWith(room.href)) inside[room.href] = true;
      }
    }
    if (Object.keys(inside).length) setOpenRooms((current) => ({ ...current, ...inside }));
  }
  const toggleRoom = (href) => setOpenRooms((c) => ({ ...c, [href]: !c[href] }));

  // ── Preserved: the harbor's own duties ────────────────────────────────
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showNoticeModal, setShowNoticeModal] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState(() => {
    try { return localStorage.getItem("vela_update_dismissed") || ""; } catch { return ""; }
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings", { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // The horizon bell — probe for a new tide on mount, then every 6 hours.
  // A dismissed version stays dismissed until an even newer one arrives.
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    const check = () =>
      fetch("/api/version", { cache: "no-store", signal: controller.signal })
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
    return () => { alive = false; clearInterval(id); controller.abort(); };
  }, [dismissedVersion]);

  const handleDismissUpdate = () => {
    const v = updateInfo?.latestVersion || "";
    try { localStorage.setItem("vela_update_dismissed", v); } catch { /* storage unavailable */ }
    setDismissedVersion(v);
    setUpdateInfo(null);
  };

  // Open manual update panel (no countdown yet — user must click Copy to trigger shutdown)
  const handleUpdate = () => {
    setShowUpdateModal(false);
    setIsUpdating(true);
  };

  // Triggered by Copy button inside ManualUpdatePanel: copy + countdown + shutdown
  const handleCopyAndShutdown = async () => {
    try { await navigator.clipboard.writeText(INSTALL_CMD); } catch { /* clipboard blocked */ }
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

  // Where a section begins. Every section opens with a navigable room —
  // home→/dashboard, gateway→/dashboard/endpoint, traffic→/dashboard/usage,
  // network→/dashboard/proxy, toolkit→/dashboard/cli-tools, system→/dashboard/logs —
  // so the rail always has somewhere to land.
  const firstHref = (section) => section.rooms.find((r) => r.href)?.href;
  // The ONE way the rail changes the section: by navigating to that section's
  // first room. `activeSectionId` then follows the route, which keeps the
  // marker, `aria-selected`, the panel's `aria-labelledby` and the room list in
  // agreement by construction — and keeps back/forward honest, because there is
  // no panel state left that could drift from the URL.
  const goToSection = (section, index) => {
    const href = firstHref(section);
    // Only a real move earns a history entry — re-clicking the section you are
    // already standing in must not stack duplicate entries on the back stack.
    if (href && href !== pathname) router.push(href);
    // Selection follows focus in a tablist, so the roving tabindex must move
    // with it — otherwise the arrow key would strand the caret behind.
    if (index != null) tabRefs.current[index]?.focus();
  };
  // ── The rail's own keyboard contract: a real tablist, arrow-operable ───
  const onRailKey = (event, index) => {
    let next = null;
    if (event.key === "ArrowDown") next = (index + 1) % SECTIONS.length;
    else if (event.key === "ArrowUp") next = (index - 1 + SECTIONS.length) % SECTIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = SECTIONS.length - 1;
    if (next === null) return;
    event.preventDefault();
    goToSection(SECTIONS[next], next);
  };

  const activeSection = SECTIONS[activeIndex];
  const sectionRooms = activeSection.rooms.filter(
    (room) => !room.requiresEnableTranslator || enableTranslator
  );
  const pinnedRooms = pinned.map((href) => ROOMS_BY_HREF.get(href)).filter(Boolean);

  // A tile's place in the stagger. Capped at 8: past the eighth, a sequence you
  // can outrun by looking at it is latency with better manners.
  let stair = 0;

  return (
    <>
      <aside
        className="nav-shell bg-vibrancy backdrop-blur-xl motion-control"
        data-variant={isDrawer ? "drawer" : "dock"}
      >
        {/* ── The rail: six sections ───────────────────────────────────── */}
        {!isDrawer && (
          <div className="nav-rail custom-scrollbar">
            {/* The harbor's mark. Not a tab — it is a link home, and a tablist
                that contained it would be describing it as a section. */}
            <Link href="/dashboard" onClick={onClose} className="nav-rail-brand" aria-label="Vela home">
              <img src="/vela-logo.svg" alt="" className="nav-rail-logo" width={28} height={28} />
            </Link>

            <div className="nav-rail-tabs" role="tablist" aria-label="Sections" aria-orientation="vertical">
              {/* The mark's geometry is computed from the active index, so the
                  shell never reads a layout box at mount. */}
              <span
                className="nav-rail-marker"
                aria-hidden="true"
                style={{
                  transform: `translateY(${activeIndex * (RAIL_BTN_H + RAIL_BTN_GAP)}px)`,
                  height: `${RAIL_MARKER_H}px`,
                }}
              />
              {SECTIONS.map((section, index) => {
                const isActive = section.id === activeSectionId;
                return (
                  <button
                    key={section.id}
                    ref={(node) => { tabRefs.current[index] = node; }}
                    type="button"
                    role="tab"
                    id={`nav-tab-${section.id}`}
                    aria-selected={isActive}
                    aria-controls="nav-panel"
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => goToSection(section, index)}
                    onKeyDown={(event) => onRailKey(event, index)}
                    className="nav-rail-btn"
                  >
                    <span className="material-symbols-outlined nav-rail-icon" aria-hidden="true">{section.icon}</span>
                    <span className="nav-rail-label">{translate(section.label)}</span>
                  </button>
                );
              })}
            </div>

            {/* When the panel is docked away, its own collapse control is clipped
                to zero width with everything else inside it — so the affordance
                to bring it back has to live out here. Same class, same handler,
                one control visible in each state. */}
            {collapsed && (
              <div className="nav-rail-foot">
                <button
                  type="button"
                  className="nav-collapse-btn"
                  aria-expanded={false}
                  aria-label={translate("Expand the room panel")}
                  title={translate("Expand the room panel")}
                  onClick={() => setCollapsed(false)}
                >
                  <span className="material-symbols-outlined text-[15px]" aria-hidden="true">unfold_more</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── The panel: the rooms ─────────────────────────────────────── */}
        <div
          className="nav-panel"
          id={isDrawer ? undefined : "nav-panel"}
          role={isDrawer ? undefined : "tabpanel"}
          // The tabs point at `nav-panel` via aria-controls, so the panel has to
          // answer to that id and name itself from whichever section is lit —
          // otherwise the rail describes a region that does not exist. The
          // drawer has no rail and so no tablist to belong to, and is neither.
          aria-labelledby={isDrawer ? undefined : `nav-tab-${activeSectionId}`}
          data-docked={isDrawer || !collapsed ? "true" : "false"}
          // While docked away the panel is clipped to zero width and flies out
          // on hover/focus. Its links must leave the tab order in the same
          // state, and the mechanism is `visibility: hidden` in CSS rather than
          // an `inert` attribute here — because the panel has to become
          // REACHABLE again the moment a rail tab takes focus, and only a CSS
          // state can follow a focus that React never hears about. (`inert`
          // would leave the flyout visible and unclickable at the same time.)
        >
          <div className="nav-panel-body custom-scrollbar">
            <div className="nav-panel-head">
              <span className="nav-eyebrow">{translate("Rooms")}</span>
              {!isDrawer && !collapsed && (
                <button
                  type="button"
                  className="nav-collapse-btn"
                  aria-expanded={!collapsed}
                  aria-label={translate(collapsed ? "Expand the room panel" : "Collapse the room panel")}
                  title={translate(collapsed ? "Expand the room panel" : "Collapse the room panel")}
                  onClick={() => setCollapsed((v) => !v)}
                >
                  <span className="material-symbols-outlined text-[15px]" aria-hidden="true">
                    {collapsed ? "unfold_more" : "unfold_less"}
                  </span>
                </button>
              )}
              {isDrawer && (
                <button
                  type="button"
                  className="nav-collapse-btn"
                  aria-label={translate("Close navigation")}
                  title={translate("Close navigation")}
                  onClick={onClose}
                >
                  <span className="material-symbols-outlined text-[15px]" aria-hidden="true">close</span>
                </button>
              )}
            </div>

            {/* Preserved verbatim: the horizon bell's notice card. */}
            {updateInfo && (
              <div className="relative overflow-hidden rounded-[10px] border border-brand-500/25 bg-brand-500/10 p-2.5">
                {/* The ember glow — the notice's identity motif */}
                <div className="pointer-events-none absolute -right-8 -top-8 h-20 w-20 rounded-full bg-brand-500/20 blur-xl" />
                <div className="relative flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    <p className="truncate text-[11px] font-semibold text-brand-600 dark:text-brand-400">
                      {translate("New tide")}: v{updateInfo.currentVersion} → v{updateInfo.latestVersion}
                    </p>
                  </div>
                  <button
                    onClick={handleDismissUpdate}
                    aria-label={translate("Dismiss update notice")}
                    title={translate("Dismiss until a newer tide")}
                    className="shrink-0 rounded p-0.5 text-text-subtle motion-control hover:bg-black/5 hover:text-text-muted dark:hover:bg-white/10 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">close</span>
                  </button>
                </div>
                <div className="relative mt-1.5 flex items-center gap-2">
                  <button
                    onClick={() => setShowNoticeModal(true)}
                    className="flex items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white motion-control hover:bg-brand-600 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[13px]" aria-hidden="true">sailing</span>
                    {translate("View details")}
                  </button>
                  <button
                    onClick={() => copy(INSTALL_CMD)}
                    title={INSTALL_CMD}
                    className="min-w-0 flex-1 cursor-pointer text-left motion-control hover:opacity-80"
                  >
                    <code className="block truncate font-mono text-[10px] text-text-muted">
                      {copied ? "✓ copied!" : INSTALL_CMD}
                    </code>
                  </button>
                </div>
              </div>
            )}

            {/* The mooring strip. It renders in EVERY section when at least one
                room is moored, and not at all when none is — no empty box. */}
            {pinnedRooms.length > 0 && (
              <div className="nav-group">
                <div className="nav-group-head">
                  <span className="nav-group-title">{translate("Pinned")}</span>
                  <span className="nav-group-count">{pinnedRooms.length}</span>
                </div>
                {pinnedRooms.map((room) => (
                  <RoomTile
                    key={`pin-${room.href}`}
                    room={room}
                    active={isActivePath(pathname, room.href)}
                    pulse={pulse}
                    pinned
                    onTogglePin={togglePin}
                    onNavigate={onClose}
                    index={Math.min(stair++, 8)}
                  />
                ))}
              </div>
            )}

            {/* The active section's own rooms. */}
            <div className="nav-group">
              <div className="nav-group-head">
                <span className="nav-group-title">{translate(activeSection.label)}</span>
                <span className="nav-group-count">{sectionRooms.length}</span>
              </div>
              {sectionRooms.map((room) => {
                const index = Math.min(stair++, 8);
                if (room.duty === "remote") {
                  return (
                    <button
                      key="duty-remote"
                      type="button"
                      style={{ "--i": index }}
                      onClick={() => setShowRemoteModal(true)}
                      className="nav-tile nav-tile--duty"
                    >
                      <span className="material-symbols-outlined nav-tile-icon" aria-hidden="true">{room.icon}</span>
                      <span className="nav-tile-label">{room.label}</span>
                    </button>
                  );
                }
                if (room.duty === "external") {
                  return (
                    <a
                      key="duty-external"
                      href={room.href}
                      target="_blank"
                      rel="noreferrer"
                      onClick={onClose}
                      style={{ "--i": index }}
                      className="nav-tile nav-tile--duty"
                    >
                      <span className="material-symbols-outlined nav-tile-icon" aria-hidden="true">{room.icon}</span>
                      <span className="nav-tile-label">{room.label}</span>
                    </a>
                  );
                }
                return (
                  <RoomTile
                    key={room.href}
                    room={room}
                    active={isActivePath(pathname, room.href)}
                    pulse={pulse}
                    pinned={pinned.includes(room.href)}
                    canPin
                    onTogglePin={togglePin}
                    onNavigate={onClose}
                    open={!!openRooms[room.href]}
                    onToggleRoom={toggleRoom}
                    pathname={pathname}
                    index={index}
                  />
                );
              })}
            </div>

            <div className="nav-panel-foot">
              <span className="nav-panel-name">{APP_CONFIG.name}</span>
              <span className="nav-panel-version font-mono">v{APP_CONFIG.version}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Remote Promo Modal */}
      <NineRemotePromoModal isOpen={showRemoteModal} onClose={() => setShowRemoteModal(false)} />

      {/* Update Confirmation Modal (the npm/CLI berth's in-place flow) */}
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

      {/* The horizon bell — the Vela-styled update notice with release notes */}
      <UpdateNoticeModal
        isOpen={showNoticeModal}
        onClose={() => setShowNoticeModal(false)}
        info={updateInfo}
        onTriggerLegacyUpdate={() => setShowUpdateModal(true)}
      />

      {/* Disconnected / Updating Overlay */}
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

/** The previous helm's active test, kept exactly: Home is exact, the rest prefix. */
function isActivePath(pathname, href) {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname.startsWith(href);
}

/**
 * One room. A `<Link>` carrying `aria-current="page"` when it is the room you
 * are standing in; a chevron when it has children; and a moor button that is
 * always in the tab order (hidden by opacity, never by `display: none`).
 */
function RoomTile({
  room,
  active,
  pulse,
  pinned,
  canPin,
  onTogglePin,
  onNavigate,
  open,
  onToggleRoom,
  pathname,
  index,
}) {
  const chip = readChip(room.chip, pulse);
  const dot = room.state === "providers" && pulse?.sources?.providers
    ? DOT_STATE[pulse.providers?.worst] || null
    : null;
  const hasChildren = !!room.children?.length;

  return (
    <div className="nav-room">
      <div className="nav-tile" data-active={active ? "true" : undefined} style={{ "--i": index }}>
        <Link
          href={room.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className="nav-tile-link"
        >
          <span className="material-symbols-outlined nav-tile-icon" aria-hidden="true">{room.icon}</span>
          <span className="nav-tile-label">{translate(room.label)}</span>
          {chip?.count != null && (
            <NavCount value={chip.count} tone={chip.tone} title={chip.title} />
          )}
          {/* A dot that conveys nothing is the named slop pattern. This one exists
              only when the fleet has a real state, and always says which.
              `role="img"` is what makes the label reachable: an `aria-label` on a
              bare span is not reliably exposed, so a screen reader would read the
              link as "Providers 14" and never learn what the mark meant. As an
              image with a text alternative it announces
              "Fleet state: idle" — the dot's whole meaning, in words. */}
          {dot && (
            <span
              className="nav-tile-dot"
              data-state={dot}
              role="img"
              title={`${translate("Fleet state")}: ${translate(pulse.providers.worst)}`}
              aria-label={`${translate("Fleet state")}: ${translate(pulse.providers.worst)}`}
            />
          )}
          {room.badge && (
            <span className="nav-tile-badge">{room.badge}</span>
          )}
        </Link>

        {hasChildren && (
          <button
            type="button"
            className="nav-chevron-btn"
            aria-expanded={!!open}
            aria-label={translate(`Show ${room.label} rooms`)}
            title={translate(`Show ${room.label} rooms`)}
            onClick={() => onToggleRoom(room.href)}
          >
            <span className="material-symbols-outlined nav-chevron" data-open={open ? "true" : "false"} aria-hidden="true">
              expand_more
            </span>
          </button>
        )}

        {canPin && (
          <button
            type="button"
            className="nav-tile-moor"
            aria-pressed={pinned}
            aria-label={translate(pinned ? `Unmoor ${room.label}` : `Moor ${room.label}`)}
            title={translate(pinned ? `Unmoor ${room.label}` : `Moor ${room.label}`)}
            onClick={(event) => {
              // Never navigate: the moor button rides inside a row whose other
              // half is a link, and a pin is not a place.
              event.preventDefault();
              event.stopPropagation();
              onTogglePin(room.href);
            }}
          >
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">anchor</span>
          </button>
        )}
      </div>

      {hasChildren && open && (
        <div className="nav-sub">
          {room.children.map((child, i) => (
            <Link
              key={child.href}
              href={child.href}
              onClick={onNavigate}
              aria-current={isActivePath(pathname, child.href) ? "page" : undefined}
              className="nav-sub-tile"
              style={{ "--i": Math.min(i, 8) }}
            >
              <span className="material-symbols-outlined text-[15px]" aria-hidden="true">{child.icon}</span>
              <span className="nav-sub-label">{translate(child.label)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A live count. It breathes once when the number actually moves, and never
 * otherwise — `data-changed` is cleared on animationend, so navCountPulse
 * spends --motion-dur-base exactly once per real change and never loops.
 */
function NavCount({ value, tone, title }) {
  const [prev, setPrev] = useState(value);
  const [changed, setChanged] = useState(false);
  // React's documented "adjust state when a prop changes" pattern — during
  // render, not in an effect.
  if (prev !== value) {
    setPrev(value);
    setChanged(value != null);
  }
  return (
    <span
      className="nav-tile-count"
      data-tone={tone || undefined}
      data-changed={changed ? "true" : undefined}
      title={title}
      onAnimationEnd={() => setChanged(false)}
    >
      {value}
    </span>
  );
}

NavCount.propTypes = {
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  tone: PropTypes.string,
  title: PropTypes.string,
};

RoomTile.propTypes = {
  room: PropTypes.object.isRequired,
  active: PropTypes.bool,
  pulse: PropTypes.object,
  pinned: PropTypes.bool,
  canPin: PropTypes.bool,
  onTogglePin: PropTypes.func,
  onNavigate: PropTypes.func,
  open: PropTypes.bool,
  onToggleRoom: PropTypes.func,
  pathname: PropTypes.string,
  index: PropTypes.number,
};

Sidebar.propTypes = {
  onClose: PropTypes.func,
  variant: PropTypes.oneOf(["dock", "drawer"]),
};

function ManualUpdatePanel({ latestVersion, installCmd, copied, onCopyAndShutdown, onCancel, countdown, isDisconnected }) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
          <span className="material-symbols-outlined text-[24px]" aria-hidden="true">content_copy</span>
        </div>
        <div>
          <h2 className="text-lg font-semibold">Update Vela{latestVersion ? ` to v${latestVersion}` : ""}</h2>
          <p className="text-xs text-white/60">
            {isDisconnected
              ? "Server stopped. Paste the command into a terminal to install."
              : isCountingDown
                ? `Command copied. Server will stop in ${countdown}s...`
                : "Click the button below to copy the install command and shutdown."}
          </p>
        </div>
      </div>

      <p className="text-sm text-white/80 mb-2">Install command:</p>
      <div className="w-full px-3 py-2 rounded bg-white/5 mb-4">
        <code className="text-xs font-mono text-amber-400 break-all">{installCmd}</code>
      </div>

      <ol className="text-xs text-white/70 space-y-1 list-decimal list-inside mb-4">
        <li>Click <strong>Copy & Shutdown</strong> below.</li>
        <li>Paste the command into your terminal and press Enter.</li>
        <li>Run <code className="px-1 rounded bg-white/10 text-green-400">Vela</code> again after install.</li>
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
            {copied ? "✓ Copied — shutting down..." : isCountingDown ? `Shutting down in ${countdown}s` : "Copy & Shutdown"}
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
