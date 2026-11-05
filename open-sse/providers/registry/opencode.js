// ── The v2 free-tier lane ──────────────────────────────────────────────────
// The curated free-tier ids that travel OpenCode's v2 gate instead of the
// retired /zen/v1 endpoint. CATALOG-DRIVEN, NEVER suffix-matched: upstream
// keeps a curated map and deliberately excludes `big-pickle` — it has no live
// 403 evidence and is carried as paid chat, so moving it could break working
// calls (luqman-v1/9router-go v1.9.12, internal/providers/model_formats.go
// openCodeFreeTierModels). Provenance per id is written beside each entry.
// ONE definition, two consumers: the executor imports this to pick the lane,
// and the registry exposes it so the list never forks into two truths.
export const OPENCODE_FREE_TIER_MODELS = new Set([
  "muse-spark-1.2-contributor-free", // registry models[]
  "muse-spark-1.3-contributor-free", // registry models[]
  "jev-1.13-free",                   // live catalog 2026-10-15
  "cat-jam-free",                    // live catalog 2026-10-15
  "mimo-v2.6-flash-free",            // live catalog 2026-10-15
  "nemotron-3.5-lightning-free",     // live catalog 2026-10-15
  "step-5-preview-free",             // live catalog 2026-10-15
  "longcat-2.5-preview-free",        // live catalog 2026-10-15
  "deepseek-v4.1-flash-free",        // live catalog 2026-10-15
  "space-bunny-free",                // live catalog 2026-10-15
  // big-pickle is deliberately ABSENT — see the note above.
]);
// The one family that inherits the lane without being enumerated: the registry
// declares it free and the fetcher keeps versioning it forward (1.2, 1.3, 1.4…),
// so a future Muse Spark free id lands on the v2 gate rather than silently
// falling back to the retired one. A bare `*-free` suffix stays forbidden —
// only this exact, registry-declared family qualifies.
export const MUSE_SPARK_FREE_RE = /^muse-spark-\d+(?:\.\d+)?-contributor-free$/;

// The free-tier gate, defined where its truth lives — the curated set above.
// It answers synchronously because buildHeaders (opencode-zen) reads it inline
// while assembling headers; a promise would be a truthy stub over the wire.
// The catalog service (isFreeTierModel) is the richer gate — live snapshot plus
// verdicts — but it reads DATA_DIR at module scope, and THIS module is loaded
// inside the registry barrel's own init (providerModels → registry/index →
// codex → helpers). So this leaf must never reach the catalog; it mirrors the
// catalog's cold-boot tail exactly (FALLBACK_FREE = this set, plus the family
// regex), so both owners agree on every id the snapshot has not overruled.
// Mirrors opencodeCatalog.baseId: strip a thinking-variant suffix, drop a
// `provider/` prefix, lowercase — both owners name "the model" the same way.
function freeTierBaseId(model) {
  if (!model) return "";
  const trimmed = String(model).trim();
  const withoutVariant = trimmed.replace(/\([^()]*\)\s*$/, "").trim();
  return (withoutVariant.includes("/") ? withoutVariant.split("/").pop() : withoutVariant).toLowerCase();
}

export function isOpencodeFreeTierModel(modelId) {
  const base = freeTierBaseId(modelId);
  if (!base) return false;
  return OPENCODE_FREE_TIER_MODELS.has(base) || MUSE_SPARK_FREE_RE.test(base);
}

export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Zen",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OZ",
    website: "https://opencode.ai/auth",
    notice: {
      text: "Zen free models run keyless out of the box. Add an OpenCode API key to lift rate limits and reach paid Zen models — connections with a key always take precedence over the keyless lane.",
      apiKeyUrl: "https://opencode.ai/auth",
    },
  },
  // freeTier with a keyless fallback lane: auth.js honors real apikey
  // connections first and only injects the virtual "Public" connection when
  // none exist (see getProviderCredentials — hybrid noAuth handling).
  category: "freeTier",
  authType: "apikey",
  authModes: ["apikey"],
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    forceStream: true,
    noAuth: true,
    quirks: {
      forceAutoToolChoiceModels: ["muse-spark-1.3-contributor-free"],
      // The v2 free-tier lane's curated ids, surfaced here so the list is
      // discoverable beside the models it gates — the definition itself stays
      // in OPENCODE_FREE_TIER_MODELS above, and the executor imports that.
      freeTierModels: [...OPENCODE_FREE_TIER_MODELS],
      museSparkFreePattern: MUSE_SPARK_FREE_RE.source,
    },
  },
  models: [
    // Endpoint formats differ per model, so declare non-chat models explicitly.
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", targetFormat: "openai-responses" },
    { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Contributor Free", targetFormat: "openai-responses" },
    { id: "union-alpha", name: "Union Alpha Free", targetFormat: "claude" },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
