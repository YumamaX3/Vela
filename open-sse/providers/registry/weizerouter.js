// WeizeRouter (weizerouter.web.id) — OpenAI-compatible router on /v1. The
// TLS gate refused research probes (2026-08-14), so the catalog came from the
// Star's own model directory — 23 healthy models, all wz/-prefixed, validated
// 2026-08-13 WIB. Logo provided by the Star.
export default {
  id: "weizerouter",
  alias: "wzr",
  uiAlias: "wzr",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 94,
  display: {
    name: "WeizeRouter",
    icon: "router",
    color: "#38BDF8",
    textIcon: "WZ",
    website: "https://weizerouter.web.id",
    notice: {
      text: "Models mahal dan langka — gunakan yang lebih hemat bila perlu. Directory lists healthy, validated models only.",
      apiKeyUrl: "https://weizerouter.web.id",
    },
  },
  transport: {
    baseUrl: "https://weizerouter.web.id/v1/chat/completions",
    validateUrl: "https://weizerouter.web.id/v1/models",
  },
  passthroughModels: true,
  models: [
    // GPT-5.6
    { id: "wz/gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "wz/gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "wz/gpt-5.6-terra", name: "GPT-5.6 Terra" },
    // GPT-5.5
    { id: "wz/gpt-5.5", name: "GPT-5.5" },
    { id: "wz/gpt-5.5-review", name: "GPT-5.5 (Review)" },
    // GPT-5.4
    { id: "wz/gpt-5.4", name: "GPT-5.4" },
    { id: "wz/gpt-5.4-review", name: "GPT-5.4 (Review)" },
    { id: "wz/gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "wz/gpt-5.4-mini-review", name: "GPT-5.4 Mini (Review)" },
    // DeepSeek
    { id: "wz/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    // Claude
    { id: "wz/claude-fable-5", name: "Claude Fable 5" },
    { id: "wz/claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "wz/claude-opus-4.7", name: "Claude Opus 4.7" },
    { id: "wz/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    // Multi
    { id: "wz/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    // MiniMax
    { id: "wz/minimax-m2.7", name: "MiniMax M2.7" },
    { id: "wz/minimax-m3", name: "MiniMax M3" },
    // Qwen
    { id: "wz/qwen3.6-plus", name: "Qwen 3.6 Plus" },
    { id: "wz/qwen3.7-max", name: "Qwen 3.7 Max" },
    { id: "wz/qwen3.7-plus", name: "Qwen 3.7 Plus" },
    // GLM
    { id: "wz/glm-5.1", name: "GLM 5.1" },
    { id: "wz/glm-5.2", name: "GLM 5.2" },
    // HY
    { id: "wz/hy3", name: "HY3" },
  ],
  serviceKinds: ["llm"],
};
