export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Zen",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OZ",
    website: "https://opencode.ai/auth",
    notice: {
      text: "Zen free models run keyless out of the box. Add an OpenCode API key to lift rate limits and reach paid Zen models — connections with a key always take precedence over the keyless lane.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  // freeTier with a keyless fallback lane: auth.js honors real apikey
  // connections first and only injects the virtual "Public" connection when
  // none exist (see getProviderCredentials — hybrid noAuth handling).
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
  },
  models: [],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
