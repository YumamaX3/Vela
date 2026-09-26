// Jerouter — "API AI" dual-endpoint router (je.jerouter.web.id).
// OpenAI-compatible /v1/chat/completions AND Anthropic-compatible /v1/messages
// serve the SAME catalog: 25 general lanes + 4 unrestricted (JB) lanes.
//
// Model list per the Star's catalog export (2026-09-26 — "Daftar Model, seluruh
// model aktif"). Fifteen joined this tide: eleven general ids — nemotron-3-ultra,
// hy3, hy4-preview, ling-3.0-flash-fin, ling-3.0-flash-sante, grok-4.7, jev-1.13,
// mimo-v2.6-flash, step-5-preview, space-bunny, qwen3.8-flash — and four
// unrestricted lanes: qwen3.8-27b-unsencored, unrestricted, muse-unrestricted,
// deepseek-unrestricted. Twenty-four left: gemini-3.1-pro / 3.6-flash /
// 3.7-flash, the whole gemini-3.8-flash family (plain + high/medium/low),
// claude-opus-4-6, claude-sonnet-4-6, deepseek-v4-flash, gemma4, glm-5.2,
// grok-4.5, free, ling-3.0-flash, lfm-2.5-2.6b,
// llama-4-maverick-17b-128e-instruct, muse-spark-1.2-contributor,
// nemotron-3-nano-omni, nemotron-3.5, nex-n2.5-pro, nex-n2.5-mini, union-alpha
// and gpt-5.6-luna.
//
// Three of the arrivals — nemotron-3-ultra, qwen3.8-flash, hy3 — had been
// reported retired upstream on the 2026-09-18 tide. They are live in this
// export, so this export, not the earlier note, is the authority.
//
// Dual-endpoint shape mirrors opencode-go.js: `transports` array + per-model
// `supportedFormats`, so chatCore picks the transport matching the client
// sourceFormat and skips translation when the source is already compatible.
//
// The catalog's vision/text annotation is NOT declared here — the registry's
// `capabilities:` field is media-only (text2img/edit/mask). Every model's
// modality is resolved in open-sse/providers/capabilities.js, where twelve of
// these lanes carry an explicit per-provider override because the global pattern
// disagreed with this catalog. Pinned on both the id and alias lanes by
// tests/unit/jerouter-catalog.test.js.
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
  // ── The 25 general lanes ─────────────────────────────────────────────
  models: [
    { id: "step-3.7-flash", name: "Step 3.7 Flash", supportedFormats: ["openai", "claude"] },
    { id: "nemotron-3-ultra", name: "Nemotron 3 Ultra", supportedFormats: ["openai", "claude"] },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash", supportedFormats: ["openai", "claude"] },
    { id: "north-mini-code", name: "North Mini Code", supportedFormats: ["openai", "claude"] },
    { id: "hy3", name: "Hy3", supportedFormats: ["openai", "claude"] },
    { id: "laguna-xs-2.1", name: "Laguna XS 2.1", supportedFormats: ["openai", "claude"] },
    { id: "nemotron-3-super", name: "Nemotron 3 Super", supportedFormats: ["openai", "claude"] },
    { id: "laguna-s-2.1", name: "Laguna S 2.1", supportedFormats: ["openai", "claude"] },
    { id: "grok-4.6", name: "Grok 4.6", supportedFormats: ["openai", "claude"] },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", supportedFormats: ["openai", "claude"] },
    { id: "hy4-preview", name: "Hy4 Preview", supportedFormats: ["openai", "claude"] },
    { id: "dots-3-note-preview", name: "Dots 3 Note Preview", supportedFormats: ["openai", "claude"] },
    { id: "big-pickle", name: "Big Pickle", supportedFormats: ["openai", "claude"] },
    { id: "mimo-v2.5", name: "MiMo V2.5", supportedFormats: ["openai", "claude"] },
    { id: "ling-3.0-flash-fin", name: "Ling 3.0 Flash Fin", supportedFormats: ["openai", "claude"] },
    { id: "nemotron-3.5-lightning", name: "Nemotron 3.5 Lightning", supportedFormats: ["openai", "claude"] },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", supportedFormats: ["openai", "claude"] },
    { id: "ling-3.0-flash-sante", name: "Ling 3.0 Flash Sante", supportedFormats: ["openai", "claude"] },
    { id: "grok-4.7", name: "Grok 4.7", supportedFormats: ["openai", "claude"] },
    { id: "jev-1.13", name: "Jev 1.13", supportedFormats: ["openai", "claude"] },
    { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash", supportedFormats: ["openai", "claude"] },
    { id: "qwen3.8-27b", name: "Qwen 3.8 27B", supportedFormats: ["openai", "claude"] },
    { id: "step-5-preview", name: "Step 5 Preview", supportedFormats: ["openai", "claude"] },
    { id: "space-bunny", name: "Space Bunny", supportedFormats: ["openai", "claude"] },
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash", supportedFormats: ["openai", "claude"] },
    // ── The 4 unrestricted (JB) lanes ──────────────────────────────────
    { id: "qwen3.8-27b-unsencored", name: "Qwen 3.8 27B Unsencored", supportedFormats: ["openai", "claude"] },
    { id: "unrestricted", name: "Unrestricted", supportedFormats: ["openai", "claude"] },
    { id: "muse-unrestricted", name: "Muse Unrestricted", supportedFormats: ["openai", "claude"] },
    { id: "deepseek-unrestricted", name: "DeepSeek Unrestricted", supportedFormats: ["openai", "claude"] },
  ],
};
