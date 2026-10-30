export default {
  id: "zcode-plan",
  priority: 108,
  alias: "zcode-plan",
  display: {
    name: "ZCode Start Plan (Z.ai)",
    icon: "code",
    color: "#8B5CF6",
    textIcon: "ZP",
    website: "https://zcode.z.ai",
  },
  category: "oauth",
  hasOAuth: true,
  authType: "oauth",
  transport: {
    baseUrl: "https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages",
    format: "claude",
  },
  models: [
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
  ],
  features: { usage: true },
};
