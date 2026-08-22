// Storage Covenant Wave A7 — the pure settings core, shared by BOTH harbors.
// DEFAULT_SETTINGS + mergeWithDefaults carry no persistence — they are logic,
// not SQL, so they live in the seam (not duplicated into each harbor, where a
// new setting would drift between twins). Both repos/sqlite/settingsRepo.js
// and repos/mysql/settingsRepo.js import from here.

const DEFAULT_MITM_ROUTER_BASE = "http://localhost:32060";
const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

export const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  tailscaleEnabled: false,
  tailscaleUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  capacityAdapter: {
    vision: { enabled: true, roundRobin: false, models: [] },
    pdf: { enabled: false, roundRobin: false, models: [] },
    audioInput: { enabled: true, roundRobin: false, models: [] },
    videoInput: { enabled: false, roundRobin: false, models: [] },
  },
  requireLogin: true,
  requireApiKey: true,
  tunnelDashboardAccess: true,
  authMode: "password",
  ssoType: "oidc",
  oidcIssuerUrl: "",
  oidcClientId: "",
  oidcClientSecret: "",
  oidcScopes: "openid profile email",
  oidcLoginLabel: "Sign in with OIDC",
  samlEntryPoint: "",
  samlIssuer: "urn:Vela:sp",
  samlCert: "",
  samlLoginLabel: "Sign in with SAML SSO",
  samlAttributeEmail: "email",
  samlAttributeName: "name",
  enableObservability: false,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: DEFAULT_MITM_ROUTER_BASE,
  dnsToolEnabled: {},
  rtkEnabled: true,
  headroomEnabled: false,
  headroomUrl: DEFAULT_HEADROOM_URL,
  headroomCompressUserMessages: false,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",
  pxpipeEnabled: false,
  pxpipeAutoInstall: true,
  pxpipeMinChars: 25000,
  pxpipeTimeoutMs: 15000,
  // Usage Observatory W3-C — budget alert channels. Webhook URLs are
  // operator-supplied and secret-bearing (a Discord webhook URL carries a
  // token) — the delivery layer never logs them.
  budgetAlerts: {
    discordEnabled: false,
    discordWebhookUrl: "",
    n8nEnabled: false,
    n8nWebhookUrl: "",
    // Usage Observatory W3-D — the weekly usage digest rides the same
    // operator-configured channels as the budget alerts.
    weeklyDigestEnabled: false,
  },
};

// Merge raw settings with defaults; backward-compat for missing keys
export function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      if (
        key === "outboundProxyEnabled" &&
        typeof merged.outboundProxyUrl === "string" &&
        merged.outboundProxyUrl.trim()
      ) {
        merged[key] = true;
      } else {
        merged[key] = defVal;
      }
    }
  }
  // W3-D backfill: an existing budgetAlerts row written before the weekly
  // digest lands misses `weeklyDigestEnabled` — the shallow merge above keeps
  // the stored object verbatim, so top up missing keys from the defaults
  // (defaults first, stored values win → URLs and flags are preserved).
  if (merged.budgetAlerts && typeof merged.budgetAlerts === "object") {
    merged.budgetAlerts = { ...DEFAULT_SETTINGS.budgetAlerts, ...merged.budgetAlerts };
  }
  return merged;
}
