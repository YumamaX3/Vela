// Dahl Inference — OpenAI-compatible Gonka node, flat per-token rate.
// The live catalogue is public (no auth), so modelsFetcher works without a key
// and the ids below are a convenience seed rather than an exhaustive list.
export default {
  id: "dahl",
  alias: "dahl",
  uiAlias: "dahl",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 120,
  display: {
    name: "Dahl Inference",
    icon: "hub",
    color: "#1E40AF",
    textIcon: "DH",
    website: "https://dahl.global",
    notice: {
      text: "OpenAI-compatible Gonka inference node. Small, fixed catalogue (GLM-5.3-Flash, DeepSeek-V4-Flash, MiniMax-M2.7) at a flat per-token rate.",
      apiKeyUrl: "https://dahl.global/dashboard",
    },
  },
  transport: {
    baseUrl: "https://inference.dahl.global/v1/chat/completions",
    validateUrl: "https://inference.dahl.global/v1/models",
  },
  modelsFetcher: { url: "https://inference.dahl.global/v1/models", type: "openai" },
  models: [
    { id: "zai-org/GLM-5.3-Flash", name: "GLM-5.3 Flash" },
    { id: "deepseek-ai/DeepSeek-V4-Flash-0731", name: "DeepSeek V4 Flash 0731" },
    { id: "minimaxai/MiniMax-M2.7", name: "MiniMax M2.7" },
  ],
  serviceKinds: ["llm"],
};
