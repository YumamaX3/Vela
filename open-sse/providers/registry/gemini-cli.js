export default {
  id: "gemini-cli",
  priority: 126,
  // NO "gcli" alias — that alias belongs to grok-cli (executors/index.js maps
  // gcli→GrokCliExecutor, and tokenRefresh maps gcli→refreshXaiToken). With both
  // claiming it, PROVIDER_MODELS["gcli"] is a last-writer-wins slot that left
  // gemini-cli with an EMPTY model list (the fish-audio uniqueness census caught
  // it). v0.9.24 mended this once; the 927f8449 rename (gc→gcli) reintroduced it.
  // gemini-cli is hidden and id-keyed: models resolve via PROVIDER_MODELS["gemini-cli"].
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
    // RESTORED 2026-10-11: 927f8449's rebuild dropped this block, leaving
    // services/usage/google.js reading U("gemini-cli").quotaUrl === undefined
    // (fetch(undefined) → the quota tracker silently died for gemini-cli).
    usage: {
      quotaUrl: "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
      loadCodeAssistUrl: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    },
  },
  models: [
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash-Lite" },
  ],
  // RESTORED 2026-10-11 with the usage table above — USAGE_SUPPORTED_PROVIDERS
  // derives from this flag; without it the dashboard hides gemini-cli quota
  // entirely (ProviderLimits:448, providers/client:53).
  features: {
    usage: true,
  },
};
