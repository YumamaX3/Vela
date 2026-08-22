export default {
  id: "ai21",
  priority: 108,
  alias: "ai21",
  display: {
    name: "AI21 Studios",
    icon: "smart_toy",
    color: "#10B981",
    textIcon: "AI21",
    website: "https://www.ai21.com",
    notice: {
      apiKeyUrl: "https://studio.ai21.com/admin/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.ai21.com/studio/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "jamba-1-5-large", name: "Jamba 1.5 Large" },
    { id: "jamba-1-5-mini", name: "Jamba 1.5 Mini" },
    { id: "jamba-instruct", name: "Jamba Instruct" },
  ],
};
