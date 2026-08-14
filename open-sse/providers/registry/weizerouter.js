// WeiZerRouter (weizerouter.web.id) — OpenAI-compatible router on /v1.
// Researched 2026-08-14: DNS resolves (103.93.162.188) but the TLS handshake
// rejected every probe (SEC_E_ILLEGAL_MESSAGE), so the catalog is unknown.
// Passthrough routes any model id once the gate opens and a key is added.
export default {
  id: "weizerouter",
  alias: "wzr",
  uiAlias: "wzr",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 94,
  display: {
    name: "WeiZerRouter",
    icon: "router",
    color: "#38BDF8",
    textIcon: "WZ",
    website: "https://weizerouter.web.id",
    notice: {
      text: "TLS handshake refused research probes (2026-08-14) — verify the endpoint before relying on it.",
      apiKeyUrl: "https://weizerouter.web.id",
    },
  },
  transport: {
    baseUrl: "https://weizerouter.web.id/v1/chat/completions",
    validateUrl: "https://weizerouter.web.id/v1/models",
  },
  passthroughModels: true,
  models: [],
  serviceKinds: ["llm"],
};
