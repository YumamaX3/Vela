// B.AI — OpenAI-compatible gateway with one of the larger catalogues here.
// Accepts a bearer token or an x-api-key header. No ids are hardcoded: the
// catalogue is large and rotates, so the live endpoint is the source of truth
// and any id is accepted through passthroughModels.
export default {
  id: "bai",
  alias: "bai",
  uiAlias: "bai",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 120,
  display: {
    name: "B.AI",
    icon: "account_balance",
    color: "#0369A1",
    textIcon: "BA",
    website: "https://b.ai",
    notice: {
      text: "OpenAI-compatible gateway with one of the larger catalogues here. Accepts a bearer token or an x-api-key header. Model ids are fetched live from the provider.",
      apiKeyUrl: "https://b.ai",
    },
  },
  transport: {
    baseUrl: "https://api.b.ai/v1/chat/completions",
    validateUrl: "https://api.b.ai/v1/models",
  },
  modelsFetcher: { url: "https://api.b.ai/v1/models", type: "openai" },
  passthroughModels: true,
  models: [],
  serviceKinds: ["llm"],
};
