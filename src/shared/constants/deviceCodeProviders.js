// Device-code OAuth providers — the single source of truth for the three
// hand-maintained arrays that gate the flow (oauth route GET device-code,
// oauth route POST poll, and the OAuthModal UI branch). Membership here is
// mechanically assertable without rendering a React component.
//
// To add a device-code provider: add its id here AND wire its module into
// src/lib/oauth/providers/index.js with flowType: "device_code".

// All device-code providers (modal branch + GET device-code list).
export const DEVICE_CODE_PROVIDERS = [
  "github",
  "kiro",
  "kimi",
  "kimi-coding",
  "kilocode",
  "codebuddy-cn",
  "codebuddy-intl",
  "qoder",
  "grok-cli",
  "freebuff",
];

// Subset that polls WITHOUT a PKCE code verifier (noPkceProviders on the
// POST poll branch). Providers needing extraData/verifier keep their own
// route branches (kiro/qoder) and stay out of this list.
export const NO_PKCE_POLL_PROVIDERS = [
  "github",
  "kimi",
  "kimi-coding",
  "kilocode",
  "codebuddy-cn",
  "codebuddy-intl",
  "freebuff",
];
