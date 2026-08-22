export default {
  id: "gemini-cli",
  priority: 126,
  alias: "gcli",
  hidden: true,
  display: {
    name: "Gemini CLI Alternative",
    icon: "terminal",
    color: "#FBBC05",
    textIcon: "GC",
    website: "https://github.com/google-gemini/gemini-cli",
    notice: {
      text: "Google Gemini CLI interface (alternative entry point).",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:chat",
    format: "openai",
  },
  models: [
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash-Lite" },
  ],
};
