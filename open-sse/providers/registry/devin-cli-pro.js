export default {
  id: "devin-cli-pro",
  priority: 129,
  alias: "dvpro",
  hidden: true,
  display: {
    name: "Devin CLI Pro",
    icon: "verified",
    color: "#8B5CF6",
    textIcon: "DVPRO",
    website: "https://devin.ai/pro/",
    notice: {
      text: "Pro version of Devin CLI with advanced agent capabilities.",
    },
  },
  category: "free",
  authType: "none",
  noAuth: true,
  transport: {
    baseUrl: "devin-cli-pro://acp/v3",
    format: "openai",
  },
  models: [
    { id: "swe-2.0-fast", name: "SWE-2.0 Fast" },
    { id: "swe-2.0-beta", name: "SWE-2.0 Beta" },
  ],
};
