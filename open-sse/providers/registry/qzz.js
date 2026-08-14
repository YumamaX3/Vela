// IDRouter (id.solution.qzz.io) — OpenAI-compatible router. Anthropic-style
// auth error envelope ("missing API key" / authentication_error). Catalog
// from the Star's intel (2026-08-14): DeepSeek V4 Flash variants by client
// profile (cmc/cp/oc/qd) + qoder-lite.
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
    name: "IDRouter",
    icon: "route",
    color: "#4CE844",
    textIcon: "ID",
    website: "https://id.solution.qzz.io",
    notice: { apiKeyUrl: "https://id.solution.qzz.io" },
  },
  transport: {
    baseUrl: "https://id.solution.qzz.io/v1/chat/completions",
    validateUrl: "https://id.solution.qzz.io/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "deepseek-v4-flash-cmc", name: "DeepSeek V4 Flash (CMC)" },
    { id: "deepseek-v4-flash-cp", name: "DeepSeek V4 Flash (CP)" },
    { id: "deepseek-v4-flash-oc", name: "DeepSeek V4 Flash (OC)" },
    { id: "deepseek-v4-flash-qd", name: "DeepSeek V4 Flash (QD)" },
    { id: "qoder-lite", name: "Qoder Lite" },
  ],
  serviceKinds: ["llm"],
};
