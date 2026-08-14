// FreeAI by JembatanAI — Indonesian AI gateway ("Satu Endpoint AI untuk
// Developer Indonesia"). "FreeAI" is the product name, NOT a free tier —
// this is a paid key-gated service. Catalog from the Star's intel
// (2026-08-14); ids carry the router prefix (deepseek/..., openai/...).
export default {
  id: "jembatanai",
  alias: "ja",
  uiAlias: "ja",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 84,
  display: {
    name: "FreeAI (JembatanAI)",
    icon: "lan",
    color: "#18B888",
    textIcon: "JA",
    website: "https://jembatanai.com",
    notice: { apiKeyUrl: "https://freeai.jembatanai.com" },
  },
  transport: {
    baseUrl: "https://freeai.jembatanai.com/v1/chat/completions",
    validateUrl: "https://freeai.jembatanai.com/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro (0813)" },
    { id: "deepseek/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash (0731)" },
    { id: "deepseek/deepseek-v4-pro-jailbreak", name: "DeepSeek V4 Pro (Jailbreak)" },
    { id: "deepseek-v4-pro-jailbreak", name: "DeepSeek V4 Pro (Jailbreak, bare)" },
    { id: "minimax/minimax-m3", name: "MiniMax M3" },
    { id: "z-ai/glm-5.2", name: "GLM 5.2" },
    { id: "qwen/qwen3.8-max", name: "Qwen3.8-Max" },
  ],
  serviceKinds: ["llm"],
};
