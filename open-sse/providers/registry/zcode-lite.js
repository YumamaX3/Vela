export default {
  id: "zcode-lite",
  priority: 129,
  alias: "zcodeLite",
  display: {
    name: "ZCode Lite",
    icon: "lightbulb",
    color: "#EF4444",
    textIcon: "ZLITE",
    website: "https://zcode.io/lite/",
    notice: {
      apiKeyUrl: "https://lite.zcode.io/settings/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://lite.zcode.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "zcode-lite-fast", name: "ZCode Lite Fast" },
    { id: "zcode-lite-economy", name: "ZCode Lite Economy" },
  ],
};
