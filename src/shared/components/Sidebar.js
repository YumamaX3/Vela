"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { SETTINGS_NAV_ITEMS } from "@/app/(dashboard)/dashboard/settings/lib/settingsNavItems";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { translate } from "@/i18n/runtime";
import Button from "./Button";
import { ConfirmModal } from "./Modal";
import NineRemotePromoModal from "./NineRemotePromoModal";

// const VISIBLE_MEDIA_KINDS = ["embedding", "image", "imageToText", "tts", "stt", "webSearch", "webFetch", "video", "music"];
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt"];
// Combined entry: webSearch + webFetch share one page at /dashboard/media-providers/web
const COMBINED_WEB_ITEM = { id: "web", label: "Web Fetch & Search", icon: "travel_explore", href: "/dashboard/media-providers/web" };

const HOME_ITEM = { href: "/dashboard", label: "Home", icon: "home" };

// Nav groups render in rail order. Labels stay raw English — the i18n runtime
// resolves them through public/i18n/literals (seeded by i18n-seed-literals.mjs).
const navGroups = [
  {
    title: "Gateway",
    icon: "hub",
    items: [
      { href: "/dashboard/endpoint", label: "Endpoint & Key", icon: "api" },
      { href: "/dashboard/providers", label: "Providers", icon: "dns" },
      { href: "/dashboard/combos", label: "Combos", icon: "layers" },
      // { href: "/dashboard/basic-chat", label: "Basic Chat", icon: "chat" }, // Hidden
      // { href: "/dashboard/pxpipe", label: "PXPIPE", icon: "image" }, // Hidden
    ],
  },
  {
    title: "Analytics",
    icon: "insights",
    items: [
      { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
      { href: "/dashboard/quota", label: "Quota", icon: "data_usage" },
      { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
    ],
  },
  {
    title: "Tools",
    icon: "handyman",
    items: [
      { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
      { href: "/dashboard/media-providers", label: "Media Providers", icon: "perm_media", accordion: true },
      { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
      { href: "/dashboard/fallback-rules", label: "Fallback Rules", icon: "rule" },
      { href: "/dashboard/ai-lab", label: "AI Lab", icon: "science" },
      { href: "/dashboard/skills", label: "Skills", icon: "extension" },
    ],
  },
];

// The Observatory's 4th card: the System block (debug + remote + english + settings).
// The "remote"/"english" pseudo-hrefs are matched in GroupCard — 9Remote opens the
// promo modal, 9English links out; they never route.
const systemGroup = {
  title: "System",
  icon: "settings_suggest",
  items: [
    { href: "/dashboard/logs", label: "Request Logs", icon: "receipt_long", badge: "NEW" },
    { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
    { href: "/dashboard/translator", label: "Translator", icon: "translate", requiresEnableTranslator: true },
    { href: "remote", label: "9Remote", icon: "computer" },
    { href: "english", label: "9English", icon: "translate" },
    { href: "/dashboard/settings", label: "Settings", icon: "settings", accordion: true },
  ],
};

// Home sits alone at the top of the nav — no pinned card.
export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [openAccordions, setOpenAccordions] = useState({});
  const toggleAccordion = (key) => setOpenAccordions((prev) => ({ ...prev, [key]: !prev[key] }));
  const isAccordionOpen = (key) => !!openAccordions[key];
  const [searchQuery, setSearchQuery] = useState("");
  const [showRemoteModal, setShowRemoteModal] = useState(false);
  const [isDisconnected, setIsDisconnected] = useState(false);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [shutdownCountdown, setShutdownCountdown] = useState(0);
  const [enableTranslator, setEnableTranslator] = useState(false);
  const { copied, copy } = useCopyToClipboard(2000);

  const INSTALL_CMD = UPDATER_CONFIG.installCmdLatest;

  useEffect(() => {
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
  }, []);

  // Lazy check for new npm version on mount
  useEffect(() => {
    fetch("/api/version")
      .then(res => res.json())
      .then(data => { if (data.hasUpdate) setUpdateInfo(data); })
      .catch(() => {});
  }, []);

  const isRouteActive = (href) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
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

  // Note: legacy updater poll removed. New flow: copy install cmd + shutdown server,
  // user runs the command manually in another terminal.

  // The Observatory's live search — filters every nav item and sub-item by label
  // (case-insensitive). Matching group cards auto-open; the rest hide; clearing
  // restores everything.
  const q = searchQuery.trim().toLowerCase();
  const settingsMatches = (q && (translate("Settings").toLowerCase().includes(q)
    || SETTINGS_NAV_ITEMS.some((s) => translate(s.label).toLowerCase().includes(q)))) || false;
  const mediaMatches = (q && (translate("Media Providers").toLowerCase().includes(q)
    || MEDIA_PROVIDER_KINDS.some((k) => VISIBLE_MEDIA_KINDS.includes(k.id) && translate(k.label).toLowerCase().includes(q))
    || translate(COMBINED_WEB_ITEM.label).toLowerCase().includes(q))) || false;
  const accordionMatches = (item) => {
    if (item.href === "/dashboard/settings") return settingsMatches;
    if (item.href === "/dashboard/media-providers") return mediaMatches;
    return false;
  };
  const groupMatches = (group) => !q || group.items.some((item) => {
    if (item.accordion) return accordionMatches(item);
    return translate(item.label).toLowerCase().includes(q);
  });
  const itemMatches = (item) => {
    if (item.accordion) return !q || accordionMatches(item);
    return !q || translate(item.label).toLowerCase().includes(q);
  };

  const visibleGroups = q ? navGroups.filter(groupMatches) : navGroups;
  const systemVisible = q ? systemGroup.items.some((item) => translate(item.label).toLowerCase().includes(q)) : true;
  const homeVisible = !q || translate(HOME_ITEM.label).toLowerCase().includes(q);
  const anyMatch = q ? homeVisible || visibleGroups.length > 0 || systemVisible : true;

  return (
    <>
      <aside className="flex w-72 flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-colors duration-300 min-h-full">
        {/* Brand — Vela, the harbor */}
        <div className="flex flex-col gap-2 px-6 pt-6 pb-3">
          <div className="flex w-full items-center gap-3">
            <Link href="/dashboard" onClick={onClose} className="flex items-center gap-3 group flex-1 min-w-0" aria-label="Vela home">
              <div className="flex items-center justify-center shrink-0 transition-transform group-hover:scale-[1.04] size-10">
                <img
                  src="/vela-logo.svg"
                  alt="Vela"
                  className="size-10"
                  width={40}
                  height={40}
                />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-[17px] font-semibold tracking-tight text-text-main leading-none">
                    {APP_CONFIG.name}
                  </h1>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-surface-2 border border-border-subtle text-text-muted leading-none">
                    v{APP_CONFIG.version}
                  </span>
                </div>
                <span className="text-[11px] text-text-muted mt-1">{translate("AI Gateway")}</span>
              </div>
            </Link>
          </div>
          {updateInfo && (
            <div className="rounded-[10px] border border-success/25 bg-success/10 p-2.5">
              <p className="text-[11px] font-semibold text-success">
                {translate("New version available")}: v{updateInfo.latestVersion}
              </p>
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  onClick={() => setShowUpdateModal(true)}
                  className="px-2 py-1 rounded-lg bg-success text-white text-[11px] font-semibold hover:opacity-90 transition-opacity cursor-pointer"
                >
                  {translate("Update now")}
                </button>
                <button
                  onClick={() => copy(INSTALL_CMD)}
                  title="Copy install command"
                  className="flex-1 text-left hover:opacity-80 transition-opacity cursor-pointer min-w-0"
                >
                  <code className="block text-[10px] text-text-muted font-mono truncate">
                    {copied ? "✓ copied!" : INSTALL_CMD}
                  </code>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Search — the observatory's lens */}
        <div className="px-4 pb-2">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-text-subtle">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={translate("Find a page...")}
              aria-label={translate("Find a page...")}
              className="w-full rounded-[10px] border border-border-subtle bg-white/60 dark:bg-neutral-800/60 py-[7px] pl-9 pr-3 text-[13px] text-text-main placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-primary/30 transition-colors"
            />
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 pb-4 pt-1 overflow-y-auto custom-scrollbar">
          {/* Home — sits alone at the top, always visible */}
          {homeVisible && (
            <div className="pt-3">
              <NavItem
                href={HOME_ITEM.href}
                label={HOME_ITEM.label}
                icon={HOME_ITEM.icon}
                active={isRouteActive(HOME_ITEM.href)}
                onClick={onClose}
              />
            </div>
          )}

          {visibleGroups.map((group) => (
            <GroupCard
              key={group.title}
              group={group}
              pathname={pathname}
              openAccordions={openAccordions}
              onAccordionToggle={toggleAccordion}
              isAccordionOpen={isAccordionOpen}
              enableTranslator={enableTranslator}
              isRouteActive={isRouteActive}
              onClose={onClose}
              itemMatches={itemMatches}
            />
          ))}

          {/* System — the 4th bento card */}
          {systemVisible && (
            <GroupCard
              key={systemGroup.title}
              group={systemGroup}
              pathname={pathname}
              openAccordions={openAccordions}
              onAccordionToggle={toggleAccordion}
              isAccordionOpen={isAccordionOpen}
              enableTranslator={enableTranslator}
              isRouteActive={isRouteActive}
              onClose={onClose}
              itemMatches={itemMatches}
              onShowRemote={() => setShowRemoteModal(true)}
            />
          )}

          {/* Search empty state */}
          {q && !anyMatch && (
            <div className="px-3 py-6 text-center">
              <p className="text-[12px] text-text-subtle">{translate("No pages found")}</p>
            </div>
          )}
        </nav>

        {/* Status footer — the observatory's heartbeat */}
        <div className="px-4 pb-4 pt-1">
          <div className="flex items-center justify-between rounded-[14px] border border-border-subtle bg-surface-2/50 px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className="relative flex size-2">
                <span className="absolute -inset-[3px] rounded-full bg-success/25 animate-pulse-glow" />
                <span className="relative inline-flex size-2 rounded-full bg-success" />
              </span>
              <div className="flex flex-col leading-tight">
                <span className="text-[11px] font-semibold text-text-main">{translate("Gateway online")}</span>
                <span className="text-[10px] text-text-subtle">{translate("3 lanes active")}</span>
              </div>
            </div>
            <span className="text-[10px] font-mono text-text-muted">
              v{APP_CONFIG.version}
            </span>
          </div>
        </div>
      </aside>

      {/* Remote Promo Modal */}
      <NineRemotePromoModal isOpen={showRemoteModal} onClose={() => setShowRemoteModal(false)} />

      {/* Update Confirmation Modal */}
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
                <span className="material-symbols-outlined text-[32px]">power_off</span>
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
};

// The bento card shell — white icon tile, uppercase title, count chip.
// Always expanded: the header is a plain label (no collapse interaction).
function GroupCard({ group, pathname, openAccordions, onAccordionToggle, isAccordionOpen, enableTranslator, isRouteActive, onClose, onShowRemote, itemMatches }) {
  return (
    <div className="pt-3">
      <div className="rounded-[14px] border border-border-subtle bg-white/40 dark:bg-white/5">
        <div className="flex w-full items-center gap-2 rounded-t-[14px] px-2.5 py-2">
          <span className="flex items-center justify-center size-6 shrink-0 rounded-[8px] bg-white dark:bg-neutral-800 border border-border-subtle">
            <span className="material-symbols-outlined text-[15px]">
              {group.icon}
            </span>
          </span>
          <p className="flex-1 text-[10px] font-bold text-text-muted uppercase tracking-[0.14em] truncate">
            {translate(group.title)}
          </p>
          <span className="text-[9px] font-mono font-semibold text-text-subtle/70 bg-surface-2 rounded-full px-1.5 py-px">
            {group.items.length}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 pb-2 px-2">
            {group.items.map((item) => {
              const show = !item.requiresEnableTranslator || enableTranslator;
              if (!show) return null;
              if (item.accordion) {
                const isSettings = item.href === "/dashboard/settings";
                const isMedia = item.href === "/dashboard/media-providers";
                const accordionKey = isSettings ? "settings" : isMedia ? "media" : item.href;
                const open = isAccordionOpen(accordionKey);
                return (
                  <NavAccordion
                    key={item.href}
                    pathname={pathname}
                    open={open}
                    onToggle={() => onAccordionToggle(accordionKey)}
                    active={pathname.startsWith(item.href)}
                    onClose={onClose}
                    visible={itemMatches(item)}
                    icon={item.icon}
                    label={translate(item.label)}
                    items={isSettings ? SETTINGS_NAV_ITEMS.map((s) => ({ id: s.id, href: s.href, icon: s.icon, label: s.label }))
                      : isMedia ? [...MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((k) => ({ id: k.id, href: `/dashboard/media-providers/${k.id}`, icon: k.icon, label: k.label })), { id: COMBINED_WEB_ITEM.id, href: COMBINED_WEB_ITEM.href, icon: COMBINED_WEB_ITEM.icon, label: COMBINED_WEB_ITEM.label }]
                      : []}
                  />
                );
              }
              if (item.href === "remote") {
                if (itemMatches(item) === false) return null;
                return (
                  <button
                    key="remote"
                    type="button"
                    onClick={onShowRemote}
                    className={cn(
                      "flex items-center gap-3 px-3 py-[7px] rounded-[10px] transition-colors group w-full",
                      "text-text-muted hover:bg-surface-2 hover:text-text-main cursor-pointer"
                    )}
                  >
                    <span className="material-symbols-outlined text-[18px] group-hover:text-primary transition-colors">
                      {item.icon}
                    </span>
                    <span className="text-[13px] font-medium">{translate(item.label)}</span>
                  </button>
                );
              }
              if (item.href === "english") {
                if (itemMatches(item) === false) return null;
                return (
                  <a
                    key="english"
                    href="https://9english.net/"
                    target="_blank"
                    rel="noreferrer"
                    onClick={onClose}
                    className={cn(
                      "flex items-center gap-3 px-3 py-[7px] rounded-[10px] transition-colors group w-full",
                      "text-text-muted hover:bg-surface-2 hover:text-text-main"
                    )}
                  >
                    <span className="material-symbols-outlined text-[18px] group-hover:text-primary transition-colors">
                      {item.icon}
                    </span>
                    <span className="text-[13px] font-medium">{translate(item.label)}</span>
                  </a>
                );
              }
              return (
                <NavItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  badge={item.badge}
                  active={isRouteActive(item.href)}
                  onClick={onClose}
                  visible={itemMatches(item)}
                />
              );
            })}
        </div>
      </div>
    </div>
  );
}

GroupCard.propTypes = {
  group: PropTypes.object.isRequired,
  pathname: PropTypes.string.isRequired,
  openAccordions: PropTypes.object.isRequired,
  onAccordionToggle: PropTypes.func.isRequired,
  isAccordionOpen: PropTypes.func.isRequired,
  enableTranslator: PropTypes.bool.isRequired,
  isRouteActive: PropTypes.func.isRequired,
  onClose: PropTypes.func,
  onShowRemote: PropTypes.func,
  itemMatches: PropTypes.func.isRequired,
};

// Pinned favorites card removed — Home renders directly as a nav item above.

function NavItem({ href, label, icon, active, onClick, badge, visible }) {
  if (visible === false) return null;
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 px-3 py-[7px] rounded-[10px] transition-colors group",
        active
          ? "bg-gradient-to-r from-primary/10 to-primary/[0.04] text-primary font-semibold shadow-[inset_2.5px_0_0_#E56A4A]"
          : "text-text-muted hover:bg-surface-2 hover:text-text-main"
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-brand-500" />
      )}
      <span
        className={cn(
          "material-symbols-outlined text-[18px]",
          active ? "fill-1" : "group-hover:text-primary transition-colors"
        )}
      >
        {icon}
      </span>
      <span className="text-[13px] font-medium truncate flex-1">{translate(label)}</span>
      {badge && (
        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-brand-500/15 text-primary font-mono leading-none">
          {badge}
        </span>
      )}
    </Link>
  );
}

NavItem.propTypes = {
  href: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  active: PropTypes.bool,
  onClick: PropTypes.func,
  badge: PropTypes.string,
  visible: PropTypes.bool,
};

function NavAccordion({ pathname, open, onToggle, active, onClose, visible, icon, label, items }) {
  if (visible === false) return null;
  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "relative w-full flex items-center gap-3 px-3 py-[7px] rounded-[10px] transition-colors group",
          active
            ? "bg-primary/10 text-primary"
            : "text-text-muted hover:bg-surface-2 hover:text-text-main"
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-brand-500" />
        )}
        <span className="material-symbols-outlined text-[18px]">{icon}</span>
        <span className="text-[13px] font-medium flex-1 text-left">{label}</span>
        <span
          className="material-symbols-outlined text-[14px] transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          expand_more
        </span>
      </button>
      {open && (
        <div className="mt-0.5 flex flex-col gap-0.5 pl-4 border-l border-border-subtle ml-6">
          {items.map((child) => (
            <Link
              key={child.id}
              href={child.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-4 py-1 rounded-lg transition-colors group",
                pathname.startsWith(child.href)
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[16px]">{child.icon}</span>
              <span className="text-sm">{child.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

NavAccordion.propTypes = {
  pathname: PropTypes.string.isRequired,
  open: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  active: PropTypes.bool,
  onClose: PropTypes.func,
  visible: PropTypes.bool,
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  items: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    href: PropTypes.string.isRequired,
    icon: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
  })).isRequired,
};

function ManualUpdatePanel({ latestVersion, installCmd, copied, onCopyAndShutdown, onCancel, countdown, isDisconnected }) {
  const isCountingDown = countdown > 0;
  return (
    <div className="w-full max-w-lg rounded-xl bg-neutral-900/95 border border-white/10 p-6 text-white">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center justify-center size-11 rounded-full bg-amber-500/20 text-amber-400">
          <span className="material-symbols-outlined text-[24px]">content_copy</span>
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
