export default {
  id: "agentrouter",
  priority: 118,
  alias: "arouter",
  display: {
    name: "AgentRouter Lite",
    icon: "route",
    color: "#EC4899",
    textIcon: "ARL",
    website: "https://agentrouter.io/",
    notice: {
      apiKeyUrl: "https://console.agentrouter.io/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.agentrouter.io/chat/completions",
    format: "openai",
  },
  models: [
    { id: "lite-v1", name: "AgentRouter Lite V1" },
    { id: "lite-beta", name: "AgentRouter Lite Beta" },
  ],
};
