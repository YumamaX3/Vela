export default {
  id: "devin-cli",
  priority: 109,
  alias: "dv",
  hidden: true,
  display: {
    name: "Devin CLI (Alternative)",
    icon: "code",
    color: "#6366F1",
    textIcon: "DV",
    website: "https://devin.ai/cli",
    notice: {
      text: "Alternative Devin CLI implementation for automated tasks.",
    },
  },
  category: "free",
  authType: "none",
  noAuth: true,
  transport: {
    baseUrl: "devin-cli://acp/v2",
    format: "openai",
  },
  models: [
    { id: "swe-1.5-fast-dv-alt", name: "SWE-1.5 Fast (Alt)" },
    { id: "swe-1.4", name: "SWE-1.4" },
  ],
};
