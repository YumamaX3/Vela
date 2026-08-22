export default {
  id: "agentrouter-pro",
  priority: 109,
  alias: "arpro",
  display: {
    name: "AgentRouter Pro",
    icon: "badge",
    color: "#14B8A6",
    textIcon: "ARP",
    website: "https://agentrouter.pro/",
    notice: {
      apiKeyUrl: "https://pro.agentrouter.ai/dashboard/settings",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.pro.agentrouter.ai/v2/chat/completions",
    format: "openai",
  },
  models: [
    { id: "ar-pro-smart", name: "AgentRouter Pro Smart" },
    { id: "ar-premium", name: "AgentRouter Premium" },
  ],
};
