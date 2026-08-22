export default {
  id: "muse-spark-web",
  priority: 129,
  alias: "msw",
  display: {
    name: "Muse Spark Web Alternative",
    icon: "web",
    color: "#0EA5E9",
    textIcon: "MSWA",
    website: "https://spark.muse.ai/",
    notice: {
      apiKeyUrl: "https://api.muse.ai/dashboard/settings",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://spark.muse.ai/api/v1/chat",
    format: "openai",
  },
  models: [
    { id: "spark-alternative-v1", name: "Spark Alternative V1" },
  ],
};
