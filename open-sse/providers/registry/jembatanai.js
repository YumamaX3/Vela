// FreeAI by JembatanAI — Indonesian AI gateway ("Satu Endpoint AI untuk
// Developer Indonesia"). "FreeAI" is the product name, NOT a free tier —
// this is a paid key-gated service. Catalog from the Star's intel
// (2026-08-27); ids carry the router prefix (deepseek/..., openai/...).
// The jailbreak lane appends `-jailbreak` to the base model id and is
// priced as its own catalog entry (models.dev/api.json sync).
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
    // ── Jailbreak lane ──────────────────────────────────────────────
    { id: "deepseek/deepseek-v4-pro-0813-jailbreak", name: "DeepSeek V4 Pro (0813) Jailbreak" },
    { id: "deepseek/deepseek-v4-flash-0731-jailbreak", name: "DeepSeek V4 Flash (0731) Jailbreak" },
    { id: "openai/gpt-5.6-luna-jailbreak", name: "GPT-5.6 Luna Jailbreak" },
    { id: "anthropic/claude-sonnet-5-jailbreak", name: "Claude Sonnet 5 Jailbreak" },
    { id: "z-ai/glm-5.2-jailbreak", name: "GLM 5.2 Jailbreak" },
    { id: "anthropic/claude-opus-4.8-jailbreak", name: "Claude Opus 4.8 Jailbreak" },
    { id: "qwen/qwen3.8-max-jailbreak", name: "Qwen3.8-Max Jailbreak" },
    { id: "moonshotai/kimi-k3-jailbreak", name: "Kimi K3 Jailbreak" },
    { id: "z-ai/glm-5.3-jailbreak", name: "GLM 5.3 Jailbreak" },
    // ── Base lane ───────────────────────────────────────────────────
    { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "openai/gpt-5.6-luna", name: "GPT-5.6 Luna" },
    { id: "deepseek/deepseek-v4-pro-0813", name: "DeepSeek V4 Pro (0813)" },
    { id: "deepseek/deepseek-v4-flash-0731", name: "DeepSeek V4 Flash (0731)" },
    { id: "z-ai/glm-5.2", name: "GLM 5.2" },
    { id: "anthropic/claude-opus-4.8", name: "Claude Opus 4.8" },
    { id: "qwen/qwen3.8-max", name: "Qwen3.8-Max" },
    { id: "moonshotai/kimi-k3", name: "Kimi K3" },
    { id: "z-ai/glm-5.3", name: "GLM 5.3" },
  ],
  serviceKinds: ["llm"],
};
