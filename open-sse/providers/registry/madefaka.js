export default {
  id: "madefaka",
  priority: 82,
  hasFree: true,
  alias: "madefaka",
  display: {
    name: "Madefaka",
    icon: "sailing",
    color: "#2563EB",
    textIcon: "MF",
    website: "https://madefaka.my.id",
    notice: {
      apiKeyUrl: "https://madefaka.my.id",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://madefaka.my.id/v1/chat/completions",
    validateUrl: "https://madefaka.my.id/v1/models",
    responsesUrl: "https://madefaka.my.id/v1/responses",
  },
  models: [
    { id: "deepseek-ai/DeepSeek-V4-Flash", name: "DeepSeek V4 Flash" },
    { id: "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16", name: "NVIDIA Nemotron 3.5 Lightning 30B" },
    { id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMaxAI/MiniMax-M3", name: "MiniMax M3" },
  ],
  serviceKinds: ["llm", "embedding"],
  embeddingConfig: {
    baseUrl: "https://madefaka.my.id/v1/embeddings",
    authType: "apikey",
    authHeader: "bearer",
  },
};
