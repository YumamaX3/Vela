"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import HeaderMenu from "@/shared/components/HeaderMenu";
import HeaderLanguage from "@/shared/components/HeaderLanguage";
import ThemeToggle from "@/shared/components/ThemeToggle";
import StatusBeacon from "@/shared/components/StatusBeacon";
import QuickNav from "@/shared/components/QuickNav";
import { useHeaderSearchStore } from "@/store/headerSearchStore";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS, AI_PROVIDERS } from "@/shared/constants/providers";
import { getProviderIconSrc } from "@/shared/utils/providerIcon";
import { translate } from "@/i18n/runtime";

// ── The page chart ──────────────────────────────────────────────────────────
// Every dashboard route a pathname can land on gets a title + description +
// icon, ordered so detail pages match before their parent prefixes. The icon
// drives the compass tile; the description is the mast's second line.
const getPageInfo = (pathname) => {
  if (!pathname) return { title: "", description: "", breadcrumbs: [] };

  // Media provider detail: /dashboard/media-providers/[kind]/[id]
  const mediaDetailMatch = pathname.match(/\/media-providers\/([^/]+)\/([^/]+)$/);
  if (mediaDetailMatch) {
    const kindId = mediaDetailMatch[1];
    const providerId = mediaDetailMatch[2];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    const provider = AI_PROVIDERS[providerId];
    return {
      title: provider?.name || providerId,
      description: "",
      breadcrumbs: [
        { label: "Media Providers", href: `/dashboard/media-providers/${kindId}` },
        { label: kindConfig?.label || kindId, href: `/dashboard/media-providers/${kindId}` },
        { label: provider?.name || providerId, image: getProviderIconSrc(providerId) },
      ],
    };
  }

  // Media provider kind: /dashboard/media-providers/[kind]
  const mediaKindMatch = pathname.match(/\/media-providers\/([^/]+)$/);
  if (mediaKindMatch) {
    const kindId = mediaKindMatch[1];
    const kindConfig = MEDIA_PROVIDER_KINDS.find((k) => k.id === kindId);
    return {
      title: kindConfig?.label || kindId,
      description: `Manage your ${kindConfig?.label || kindId} providers`,
      icon: kindConfig?.icon || "perm_media",
      breadcrumbs: [],
    };
  }

  // Provider detail page: /dashboard/providers/[id]
  const providerMatch = pathname.match(/\/providers\/([^/]+)$/);
  if (providerMatch) {
    const providerId = providerMatch[1];
    const providerInfo =
      OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId];
    if (providerInfo) {
      return {
        title: providerInfo.name,
        description: "",
        breadcrumbs: [
          { label: "Providers", href: "/dashboard/providers" },
          {
            label: providerInfo.name,
            image: getProviderIconSrc(providerInfo.id),
          },
        ],
      };
    }
  }

  if (pathname.includes("/providers") && !pathname.includes("/media-providers"))
    return {
      title: "Providers",
      description: "Manage your AI provider connections",
      icon: "dns",
      breadcrumbs: [],
    };
  if (pathname.includes("/combos"))
    return {
      title: "Combos",
      description: "Model combos with fallback",
      icon: "layers",
      breadcrumbs: [],
    };
  if (pathname.includes("/usage"))
    return {
      title: "Usage & Analytics",
      description:
        "Monitor your API usage, token consumption, and request logs",
      icon: "bar_chart",
      breadcrumbs: [],
    };
  if (pathname.includes("/auth-files"))
    return {
      title: "Auth Files",
      description: "Map provider credentials stored in the local database",
      icon: "vpn_key",
      breadcrumbs: [],
    };
  if (pathname.includes("/quota"))
    return {
      title: "Quota Tracker",
      description: "Track and manage your API quota limits",
      icon: "data_usage",
      breadcrumbs: [],
    };
  if (pathname.includes("/mitm"))
    return {
      title: "MITM Proxy",
      description: "Intercept CLI tool traffic and route through Vela",
      icon: "security",
      breadcrumbs: [],
    };
  if (pathname.includes("/token-saver"))
    return {
      title: "Token Saver",
      description: "Compress prompts and outputs to save tokens",
      icon: "savings",
      breadcrumbs: [],
    };
  if (pathname.includes("/cli-tools"))
    return {
      title: "CLI Tools",
      description: "Configure CLI tools",
      icon: "terminal",
      breadcrumbs: [],
    };
  if (pathname.includes("/proxy-pools"))
    return {
      title: "Proxy Pools",
      description: "Manage your proxy pool configurations",
      icon: "lan",
      breadcrumbs: [],
    };
  if (pathname.includes("/skills"))
    return {
      title: "Agent Skills",
      description: "Copy a link and paste to your AI to use Vela — no install needed",
      icon: "extension",
      breadcrumbs: [],
    };
  if (pathname.includes("/endpoint"))
    return {
      title: "Endpoint",
      description: "API endpoint configuration",
      icon: "api",
      breadcrumbs: [],
    };
  if (pathname.includes("/profile"))
    return {
      title: "Settings",
      description: "Manage your preferences",
      icon: "settings",
      breadcrumbs: [],
    };
  if (pathname.includes("/translator"))
    return {
      title: "Translator",
      description: "Debug translation flow between formats",
      icon: "translate",
      breadcrumbs: [],
    };
  if (pathname.includes("/console-log"))
    return {
      title: "Console Log",
      description: "Live server console output",
      icon: "monitor",
      breadcrumbs: [],
    };
  if (pathname.includes("/logs"))
    return {
      title: "Request Logs",
      description: "Every request that crossed the harbor, recorded",
      icon: "receipt_long",
      breadcrumbs: [],
    };
  if (pathname.includes("/fallback-rules"))
    return {
      title: "Fallback Rules",
      description: "Operator fallback chains for model combos",
      icon: "rule",
      breadcrumbs: [],
    };
  if (pathname.includes("/prompt-injectors"))
    return {
      title: "Prompt Injectors",
      description: "Layer operator prompts into requests",
      icon: "edit_note",
      breadcrumbs: [],
    };
  if (pathname.includes("/routed-by-combo"))
    return {
      title: "Routed by Combo",
      description: "Traffic attribution per combo",
      icon: "route",
      breadcrumbs: [],
    };
  // "/dashboard" itself is the Harbor homepage — it carries its own greeting
  // hero, so the header title slot stays empty (rendered as null).
  return { title: "", description: "", breadcrumbs: [] };
};

