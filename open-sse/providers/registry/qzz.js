// QZZ Solution Router (id.solution.qzz.io) — OpenAI-compatible router.
// Anthropic-style auth error envelope ("missing API key" /
// authentication_error). Catalog is key-gated; passthrough routes any model
// id once a key is connected.
export default {
  id: "qzz",
  alias: "qz",
  aliases: ["idrouter", "qzz-solution"],
  uiAlias: "qz",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 88,
  display: {
    name: "QZZ Router",
    icon: "route",
    color: "#4CE844",
    textIcon: "QZ",
    website: "https://id.solution.qzz.io",
    notice: { apiKeyUrl: "https://id.solution.qzz.io" },
  },
  transport: {
    baseUrl: "https://id.solution.qzz.io/v1/chat/completions",
    validateUrl: "https://id.solution.qzz.io/v1/models",
  },
  passthroughModels: true,
  models: [],
  serviceKinds: ["llm"],
};
