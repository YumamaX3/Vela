"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { translate } from "@/i18n/runtime";
import Button from "./Button";
import { ConfirmModal } from "./Modal";
import NineRemotePromoModal from "./NineRemotePromoModal";
import UpdateNoticeModal from "./UpdateNoticeModal";

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
    items: [
      { href: "/dashboard/usage", label: "Usage", icon: "bar_chart" },
      { href: "/dashboard/quota", label: "Quota", icon: "data_usage" },
      { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
    ],
  },
  {
    title: "Tools",
    items: [
      { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
      { href: "/dashboard/media-providers", label: "Media Providers", icon: "perm_media", accordion: true },
      { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
      { href: "/dashboard/fallback-rules", label: "Fallback Rules", icon: "rule" },
      { href: "/dashboard/prompt-injectors", label: "Prompt Injectors", icon: "edit_note" },
      { href: "/dashboard/skills", label: "Skills", icon: "extension" },
    ],
  },
];

const debugItems = [
  { href: "/dashboard/logs", label: "Request Logs", icon: "receipt_long", badge: "NEW" },
  { href: "/dashboard/console-log", label: "Console Log", icon: "terminal" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate", requiresEnableTranslator: true },
];

export default function Sidebar({ onClose }) {
  const pathname = usePathname();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [collapsed, setCollapsed] = useState({});
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
    fetch("/api/settings")
      .then(res => res.json())
      .then(data => { if (data.enableTranslator) setEnableTranslator(true); })
      .catch(() => {});
  }, []);

  // The horizon bell — probe for a new tide on mount, then every 6 hours.
  // A dismissed version stays dismissed until an even newer one arrives.
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetch("/api/version", { cache: "no-store" })
        .then(res => res.json())
        .then(data => {
          if (!alive) return;
          if (data.hasUpdate && data.latestVersion && data.latestVersion !== dismissedVersion) {
            setUpdateInfo(data);
          }
        })
        .catch(() => {});
    check();
    const id = setInterval(check, 6 * 60 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [dismissedVersion]);

  const handleDismissUpdate = () => {
    const v = updateInfo?.latestVersion || "";
    try { localStorage.setItem("vela_update_dismissed", v); } catch { /* storage unavailable */ }
    setDismissedVersion(v);
    setUpdateInfo(null);
  };

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

  return (
    <>
      <aside className="flex w-72 flex-col border-r border-border-subtle bg-vibrancy backdrop-blur-xl transition-colors duration-300 min-h-full">
        {/* Brand — Vela, the harbor */}
        <div className="px-6 pt-6 pb-3 flex flex-col gap-2">
          <Link href="/dashboard" onClick={onClose} className="flex items-center gap-3 group" aria-label="Vela home">
            <div className="flex items-center justify-center size-10 transition-transform group-hover:scale-[1.04]">
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
                  className="shrink-0 rounded p-0.5 text-text-subtle transition-colors hover:bg-black/5 hover:text-text-muted dark:hover:bg-white/10 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
              <div className="relative mt-1.5 flex items-center gap-2">
                <button
                  onClick={() => setShowNoticeModal(true)}
                  className="flex items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-brand-600 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[13px]">sailing</span>
                  {translate("View details")}
                </button>
                <button
                  onClick={() => copy(INSTALL_CMD)}
                  title={INSTALL_CMD}
                  className="min-w-0 flex-1 cursor-pointer text-left transition-opacity hover:opacity-80"
                >
                  <code className="block truncate font-mono text-[10px] text-text-muted">
                    {copied ? "✓ copied!" : INSTALL_CMD}
                  </code>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 pb-4 pt-1 overflow-y-auto custom-scrollbar">
          <NavItem {...HOME_ITEM} active={isRouteActive(HOME_ITEM.href)} onClick={onClose} />

          {navGroups.map((group) => (
            <div key={group.title} className="pt-3">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [group.title]: !c[group.title] }))}
                className="flex w-full items-center gap-1 px-3 pb-1.5 text-left group-head-btn"
              >
                <p className="flex-1 text-[10px] font-semibold text-text-muted/60 uppercase tracking-[0.14em]">
                  {translate(group.title)}
                </p>
                <span className="text-[9px] font-mono font-semibold text-text-subtle/70 bg-surface-2 rounded-full px-1.5 py-px">
                  {group.items.length}
                </span>
                <span className={`material-symbols-outlined text-[13px] text-text-subtle transition-transform duration-200 ${collapsed[group.title] ? "-rotate-90" : ""}`}>
                  expand_more
                </span>
              </button>
              {!collapsed[group.title] && (
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) =>
                    item.accordion ? (
                      <MediaAccordion
                        key={item.href}
                        pathname={pathname}
                        open={mediaOpen}
                        onToggle={() => setMediaOpen((v) => !v)}
                        active={pathname.startsWith(item.href)}
                        onClose={onClose}
                      />
                    ) : (
                      <NavItem key={item.href} {...item} active={isRouteActive(item.href)} onClick={onClose} />
                    )
                  )}
                </div>
              )}
            </div>
          ))}

          {/* System */}
          <div className="pt-3">
            <p className="px-3 pb-1.5 text-[10px] font-semibold text-text-muted/60 uppercase tracking-[0.14em]">
              {translate("System")}
            </p>
            <div className="flex flex-col gap-0.5">
              {debugItems.map((item) => {
                const show = !item.requiresEnableTranslator || enableTranslator;
                return show ? (
                  <NavItem key={item.href} href={item.href} label={item.label} icon={item.icon} active={isRouteActive(item.href)} onClick={onClose} />
                ) : null;
              })}

              {/* Remote */}
              <button
                onClick={() => setShowRemoteModal(true)}
                className={cn(
                  "flex items-center gap-3 px-3 py-[7px] rounded-[10px] transition-colors group w-full",
                  "text-text-muted hover:bg-surface-2 hover:text-text-main"
                )}
              >
                <span className="material-symbols-outlined text-[18px] group-hover:text-primary transition-colors">
                  computer
                </span>
                <span className="text-[13px] font-medium">9Remote</span>
              </button>

              {/* 9English */}
              <a
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
                  translate
                </span>
                <span className="text-[13px] font-medium">9English</span>
              </a>

              {/* Settings */}
              <NavItem
                href="/dashboard/profile"
                label="Settings"
                icon="settings"
                active={isRouteActive("/dashboard/profile")}
                onClick={onClose}
              />
            </div>
          </div>
        </nav>
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