// The mount choreography order: title first (the focus), then the compass
// tile, then the right instruments. Delays are the rigging's sequence.
const RISE = {
  title:  { className: "mast-rise", style: { animationDelay: "0ms" } },
  tile:   { className: "mast-rise", style: { animationDelay: "60ms" } },
  panel:  { className: "mast-rise", style: { animationDelay: "120ms" } },
};

export default function Header({ onMenuClick, showMenuButton = true }) {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState("");
  const [loginMethod, setLoginMethod] = useState("");

  // Memoize page info to prevent unnecessary recalculations
  const pageInfo = useMemo(() => getPageInfo(pathname), [pathname]);
  const { title, description, icon, breadcrumbs } = pageInfo;

  useEffect(() => {
    let cancelled = false;

    async function loadAuthStatus() {
      try {
        const res = await fetch("/api/auth/status", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setDisplayName(data?.displayName || data?.samlName || data?.samlEmail || data?.oidcName || data?.oidcEmail || "");
          setLoginMethod(data?.loginMethod || "");
        }
      } catch {
        if (!cancelled) {
          setDisplayName("");
          setLoginMethod("");
        }
      }
    }

    loadAuthStatus();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) {
        window.location.assign("/login");
      }
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  return (
    <header className="mast-tide relative shrink-0 flex items-center justify-between gap-3 px-4 lg:px-8 pt-3 pb-3 border-b border-border-subtle bg-surface/60 backdrop-blur-xl lg:bg-transparent lg:backdrop-blur-none z-20">
      {/* Mobile menu button */}
      <div className="flex items-center gap-3 lg:hidden shrink-0">
        {showMenuButton && (
          <button
            onClick={onMenuClick}
            className="text-text-main hover:text-primary transition-colors"
            aria-label="Open navigation"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
        )}
      </div>

      {/* Page identity: compass tile + title + description/breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {icon && (
          <div
            className={`hidden lg:flex items-center justify-center size-10 rounded-xl bg-primary/10 border border-primary/15 shrink-0 mast-compass-tile ${RISE.tile.className}`}
            style={RISE.tile.style}
            aria-hidden="true"
          >
            <span className="material-symbols-outlined text-primary text-[22px]">
              {icon}
            </span>
          </div>
        )}
        <div className="flex flex-col min-w-0">
          {breadcrumbs.length > 0 ? (
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0">
              {breadcrumbs.map((crumb, index) => (
                <div
                  key={`${crumb.label}-${crumb.href || "current"}`}
                  className="flex items-center gap-1.5 min-w-0"
                >
                  {index > 0 && (
                    <span
                      className="material-symbols-outlined text-text-subtle text-base shrink-0"
                      aria-hidden="true"
                    >
                      chevron_right
                    </span>
                  )}
                  {crumb.href ? (
                    <Link
                      href={crumb.href}
                      className="text-xs lg:text-sm text-text-muted hover:text-primary transition-colors whitespace-nowrap"
                    >
                      {translate(crumb.label)}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2 min-w-0">
                      {crumb.image && (
                        <ProviderIcon
                          src={crumb.image}
                          alt={crumb.label}
                          size={26}
                          className="object-contain rounded max-w-[26px] max-h-[26px]"
                          fallbackText={crumb.label.slice(0, 2).toUpperCase()}
                        />
                      )}
                      <h1 className={`text-sm lg:text-lg font-semibold text-text-main tracking-tight truncate ${RISE.title.className}`} style={RISE.title.style}>
                        {translate(crumb.label)}
                      </h1>
                    </div>
                  )}
                </div>
              ))}
            </nav>
          ) : title ? (
            <div className="min-w-0">
              <h1 className={`text-sm lg:text-lg font-semibold tracking-tight truncate ${RISE.title.className}`} style={RISE.title.style}>
                {translate(title)}
              </h1>
              {description && (
                <p
                  className={`hidden lg:block text-xs text-text-muted truncate mt-0.5 ${RISE.tile.className}`}
                  style={RISE.tile.style}
                >
                  {translate(description)}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Right instruments — organized clusters */}
      <div className={`flex items-center gap-1 shrink-0 ${RISE.panel.className}`} style={RISE.panel.style}>
        {displayName && (loginMethod === "OIDC" || loginMethod === "SAML") && (
          <div
            className="hidden sm:flex items-center max-w-[220px] px-3 py-1.5 rounded-full border border-border bg-surface/70 text-xs text-text-muted truncate"
            title={displayName}
          >
            <span className="material-symbols-outlined text-[14px] mr-1.5 text-primary">person</span>
            <span className="truncate">{displayName}</span>
            <span className="ml-2 shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {loginMethod}
            </span>
          </div>
        )}

        {/* The beacon — live version / update signal (status cluster) */}
        <StatusBeacon />

        {/* Search cluster: store-driven search + `/` shortcut */}
        <HeaderSearch />

        {/* Preferences cluster */}
        <ThemeToggle />
        <HeaderLanguage />

        {/* Commands cluster */}
        <QuickNav />
        <HeaderMenu onLogout={handleLogout} />
      </div>
    </header>
  );
}

function HeaderSearch() {
  const visible = useHeaderSearchStore((s) => s.visible);
  const query = useHeaderSearchStore((s) => s.query);
  const placeholder = useHeaderSearchStore((s) => s.placeholder);
  const setQuery = useHeaderSearchStore((s) => s.setQuery);
  const inputRef = useRef(null);

  // "/" focuses the search when the page offers one — a gateway operator's
  // reflex. Skipped while typing in any input/textarea/contenteditable, so
  // the shortcut never steals a keystroke from a form.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return;
      e.preventDefault();
      document.getElementById("vela-header-search")?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="relative w-[160px] sm:w-[220px]">
      <span
        className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-text-muted text-[16px] pointer-events-none"
        aria-hidden="true"
      >
        search
      </span>
      <input
        id="vela-header-search"
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="w-full h-8 pl-7 pr-7 rounded-lg border border-border bg-surface/60 text-sm focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/20 transition-all"
      />
      {query ? (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main p-0.5 rounded"
          aria-label="Clear search"
        >
          <span className="material-symbols-outlined text-[16px]">close</span>
        </button>
      ) : (
        <kbd
          className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 items-center h-4.5 px-1 rounded border border-border bg-surface text-[10px] font-mono text-text-subtle pointer-events-none"
          aria-hidden="true"
        >
          /
        </kbd>
      )}
    </div>
  );
}

Header.propTypes = {
  onMenuClick: PropTypes.func,
  showMenuButton: PropTypes.bool,
};
