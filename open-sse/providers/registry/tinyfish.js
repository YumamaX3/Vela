// TinyFish — one API-key connection serves both web search and web fetch.
// Search: GET with an x-api-key header, three search types. Fetch: POST
// returning markdown or html, bounded at 100k characters.
export default {
  id: "tinyfish",
  alias: "tinyfish",
  uiAlias: "tinyfish",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 90,
  display: {
    name: "TinyFish",
    icon: "phishing",
    color: "#FF6700",
    textIcon: "TF",
    website: "https://www.tinyfish.ai/",
    notice: { apiKeyUrl: "https://agent.tinyfish.ai/api-keys" },
  },
  serviceKinds: ["webSearch", "webFetch"],
  searchConfig: {
    baseUrl: "https://api.search.tinyfish.ai",
    validateUrl: "https://api.search.tinyfish.ai/usage?limit=1",
    method: "GET",
    authType: "apikey",
    authHeader: "x-api-key",
    costPerQuery: 0,
    searchTypes: ["web", "news", "research_paper"],
    defaultMaxResults: 5,
    maxMaxResults: 10,
    timeoutMs: 10000,
  },
  fetchConfig: {
    baseUrl: "https://api.fetch.tinyfish.ai",
    method: "POST",
    authType: "apikey",
    authHeader: "x-api-key",
    costPerQuery: 0,
    formats: ["markdown", "html"],
    maxCharacters: 100000,
    timeoutMs: 150000,
  },
};
