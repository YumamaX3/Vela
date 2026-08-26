/** Settings sub-nav items — consumed by Sidebar as an accordion, mirroring Media Providers. */
export const SETTINGS_NAV_ITEMS = [
  { id: "appearance",     href: "/dashboard/settings/appearance",     icon: "palette",      label: "Appearance",      desc: "Theme, accent, density, font size, reduce motion, high contrast" },
  { id: "security",       href: "/dashboard/settings/security",       icon: "shield",       label: "Security",        desc: "Require login, password, session timeout, IP allowlist, lockout, audit" },
  { id: "authentication", href: "/dashboard/settings/authentication", icon: "key",          label: "Authentication",  desc: "Auth mode, OIDC, SAML 2.0, API key required" },
  { id: "routing",        href: "/dashboard/settings/routing",        icon: "route",        label: "Routing",         desc: "Fallback strategy, combo rotation, sticky limits, max retries" },
  { id: "token-savers",   href: "/dashboard/settings/token-savers",   icon: "compress",     label: "Token Savers",    desc: "RTK pre-translate filters: caveman, ponytail, pxpipe, headroom" },
  { id: "network",        href: "/dashboard/settings/network",        icon: "wifi",         label: "Network",         desc: "Outbound proxy, timeouts, keep-alive, DNS prefetch, geo probe" },
  { id: "storage",        href: "/dashboard/settings/storage",        icon: "database",     label: "Storage",         desc: "Usage retention, request payloads, backup engine" },
  { id: "alerts",         href: "/dashboard/settings/alerts",         icon: "notifications",label: "Alerts",           desc: "Budget alerts, weekly digest, usage webhook" },
  { id: "observability",  href: "/dashboard/settings/observability",  icon: "monitoring",   label: "Observability",   desc: "Ring buffer, flush interval, batch size, max JSON payload" },
  { id: "capacity",       href: "/dashboard/settings/capacity",       icon: "tune",         label: "Capacity",        desc: "Media model routing: vision, PDF, audio, video" },
  { id: "system",         href: "/dashboard/settings/system",         icon: "terminal",     label: "System",          desc: "Shutdown, logout, app info, diagnostics" },
];