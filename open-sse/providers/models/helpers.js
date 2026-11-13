import { FORMATS } from "../../transformer/translator/formats.js";

// Codex auto-generates a "-review" variant for each llm model (review quota family)
export const CODEX_REVIEW_SUFFIX = "-review";

export function withCodexReviewModels(models) {
  return models.flatMap((model) => {
    if ((model.kind || model.type || "llm") !== "llm" || model.id.endsWith(CODEX_REVIEW_SUFFIX)) {
      return [model];
    }
    return [
      model,
      {
        ...model,
        id: `${model.id}${CODEX_REVIEW_SUFFIX}`,
        name: `${model.name} Review`,
        upstreamModelId: model.upstreamModelId || model.id,
        quotaFamily: "review"
      }
    ];
  });
}

// Muse Spark is served by the Responses API on both OpenCode lanes — a future
// id must land there without a registry edit (upstream v0.5.81).
export function isMuseSparkModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /^muse[-_]?spark(?:$|[-_:.\s])/i.test(base);
}

// OpenCode's free tier: upstream's attested suffix gate (59e9b526), kept HERE
// because this leaf is imported by the executors and must never reach the
// DATA_DIR-reading catalog service. The curated set + family regex live in
// registry/opencode.js (one definition, two owners); this leaf mirrors the
// catalog's cold-boot tail exactly (the same strip-variant/basename shape
// isMuseSparkModel uses), so both owners agree on every id.
export function isOpencodeFreeTierModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /-free$/i.test(base);
}

// "model(level)" is a 9router thinking override; strip before matching.
// Accepts both bare ids ("deepseek-v4-pro(max)") and provider-prefixed ones.
export function isDeepSeekModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /^deepseek-/i.test(base);
}

// Endpoint families for OpenCode models outside the curated registry (modelsFetcher /
// passthrough ids) — regex keeps auto-fetched models on the right endpoint:
// /responses (gpt/grok/muse-spark), /messages (minimax/qwen), /chat/completions (rest).
// Curated registry entries always win; this is the unknown-id fallback only.
const OPENCODE_FAMILIES = [
  { match: /^(grok|gpt|muse[-_]?spark)/i, supportedFormats: [FORMATS.OPENAI_RESPONSES], targetFormat: FORMATS.OPENAI_RESPONSES },
  { match: /^deepseek-v4-(pro|flash)/, supportedFormats: [FORMATS.OPENAI, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES] },
  { match: /^(minimax|qwen)/, supportedFormats: [FORMATS.OPENAI, FORMATS.CLAUDE] },
  { match: /^claude-/i, supportedFormats: [FORMATS.CLAUDE] },
];

export function opencodeFamilyFormats(modelId) {
  if (!modelId || typeof modelId !== "string") return null;
  const base = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  return OPENCODE_FAMILIES.find((f) => f.match.test(base)) || null;
}
