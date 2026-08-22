export default {
  id: "mimo-free",
  priority: 127,
  alias: "mimofree",
  hidden: true,
  display: {
    name: "Mimo Free",
    icon: "smart_toy",
    color: "#10B981",
    textIcon: "MF",
    website: "https://mimo.com",
    notice: {
      text: "Free tier access for Mimo AI models.",
    },
  },
  category: "free",
  authType: "none",
  noAuth: true,
  transport: {
    baseUrl: "https://api.mimo.org/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "mimo-free-small", name: "Mimo Free Small" },
  ],
};
