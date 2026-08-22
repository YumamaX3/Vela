export default {
  id: "databricks",
  priority: 128,
  alias: "dbx",
  display: {
    name: "Databricks Workspace API",
    icon: "settings_applications",
    color: "#F97316",
    textIcon: "DBX",
    website: "https://databricks.com/",
    notice: {
      apiKeyUrl: "https://docs.databricks.com/en/dev-tools/api-keys.html",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.workspaces.{region}.gcp.databricks.com/serving-endpoints/{model}/invocations",
    format: "openai",
  },
  models: [
    { id: "dbrx-latest", name: "DBRX Latest" },
    { id: "llama-3-70b-databricks", name: "Llama 3 70B (Databricks)" },
  ],
};
