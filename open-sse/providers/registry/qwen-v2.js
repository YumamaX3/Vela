export default {
  id: "qwen-v2",
  priority: 109,
  alias: "qwenv2",
  display: {
    name: "Qwen V2 Enterprise",
    icon: "smart_toy",
    color: "#8B5CF6",
    textIcon: "QWEN2",
    website: "https://tongyi.aliyun.com/qwen/",
    notice: {
      apiKeyUrl: "https://dashscope.console.aliyun.com/apikey",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://dashscope.aliyuncs.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "qwen2-72b-instruct", name: "Qwen2 72B Instruct" },
    { id: "qwen2.5-72b-instruct", name: "Qwen2.5 72B Instruct" },
  ],
};
