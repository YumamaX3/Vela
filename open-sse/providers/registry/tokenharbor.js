// Token Harbor — "One API for the world's leading AI models". Standard
// OpenAI-compatible error envelope (invalid_api_key). Catalog is key-gated;
// passthrough routes any model id once a key is connected.
export default {
  id: "tokenharbor",
  alias: "th",
  uiAlias: "th",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 86,
  display: {
    name: "Token Harbor",
    icon: "anchor",
    color: "#1A1918",
    textIcon: "TH",
    website: "https://tokenharbor.ai",
    notice: { apiKeyUrl: "https://tokenharbor.ai/dashboard" },
  },
  transport: {
    baseUrl: "https://tokenharbor.ai/v1/chat/completions",
    validateUrl: "https://tokenharbor.ai/v1/models",
  },
  passthroughModels: true,
  models: [],
  serviceKinds: ["llm"],
};
