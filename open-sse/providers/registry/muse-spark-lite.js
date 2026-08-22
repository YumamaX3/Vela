export default {
  id: "muse-spark-lite",
  priority: 109,
  alias: "mswlite",
  display: {
    name: "Muse Spark Lite",
    icon: "speed",
    color: "#3B82F6",
    textIcon: "MSWLT",
    website: "https://spark.muse.ai/lite/",
    notice: {
      apiKeyUrl: "https://console.spark.muse.ai/api-keys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://spark-lite.muse.ai/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "spark-lite-35b", name: "Spark Lite 35B" },
  ],
};
