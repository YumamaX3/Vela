export default {
  id: "alibaba",
  priority: 105,
  alias: "alibaba",
  display: {
    name: "Alibaba Cloud Model Studio",
    icon: "cloud",
    color: "#FF6B35",
    textIcon: "ALI",
    website: "https://www.aliyun.com/product/model-studio",
    notice: {
      apiKeyUrl: "https://dashscope.aliyun.com/apikeys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "qwen-plus", name: "Qwen Plus (AliCloud)" },
    { id: "qwen-max", name: "Qwen Max (AliCloud)" },
  ],
};
