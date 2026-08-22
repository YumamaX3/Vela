export default {
  id: "snowflake",
  priority: 115,
  alias: "snowflake",
  display: {
    name: "Snowflake Cortex",
    icon: "snowflake",
    color: "#F472B6",
    textIcon: "SNOW",
    website: "https://www.snowflake.com/en/products/cortex/",
    notice: {
      apiKeyUrl: "https://docs.snowflake.com/en/developer-guide/snowflake-cloud-data-platform/cortex/api",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://HOST.SNOWFLAKE.COM/v1/models/SPECIFIC_MODEL_NAME/chat_completions",
    format: "openai",
  },
  models: [
    { id: "snowflake-arctic", name: "Snowflake Arctic" },
    { id: "snowflake-arctic-lite", name: "Snowflake Arctic-Lite" },
  ],
};
