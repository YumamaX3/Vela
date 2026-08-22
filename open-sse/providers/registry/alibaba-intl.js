export default {
  id: "alibaba-intl",
  priority: 109,
  alias: "alintrn",
  display: {
    name: "Alibaba Cloud International",
    icon: "language",
    color: "#F97316",
    textIcon: "ALIINTL",
    website: "https://www.alibabacloud.com/",
    notice: {
      apiKeyUrl: "https://usercenter.intl.aliyun.com/apiKey",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://dashscope-intl.aliyuncs.com/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "qwen-intl-v2", name: "Qwen Intl V2" },
  ],
};
