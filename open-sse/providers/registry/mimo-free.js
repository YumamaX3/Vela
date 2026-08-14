// Xiaomi ended the free MiMo channel, and upstream hid this provider
// (commit 6d96e24b). Live-verified 2026-08-14: the bootstrap endpoint still
// issues a JWT, but the chat endpoint returns 400 "Unsupported model" for
// every model id probed — the service shell is alive with no routable models.
// Surfaced again at the Star's decree (v0.6.13) so the card stands watch on
// the providers page; requests will fail until upstream restores a model or
// the OAuth MiMo Platform replacement is wired.
export default {
  id: "mimo-free",
  hidden: false,
  priority: 50,
  hasFree: true,
  alias: "mmf",
  uiAlias: "mmf",
  display: {
    name: "MiMo Code Free",
    icon: "smart_toy",
    color: "#FF6900",
    textIcon: "MF",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://api.xiaomimimo.com/api/free-ai/openai/chat",
    noAuth: true,
  },
  models: [
    { id: "mimo-auto", name: "MiMo Auto" },
  ],
  modelsFetcher: { url: "https://models.dev/api.json", type: "mimo-free" },
  passthroughModels: true,
};
