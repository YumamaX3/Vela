// Jerouter — "API AI" dual-endpoint router (je.jerouter.web.id).
// OpenAI-compatible /v1/chat/completions AND Anthropic-compatible /v1/messages
// serve the SAME catalog: 24 general lanes + 10 unrestricted (JB) lanes.
//
// Model list per the Star's catalog export (2026-09-29 — "Daftar Semua Model
// AI", 34 active). Eight joined this tide: two general ids — mimo-v2.6-pro,
// longcat-2.5-preview — and six unrestricted lanes: big-pickle-unrestricted,
// ling-unrestricted, mimo-pro-unrestricted, longcat-unrestricted,
// step-5-unrestricted, step-3.7-unrestricted. Three left: hy3, hy4-preview,
// jev-1.13 — all three had arrived on the 2026-09-26 tide and are absent from
// this export, so this export is the authority on their retirement.
//
// THE WINDOW DECREE (Star's word, same export): every general lane carries
// 262144 (256k) and every unrestricted lane 524288 (512k). The fact is written
// in two places because two consumers read it — `contextLength` here feeds the
// dashboard chip and the model catalog (and opts the lane out of the synced
// catalog's limit override, src/lib/modelCatalog/sync.js), while
// `contextWindow` in open-sse/providers/capabilities.js feeds the runtime
// (capacity adapter, fallback-rules' contextWindow trigger, /api/models).
// Both halves are pinned to agree by tests/unit/jerouter-catalog.test.js.
//
// Dual-endpoint shape mirrors opencode-go.js: `transports` array + per-model
// `supportedFormats`, so chatCore picks the transport matching the client
// sourceFormat and skips translation when the source is already compatible.
//
// The catalog's vision/text annotation is NOT declared here — the registry's
// `capabilities:` field is media-only (text2img/edit/mask). Every model's
// modality is resolved in open-sse/providers/capabilities.js, where every lane
// now carries an explicit per-provider row: three of the arrivals
// (big-pickle-unrestricted, step-5-unrestricted, step-3.7-unrestricted) are
// annotated vision upstream while the global pattern called them text, so the
// catalog wins and vision is turned ON. Pinned on both the id and alias lanes
// by tests/unit/jerouter-catalog.test.js.
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
  // ── The 24 general lanes — 256k context ──────────────────────────────
  // `contextLength` is the dashboard + model-catalog half of the window fact
  // (the capability table's `contextWindow` is the runtime half; both carry the
  // same number, and declaring it here also opts the lane out of the gateway
  // catalog's limit override — see src/lib/modelCatalog/sync.js).
  models: [
    { id: "step-3.7-flash", name: "Step 3.7 Flash", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "nemotron-3-ultra", name: "Nemotron 3 Ultra", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "north-mini-code", name: "North Mini Code", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "laguna-xs-2.1", name: "Laguna XS 2.1", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "nemotron-3-super", name: "Nemotron 3 Super", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "laguna-s-2.1", name: "Laguna S 2.1", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "grok-4.6", name: "Grok 4.6", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "dots-3-note-preview", name: "Dots 3 Note Preview", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "big-pickle", name: "Big Pickle", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "mimo-v2.5", name: "MiMo V2.5", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "ling-3.0-flash-fin", name: "Ling 3.0 Flash Fin", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "nemotron-3.5-lightning", name: "Nemotron 3.5 Lightning", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "ling-3.0-flash-sante", name: "Ling 3.0 Flash Sante", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "grok-4.7", name: "Grok 4.7", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "qwen3.8-27b", name: "Qwen 3.8 27B", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "step-5-preview", name: "Step 5 Preview", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "space-bunny", name: "Space Bunny", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "longcat-2.5-preview", name: "LongCat 2.5 Preview", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    // ── The 10 unrestricted (JB) lanes — 512k context ───────────────────
    { id: "qwen3.8-27b-unsencored", name: "Qwen 3.8 27B Unsencored", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "unrestricted", name: "Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "muse-unrestricted", name: "Muse Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "deepseek-unrestricted", name: "DeepSeek Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "big-pickle-unrestricted", name: "Big Pickle Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "ling-unrestricted", name: "Ling Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "mimo-pro-unrestricted", name: "MiMo Pro Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "longcat-unrestricted", name: "LongCat Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "step-5-unrestricted", name: "Step 5 Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "step-3.7-unrestricted", name: "Step 3.7 Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
  ],
};
