// Jerouter — "API AI" dual-endpoint router (je.jerouter.web.id).
// OpenAI-compatible /v1/chat/completions AND Anthropic-compatible /v1/messages
// serve the SAME catalog of 20 models. Model list per the Star's catalog export
// (2026-09-05). Dual-endpoint shape mirrors opencode-go.js: `transports` array +
// per-model `supportedFormats`, so chatCore picks the transport matching the
// client sourceFormat and skips translation when the source is already compatible.
export default {
  id: "jerouter",
  alias: "je",
  uiAlias: "je",
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  priority: 90,
  hasFree: true,
  display: {
    name: "Jerouter",
    icon: "route",
    color: "#4A6FA5",
    textIcon: "JE",
    website: "https://je.jerouter.web.id",
    notice: {
      text: "Dual-form router: OpenAI `/v1/chat/completions` or Anthropic `/v1/messages` share one API key and one catalog.",
      apiKeyUrl: "https://je.jerouter.web.id",
    },
  },
  // Multi-endpoint: pick the transport matching the client sourceFormat to skip
  // translation. Guarded per-model by `supportedFormats` (see chatCore).
  transport: {
    baseUrl: "https://je.jerouter.web.id/v1/chat/completions",
    format: "openai",
  },
  transports: [
    {
      format: "openai",
      baseUrl: "https://je.jerouter.web.id/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer" },
    },
    {
      format: "claude",
      baseUrl: "https://je.jerouter.web.id/v1/messages",
      auth: { combined: true, header: "x-api-key", scheme: "raw", anthropicVersion: true },
    },
  ],
  models: [
    { id: "step-3.7-flash", name: "Step 3.7 Flash", supportedFormats: ["openai", "claude"] },
    { id: "mimo-v2.5", name: "MiMo V2.5", supportedFormats: ["openai", "claude"] },
    { id: "nemotron-3-ultra", name: "Nemotron 3 Ultra", supportedFormats: ["openai", "claude"] },
    { id: "minimax-m3", name: "MiniMax M3", supportedFormats: ["openai", "claude"] },
    { id: "big-pickle", name: "Big Pickle", supportedFormats: ["openai", "claude"] },
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash", supportedFormats: ["openai", "claude"] },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash", supportedFormats: ["openai", "claude"] },
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", supportedFormats: ["openai", "claude"] },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", supportedFormats: ["openai", "claude"] },
    { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", supportedFormats: ["openai", "claude"] },
    { id: "nemotron-3.5-lightning", name: "Nemotron 3.5 Lightning", supportedFormats: ["openai", "claude"] },
    { id: "north-mini-code", name: "North Mini Code", supportedFormats: ["openai", "claude"] },
    { id: "ling-3.0-flash", name: "Ling 3.0 Flash", supportedFormats: ["openai", "claude"] },
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", supportedFormats: ["openai", "claude"] },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", supportedFormats: ["openai", "claude"] },
    { id: "hy3", name: "Hy3", supportedFormats: ["openai", "claude"] },
    { id: "laguna-xs-2.1", name: "Laguna XS 2.1", supportedFormats: ["openai", "claude"] },
    { id: "inkling", name: "Inkling", supportedFormats: ["openai", "claude"] },
    { id: "qwen3.8-27b", name: "Qwen 3.8 27B", supportedFormats: ["openai", "claude"] },
  ],
};