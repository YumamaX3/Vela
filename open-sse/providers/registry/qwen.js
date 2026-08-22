export default {
  id: "qwen",
  priority: 105,
  alias: "qwen",
  display: {
    name: "Qwen",
    icon: "smart_toy",
    color: "#6B46C1",
    textIcon: "QW",
    website: "https://tongyi.aliyun.com/qwen",
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
    { id: "qwen-plus", name: "Qwen Plus" },
    { id: "qwen-max", name: "Qwen Max" },
    { id: "qwen-turbo", name: "Qwen Turbo" },
    { id: "qwen-long", name: "Qwen Long" },
  ],
};
