export default {
  id: "zcode",
  priority: 109,
  alias: "zcode",
  display: {
    name: "ZCode API Provider",
    icon: "code",
    color: "#DC2626",
    textIcon: "ZC",
    website: "https://api.zcode.io/",
    notice: {
      apiKeyUrl: "https://dashboard.zcode.io/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.zcode.io/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "zcode-advanced-v1", name: "ZCode Advanced V1" },
    { id: "zcode-fast-v2", name: "ZCode Fast V2" },
  ],
};
