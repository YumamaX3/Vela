export default {
  id: "gemini-cli",
  priority: 126,
  // NOTE: no "gcli" alias — that alias belongs to grok-cli (executors/index.js
  // hardcodes "gcli" → GrokCliExecutor; model.js routes grok-build → gcli/*).
  // Declaring it here would silently collide and lose to grok-cli by registry
  // order, routing gemini-cli requests to the wrong provider (E-H1).
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
