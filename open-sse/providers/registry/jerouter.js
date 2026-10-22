// Jerouter — "API AI" dual-endpoint router (je.jerouter.web.id).
// OpenAI-compatible /v1/chat/completions AND Anthropic-compatible /v1/messages
// serve the SAME catalog: 39 general lanes + 11 unrestricted (JB) lanes.
//
// Model list per the Star's catalog export (2026-10-23 — 50 active). Thirteen
// general lanes joined this tide: deepseek-v4.1-flash-1017-oc, qwen3.8-max,
// minimax-m2.7, nemotron-3.5-super-vl, ll-alpha, beam, xing4.0-29b-a4b,
// deepseek-v4.1-flash-1017, deepseek-v4.1-flash-1017-q, minimax-m3.1-flash,
// plus three that RETURN — mimo-v2.5 (retired 2026-10-13), jev-1.13 (retired
// 2026-09-26) and deepseek-v4-flash (retired 2026-09-26). One unrestricted
// lane joined: minimax-m3.1-flash-unrestricted. Eight left: seven general ids
// — dots-3-note-preview, muse-spark-1.3-contributor, ling-3.0-flash-sante,
// space-bunny, ling-3.1-flash, apodex-1.1-mini, step-5-preview-opencode — and
// one unrestricted lane, muse-unrestricted. This export is the authority on
// their retirement.
//
// THE WINDOW CONTRACT (transcribed lane by lane, same export — supersedes the
// 2026-10-13 decree): the export's own window column is the fact, and it is
// NOT "all 512k". Six general lanes state another depth — jev-1.13 16384,
// mimo-v2.6-flash 1048576, step-5-preview 1048576, claude-haiku-5.5 262144,
// auto 262144, beam 1048576 — while every unrestricted (JB) lane states
// 524288 on this export (the earlier 1M decree is superseded by the column).
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
// DROPPED the vision/text column (status emoji and window only), so the
// thirteen arrivals carry no upstream annotation at all: their modality is what
// the live resolver measures through the pattern chain, pinned as-is in
// open-sse/providers/capabilities.js — deepseek-v4.1-flash-1017-oc, mimo-v2.5,
// nemotron-3.5-super-vl, deepseek-v4.1-flash-1017, deepseek-v4.1-flash-1017-q,
// minimax-m3.1-flash and minimax-m3.1-flash-unrestricted resolve vision; the
// rest resolve text. Pinned on both the id and alias lanes by
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
  // ── The 39 general lanes — windows transcribed from the export ───────
  // `contextLength` is the dashboard + model-catalog half of the window fact
  // (the capability table's `contextWindow` is the runtime half; both carry the
  // same number, and declaring it here also opts the lane out of the gateway
  // catalog's limit override — see src/lib/modelCatalog/sync.js).
  // The export's window column is the contract, lane by lane — the summary
  // sentence "all 512k" is not. Six lanes carry a different depth and are
  // transcribed as the column states: jev-1.13 16k, mimo-v2.6-flash and
  // step-5-preview 1M, claude-haiku-5.5 and auto 256k, beam 1M.
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
    { id: "deepseek-v4.1-flash-1017-oc", name: "DeepSeek V4.1 Flash 1017 OC", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "big-pickle", name: "Big Pickle", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "mimo-v2.5", name: "MiMo V2.5", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "nemotron-3.5-lightning", name: "Nemotron 3.5 Lightning", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "grok-4.7", name: "Grok 4.7", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "jev-1.13", name: "Jev 1.13", supportedFormats: ["openai", "claude"], contextLength: 16384 },
    { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "step-5-preview", name: "Step 5 Preview", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "qwen3.8-flash", name: "Qwen 3.8 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "longcat-2.5-preview", name: "LongCat 2.5 Preview", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "qwen3.7-max", name: "Qwen 3.7 Max", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "qwen3.7-plus", name: "Qwen 3.7 Plus", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "qwen3.8-max", name: "Qwen 3.8 Max", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "qwen3.8-omni-flash", name: "Qwen 3.8 Omni Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "claude-haiku-5.5", name: "Claude Haiku 5.5", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "step-3.5-flash-2603", name: "Step 3.5 Flash 2603", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "step-3.5-flash", name: "Step 3.5 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "cat-jam", name: "Cat Jam", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "auto", name: "Auto", supportedFormats: ["openai", "claude"], contextLength: 262144 },
    { id: "minimax-m2.7", name: "MiniMax M2.7", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "nemotron-3.5-super-vl", name: "Nemotron 3.5 Super VL", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "ll-alpha", name: "LL Alpha", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "beam", name: "Beam", supportedFormats: ["openai", "claude"], contextLength: 1048576 },
    { id: "xing4.0-29b-a4b", name: "Xing 4.0 29B A4B", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash 1017", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "deepseek-v4.1-flash-1017-q", name: "DeepSeek V4.1 Flash 1017 Q", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "minimax-m3.1-flash", name: "MiniMax M3.1 Flash", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    // ── The 11 unrestricted (JB) lanes — 512k on this export ────────────
    { id: "mimo-v2.6-flash-unrestricted", name: "MiMo V2.6 Flash Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "deepseek-unrestricted", name: "DeepSeek Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "big-pickle-unrestricted", name: "Big Pickle Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "longcat-unrestricted", name: "LongCat Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "step-5-unrestricted", name: "Step 5 Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "step-3.7-unrestricted", name: "Step 3.7 Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "jerouter", name: "Jerrouter", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "nemotron-3-ultra-unrestricted", name: "Nemotron 3 Ultra Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "glm-5.3-flash-unrestricted", name: "GLM 5.3 Flash Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "sonnet-unrestricted", name: "Sonnet Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
    { id: "minimax-m3.1-flash-unrestricted", name: "MiniMax M3.1 Flash Unrestricted", supportedFormats: ["openai", "claude"], contextLength: 524288 },
  ],
};
