// Agnes AI — OpenAI-compatible gateway with free sign-up credits.
// Accepts either a bearer token or an x-api-key header.
//
// The live catalogue at apihub.agnes-ai.com/v1/models requires a token (401
// "Token not provided"), so the ids below are a curated seed rather than a
// verified dump — passthroughModels still accepts any id the account holds.
export default {
  id: "agnes",
  alias: "agnes",
  uiAlias: "agnes",
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 120,
  hasFree: true,
  display: {
    name: "Agnes AI",
    icon: "auto_awesome",
    color: "#7C3AED",
    textIcon: "AG",
    website: "https://agnes-ai.com",
    notice: {
      text: "OpenAI-compatible gateway from Agnes AI, offering free API credits on sign-up. Accepts a bearer token or an x-api-key header.",
      apiKeyUrl: "https://platform.agnes-ai.com",
    },
  },
  transport: {
    baseUrl: "https://apihub.agnes-ai.com/v1/chat/completions",
    validateUrl: "https://apihub.agnes-ai.com/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "claude-opus-5", name: "Claude Opus 5" },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "glm-5.2", name: "GLM 5.2" },
    { id: "kimi-k3", name: "Kimi K3" },
  ],
  serviceKinds: ["llm"],
};
