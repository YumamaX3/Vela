// FreeAI by JembatanAI — Indonesian AI gateway ("Satu Endpoint AI untuk
// Developer Indonesia"). /v1/models is key-gated (401 without a key), so the
// catalog is discovered at connect time — passthrough routes any model id.
export default {
  id: "jembatanai",
  alias: "ja",
  uiAlias: "ja",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 84,
  hasFree: true,
  display: {
    name: "FreeAI (JembatanAI)",
    icon: "lan",
    color: "#18B888",
    textIcon: "JA",
    website: "https://jembatanai.com",
    notice: { text: "Free tier for Indonesian developers.", apiKeyUrl: "https://freeai.jembatanai.com" },
  },
  transport: {
    baseUrl: "https://freeai.jembatanai.com/v1/chat/completions",
    validateUrl: "https://freeai.jembatanai.com/v1/models",
  },
  passthroughModels: true,
  models: [],
  serviceKinds: ["llm"],
};
