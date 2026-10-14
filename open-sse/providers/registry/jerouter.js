// Jerouter — "API AI" dual-endpoint router (je.jerouter.web.id).
// OpenAI-compatible /v1/chat/completions AND Anthropic-compatible /v1/messages
// serve the SAME catalog: 33 general lanes + 11 unrestricted (JB) lanes.
//
// Model list per the Star's catalog export (2026-10-13 — "Daftar Semua Model
// AI", 44 active). Thirteen general lanes joined this tide: claude-opus-4-6
// and claude-sonnet-4-6 RETURN (they had retired on the 2026-09-26 tide), plus
// ling-3.1-flash, apodex-1.1-mini, qwen3.7-max, qwen3.7-plus,
// step-5-preview-opencode, qwen3.8-omni-flash, claude-haiku-5.5,
// step-3.5-flash-2603, step-3.5-flash, cat-jam and auto. Five unrestricted
// lanes joined: mimo-v2.6-flash-unrestricted, jerrouter (the router's own
// meta-lane), nemotron-3-ultra-unrestricted, glm-5.3-flash-unrestricted and
// sonnet-unrestricted. Eight left: four general ids — mimo-v2.5,
// ling-3.0-flash-fin, qwen3.8-27b, mimo-v2.6-pro — and four unrestricted lanes
// — qwen3.8-27b-unsencored, unrestricted, ling-unrestricted,
// mimo-pro-unrestricted; this export is the authority on their retirement.
//
// THE WINDOW DECREE (Star's word, same export — supersedes 2026-09-29): every
// general lane carries 524288 (512k) and every unrestricted lane 1048576 (1M).
// The fact is written in two places because two consumers read it —
// `contextLength` here feeds the dashboard chip and the model catalog (and opts
// the lane out of the synced catalog's limit override,
// src/lib/modelCatalog/sync.js), while `contextWindow` in
// open-sse/providers/capabilities.js feeds the runtime (capacity adapter,
// fallback-rules' contextWindow trigger, /api/models). Both halves are pinned
// to agree by tests/unit/jerouter-catalog.test.js.
//
// Dual-endpoint shape mirrors opencode-go.js: `transports` array + per-model
// `supportedFormats`, so chatCore picks the transport matching the client
// sourceFormat and skips translation when the source is already compatible.
//
// The catalog's vision/text annotation is NOT declared here — the registry's
// `capabilities:` field is media-only (text2img/edit/mask). This export also
// DROPPED the vision/text column the earlier tides carried (status emoji and
// window only), so the eighteen arrivals carry no upstream annotation at all:
// their modality is what the live resolver measures through the pattern chain,
// pinned as-is in open-sse/providers/capabilities.js — claude-opus-4-6,
// claude-sonnet-4-6, qwen3.7-plus, qwen3.8-omni-flash, claude-haiku-5.5 and
// mimo-v2.6-flash-unrestricted resolve vision; the rest resolve text. Pinned
// on both the id and alias lanes by tests/unit/jerouter-catalog.test.js.
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
  // ── The 33 general lanes — 512k context ──────────────────────────────
  // `contextLength` is the dashboard + model-catalog half of the window fact
  // (the capability table's `contextWindow` is the runtime half; both carry the
  // same number, and declaring it here also opts the lane out of the gateway
  // catalog's limit override — see src/lib/modelCatalog/sync.js).
  models: [
    { id: "step-3.7-flash", name: "Step 3.7 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "nemotron-3-ultra", name: "Nemotron 3 Ultra", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "north-mini-code", name: "North Mini Code", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "laguna-xs-2.1", name: "Laguna XS 2.1", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "nemotron-3-super", name: "Nemotron 3 Super", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "laguna-s-2.1", name: "Laguna S 2.1", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "grok-4.6", name: "Grok 4.6", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "dots-3-note-preview", name: "Dots 3 Note Preview", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "big-pickle", name: "Big Pickle", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "nemotron-3.5-lightning", name: "Nemotron 3.5 Lightning", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "ling-3.0-flash-sante", name: "Ling 3.0 Flash Sante", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "grok-4.7", name: "Grok 4.7", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "step-5-preview", name: "Step 5 Preview", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "space-bunny", name: "Space Bunny", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "longcat-2.5-preview", name: "LongCat 2.5 Preview", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "ling-3.1-flash", name: "Ling 3.1 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "apodex-1.1-mini", name: "Apodex 1.1 Mini", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "qwen3.7-max", name: "Qwen 3.7 Max", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "qwen3.7-plus", name: "Qwen 3.7 Plus", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "step-5-preview-opencode", name: "Step 5 Preview OpenCode", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "qwen3.8-omni-flash", name: "Qwen 3.8 Omni Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "claude-haiku-5.5", name: "Claude Haiku 5.5", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "step-3.5-flash-2603", name: "Step 3.5 Flash 2603", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "step-3.5-flash", name: "Step 3.5 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "cat-jam", name: "Cat Jam", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "auto", name: "Auto", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    // ── The 11 unrestricted (JB) lanes — 1M context ─────────────────────
    { id: "mimo-v2.6-flash-unrestricted", name: "MiMo V2.6 Flash Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "muse-unrestricted", name: "Muse Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "deepseek-unrestricted", name: "DeepSeek Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "big-pickle-unrestricted", name: "Big Pickle Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "longcat-unrestricted", name: "LongCat Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "step-5-unrestricted", name: "Step 5 Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "step-3.7-unrestricted", name: "Step 3.7 Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "jerouter", name: "Jerrouter", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "nemotron-3-ultra-unrestricted", name: "Nemotron 3 Ultra Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "glm-5.3-flash-unrestricted", name: "GLM 5.3 Flash Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "sonnet-unrestricted", name: "Sonnet Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
  ],
};
