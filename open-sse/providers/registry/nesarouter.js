// NesaRouter — "API AI OpenAI-compatible" (nesarouter.com). The catalog is
// key-gated ("Missing NesaRouter API key"); passthrough routes any model id
// once a key is connected.
export default {
  id: "nesarouter",
  alias: "nr",
  uiAlias: "nr",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 90,
  display: {
    name: "NesaRouter",
    icon: "hub",
    color: "#D36A2D",
    textIcon: "NR",
    website: "https://nesarouter.com",
    notice: { apiKeyUrl: "https://nesarouter.com/docs" },
  },
  transport: {
    baseUrl: "https://nesarouter.com/v1/chat/completions",
    validateUrl: "https://nesarouter.com/v1/models",
  },
  passthroughModels: true,
  models: [],
  serviceKinds: ["llm"],
};
