// Atria Dawn (AtomInnoLab) — research preview, single text model.
// Docs pin the model field to one case-sensitive id. Text-only: the service
// ships a hook that blocks image/PDF input, so no vision is claimed.
export default {
  id: "atria",
  alias: "atria",
  uiAlias: "atria",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 120,
  display: {
    name: "Atria Dawn",
    icon: "flare",
    color: "#C2410C",
    textIcon: "AD",
    website: "https://atria-asi.ai",
    notice: {
      text: "OpenAI-compatible endpoint from Atria Dawn (AtomInnoLab). Currently a research preview offering a single text model, Atria-Dawn-Preview.",
      apiKeyUrl: "https://api.atria-asi.ai/dashboard",
    },
  },
  transport: {
    baseUrl: "https://api.atria-asi.ai/v1/chat/completions",
    validateUrl: "https://api.atria-asi.ai/v1/models",
  },
  models: [
    { id: "Atria-Dawn-Preview", name: "Atria Dawn Preview" },
  ],
  serviceKinds: ["llm"],
};