function NavItem({ href, label, icon, active, onClick, badge }) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-3 px-3 py-[7px] rounded-[10px] transition-colors group",
        active
          ? "bg-primary/10 text-primary"
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
};

function MediaAccordion({ pathname, open, onToggle, active, onClose }) {
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
        <span className="material-symbols-outlined text-[18px]">perm_media</span>
        <span className="text-[13px] font-medium flex-1 text-left">{translate("Media Providers")}</span>
        <span
          className="material-symbols-outlined text-[14px] transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          expand_more
        </span>
      </button>
      {open && (
        <div className="pl-4 mt-0.5 flex flex-col gap-0.5 border-l border-border-subtle ml-6">
          {MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((kind) => (
            <Link
              key={kind.id}
              href={`/dashboard/media-providers/${kind.id}`}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-4 py-1 rounded-lg transition-colors group",
                pathname.startsWith(`/dashboard/media-providers/${kind.id}`)
                  ? "bg-primary/10 text-primary"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[16px]">{kind.icon}</span>
              <span className="text-sm">{kind.label}</span>
            </Link>
          ))}
          <Link
            key={COMBINED_WEB_ITEM.id}
            href={COMBINED_WEB_ITEM.href}
            onClick={onClose}
            className={cn(
              "flex items-center gap-3 px-4 py-1 rounded-lg transition-colors group",
              pathname.startsWith(COMBINED_WEB_ITEM.href)
                ? "bg-primary/10 text-primary"
                : "text-text-muted hover:bg-surface-2 hover:text-text-main"
            )}
          >
            <span className="material-symbols-outlined text-[16px]">{COMBINED_WEB_ITEM.icon}</span>
            <span className="text-sm">{COMBINED_WEB_ITEM.label}</span>
          </Link>
        </div>
      )}
    </div>
  );
}

MediaAccordion.propTypes = {
  open: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
  active: PropTypes.bool,
  onClose: PropTypes.func,
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
