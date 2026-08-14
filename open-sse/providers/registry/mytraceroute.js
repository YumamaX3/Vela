// MyTraceRoute — "Unified AI API Gateway" (mytraceroute.web.id), base path
// /v2. Researched 2026-08-14: the product site is live, but the API host
// answered 502 (upstream down) on every probe, so the catalog is unknown.
// Passthrough routes any model id once the API recovers and a key is added.
export default {
  id: "mytraceroute",
  alias: "mtr",
  uiAlias: "mtr",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 92,
  display: {
    name: "MyTraceRoute",
    icon: "share_location",
    color: "#D8D8D8",
    textIcon: "MT",
    website: "https://mytraceroute.web.id",
    notice: {
      text: "API host was returning 502 at research time (2026-08-14) — models appear once the service recovers.",
      apiKeyUrl: "https://mytraceroute.web.id",
    },
  },
  transport: {
    baseUrl: "https://api.mytraceroute.web.id/v2/chat/completions",
    validateUrl: "https://api.mytraceroute.web.id/v2/models",
  },
  passthroughModels: true,
  models: [],
  serviceKinds: ["llm"],
};
