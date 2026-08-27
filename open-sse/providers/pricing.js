// Pricing rates for AI models — all rates in $/1M tokens
//
// Static resolution chain (first match wins) — the Pricing Covenant [2026-08-15]:
//   3.0 UNPRICEABLE manifest              — router pseudo-models etc. resolve null + reason
//   3.a PROVIDER_PRICING[id][model]       — provider/lane-specific override (registry ID key)
//   3.b PROVIDER_PRICING[alias][model]    — same, via registry alias (fixes alias-keyed lanes)
//   3.c MODEL_PRICING[model] exact        — canonical exact match
//   3.d FREE_ALIAS_MAP[model] → sibling   — explicit entries beat inheritance; free models
//        inherit the paid sibling's WORTH, resolved lane-override → exact → vendor-strip →
//        family pattern (never re-entering free inheritance), with a guarded suffix-strip
//        fallback (':free'/'-free'; FREE_DENYLIST blocks infix/router traps like
//        goldeneye-free-auto) [2026-08-16: the Star's decree — every free model
//        carries its non-free sibling's price]
//   3.e MODEL_PRICING[stripVendor(model)] — vendor-prefix stripped (deepseek/deepseek-chat)
//   3.f PATTERN_PRICING                   — glob pattern match, last resort (pre-compiled)
//
// The async layers ABOVE this chain (user overrides scope 'pricing', synced rates
// scope 'pricing_sync') live in src/lib/db/repos/pricingRepo.js — this file stays
// synchronous and dependency-free (safe for client-free static resolution).
import { PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";

/**
 * Canonical model pricing — provider-agnostic.
 * Cover all known models; deduplicated across providers.
 */
export const MODEL_PRICING = {
  // === Anthropic / Claude ===
  "claude-opus-4-6":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-opus-4-5-20251101":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-sonnet-4-6":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  "claude-sonnet-4-5-20250929":   { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  },
  "claude-haiku-4-5-20251001":    { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  },
  "claude-sonnet-4-20250514":     { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  "claude-opus-4-20250514":       { input: 15.00, output: 25.00, cached: 7.50,  reasoning: 112.50, cache_creation: 15.00 },
  "claude-3-5-sonnet-20241022":   { input: 3.00,  output: 15.00, cached: 1.50,  reasoning: 15.00,  cache_creation: 3.00  },
  "claude-haiku-4.5":             { input: 0.50,  output: 2.50,  cached: 0.05,  reasoning: 3.75,   cache_creation: 0.50  },
  "claude-opus-4.1":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.5":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4.6":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-sonnet-4":              { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-4.5":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-sonnet-4.6":            { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 22.50,  cache_creation: 3.00  },
  "claude-opus-4-5-thinking":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-opus-4-6-thinking":     { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 37.50,  cache_creation: 5.00  },
  "claude-fable-5":               { input: 10.00, output: 50.00, cached: 1.00,  reasoning: 50.00,  cache_creation: 12.50 },

  // === OpenAI / GPT === [2026-08-15 models.dev/api.json + platform.openai.com]
  "gpt-3.5-turbo":                { input: 0.50,  output: 1.50,  cached: 0,     reasoning: 1.50,   cache_creation: 0.50  },
  "gpt-4":                        { input: 30.00, output: 60.00, cached: 15.00, reasoning: 60.00,  cache_creation: 30.00 },
  "gpt-4-turbo":                  { input: 10.00, output: 30.00, cached: 5.00,  reasoning: 30.00,  cache_creation: 10.00 },
  "gpt-4o":                       { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 10.00,  cache_creation: 2.50  },
  "gpt-4o-mini":                  { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.60,   cache_creation: 0.15  },
  "gpt-4.1":                      { input: 2.00,  output: 8.00,  cached: 0.50,  reasoning: 8.00,   cache_creation: 2.00  },
  "gpt-4.1-mini":                 { input: 0.40,  output: 1.60,  cached: 0.10,  reasoning: 1.60,   cache_creation: 0.40  },
  "gpt-4.1-nano":                 { input: 0.10,  output: 0.40,  cached: 0.025, reasoning: 0.40,   cache_creation: 0.10  },
  "gpt-5":                        { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5-mini":                   { input: 0.25,  output: 2.00,  cached: 0.025, reasoning: 2.00,   cache_creation: 0.25  },
  "gpt-5-nano":                   { input: 0.05,  output: 0.40,  cached: 0.005, reasoning: 0.40,   cache_creation: 0.05  },
  "gpt-5-pro":                    { input: 15.00, output: 120.00, cached: 7.50, reasoning: 120.00, cache_creation: 15.00 },
  "gpt-5-codex":                  { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1":                      { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1-codex":                { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gpt-5.1-codex-mini":           { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "gpt-5.1-codex-mini-high":      { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  },
  "gpt-5.1-codex-max":            { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  },
  "gpt-5.2":                      { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.2-codex":                { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.2-pro":                  { input: 21.00, output: 168.00, cached: 10.50, reasoning: 168.00, cache_creation: 21.00 },
  "gpt-5.3-codex":                { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.3-codex-spark":         { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  },
  "gpt-5.4":                      { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 2.50  },
  "gpt-5.4-mini":                 { input: 0.75,  output: 4.50,  cached: 0.075, reasoning: 4.50,   cache_creation: 0.75  },
  "gpt-5.4-nano":                 { input: 0.20,  output: 1.25,  cached: 0.02,  reasoning: 1.25,   cache_creation: 0.20  },
  "gpt-5.4-pro":                  { input: 30.00, output: 180.00, cached: 15.00, reasoning: 180.00, cache_creation: 30.00 },
  "gpt-5.5":                      { input: 5.00,  output: 30.00, cached: 0.50,  reasoning: 30.00,  cache_creation: 5.00  },
  "gpt-5.5-pro":                  { input: 30.00, output: 180.00, cached: 15.00, reasoning: 180.00, cache_creation: 30.00 },
  "gpt-5.6":                      { input: 5.00,  output: 30.00, cached: 0.50,  reasoning: 30.00,  cache_creation: 6.25  },
  "gpt-5.6-luna":                 { input: 0.20,  output: 1.20,  cached: 0.02,  reasoning: 1.20,   cache_creation: 0.25  },
  "gpt-5.6-terra":                { input: 2.00,  output: 12.00, cached: 0.20,  reasoning: 12.00,  cache_creation: 2.50  },
  "gpt-5.6-sol":                  { input: 5.00,  output: 30.00, cached: 0.50,  reasoning: 30.00,  cache_creation: 6.25  },
  "o1":                           { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 60.00,  cache_creation: 15.00 },
  "o1-mini":                      { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 12.00,  cache_creation: 3.00  },
  "o1-pro":                       { input: 150.00, output: 600.00, cached: 75.00, reasoning: 600.00, cache_creation: 150.00 },
  "o3":                           { input: 2.00,  output: 8.00,  cached: 0.50,  reasoning: 8.00,   cache_creation: 2.00  },
  "o3-mini":                      { input: 1.10,  output: 4.40,  cached: 0.55,  reasoning: 4.40,   cache_creation: 1.10  },
  "o3-pro":                       { input: 20.00, output: 80.00, cached: 10.00, reasoning: 80.00,  cache_creation: 20.00 },
  "o4-mini":                      { input: 1.10,  output: 4.40,  cached: 0.275, reasoning: 4.40,   cache_creation: 1.10  },
  // OpenAI text embeddings [2026-08-15 models.dev]
  "text-embedding-3-small":       { input: 0.02,  output: 0 },
  "text-embedding-3-large":       { input: 0.13,  output: 0 },
  "text-embedding-ada-002":       { input: 0.10,  output: 0 },

  // === Gemini === [2026-08-15 models.dev/api.json + ai.google.dev/gemini-api/docs/pricing]
  // NOTE: gemini-3.7-flash is officially HALF the 3.6 rate (Google price cut);
  // thinking-level suffixes (-high/-medium/-low) carry the same per-token rate.
  "gemini-3.7-flash":              { input: 0.75,  output: 3.75,  cached: 0.075, reasoning: 3.75,   cache_creation: 0.75  },
  "gemini-3.7-flash-high":         { input: 0.75,  output: 3.75,  cached: 0.075, reasoning: 3.75,   cache_creation: 0.75  },
  "gemini-3.7-flash-medium":       { input: 0.75,  output: 3.75,  cached: 0.075, reasoning: 3.75,   cache_creation: 0.75  },
  "gemini-3.7-flash-low":          { input: 0.75,  output: 3.75,  cached: 0.075, reasoning: 3.75,   cache_creation: 0.75  },
  "gemini-3.6-flash":              { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-high":         { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-medium":       { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.6-flash-low":          { input: 1.50,  output: 7.50,  cached: 0.15,  reasoning: 11.25,  cache_creation: 1.875 },
  "gemini-3.5-flash":              { input: 1.50,  output: 9.00,  cached: 0.15,  reasoning: 9.00,   cache_creation: 1.50  },
  "gemini-3.5-flash-lite":         { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.375 },
  "gemini-3.5-flash-high":         { input: 1.50,  output: 9.00,  cached: 0.15,  reasoning: 9.00,   cache_creation: 1.50  },
  "gemini-3-flash-preview":        { input: 0.50,  output: 3.00,  cached: 0.05,  reasoning: 3.00,   cache_creation: 0.50  },
  "gemini-flash-latest":           { input: 1.50,  output: 9.00,  cached: 0.15,  reasoning: 9.00,   cache_creation: 1.50  },
  "gemini-flash-lite-latest":      { input: 0.25,  output: 1.50,  cached: 0.025, reasoning: 1.50,   cache_creation: 0.25  },
  "gemini-3-pro-preview":         { input: 2.00,  output: 12.00, cached: 0.20,  reasoning: 12.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-preview":       { input: 2.00,  output: 12.00, cached: 0.20,  reasoning: 12.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-low":           { input: 2.00,  output: 12.00, cached: 0.20,  reasoning: 12.00,  cache_creation: 2.00  },
  "gemini-3.1-pro-high":          { input: 4.00,  output: 18.00, cached: 0.40,  reasoning: 18.00,  cache_creation: 4.00  },
  "gemini-pro-agent":             { input: 4.00,  output: 18.00, cached: 0.40,  reasoning: 18.00,  cache_creation: 4.00  },
  "gemini-3-flash-agent":         { input: 0.50,  output: 3.00,  cached: 0.05,  reasoning: 3.00,   cache_creation: 0.50  },
  "gemini-3.5-flash-low":         { input: 1.50,  output: 9.00,  cached: 0.15,  reasoning: 9.00,   cache_creation: 1.50  },
  "gemini-3.5-flash-extra-low":   { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 2.50,   cache_creation: 0.30  },
  "gemini-3-flash":               { input: 0.50,  output: 3.00,  cached: 0.05,  reasoning: 3.00,   cache_creation: 0.50  },
  "gemini-2.5-pro":               { input: 1.25,  output: 10.00, cached: 0.125, reasoning: 10.00,  cache_creation: 1.25  },
  "gemini-2.5-flash":             { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 2.50,   cache_creation: 0.30  },
  "gemini-2.5-flash-lite":        { input: 0.10,  output: 0.40,  cached: 0.01,  reasoning: 0.40,   cache_creation: 0.10  },

  // === Qwen === [2026-08-15 models.dev/api.json — alibaba official]
  "qwen-flash":                   { input: 0.05,  output: 0.40 },
  "qwen-turbo":                   { input: 0.05,  output: 0.20,  reasoning: 0.50 },
  "qwen-plus":                    { input: 0.40,  output: 1.20,  reasoning: 4.00 },
  "qwen-max":                     { input: 1.60,  output: 6.40 },
  "qwen3-max":                    { input: 1.20,  output: 6.00 },
  "qwen3-coder-plus":             { input: 1.00,  output: 5.00,  cached: 0.50,  reasoning: 5.00,   cache_creation: 1.00  },
  "qwen3-coder-flash":            { input: 0.30,  output: 1.50,  cached: 0.15,  reasoning: 1.50,   cache_creation: 0.30  },
  "qwen3-coder-30b-a3b-instruct": { input: 0.45,  output: 2.25 },
  "qwen3-coder-480b-a35b-instruct": { input: 1.50, output: 7.50 },
  "qwen3.5-plus":                 { input: 0.40,  output: 2.40,  reasoning: 2.40 },
  "qwen3.5-flash":                { input: 0.25,  output: 2.00 },
  "qwen3.5-35b-a3b":              { input: 0.25,  output: 2.00 },
  "qwen3.5-122b-a10b":            { input: 0.40,  output: 3.20 },
  "qwen3.5-397b-a17b":            { input: 0.60,  output: 3.60 },
  "qwen3.6-plus":                 { input: 0.50,  output: 3.00,  cached: 0.05,  reasoning: 3.00,   cache_creation: 0.625 },
  "qwen3.6-flash":                { input: 0.1875, output: 1.125, cache_creation: 0.234375 },
  "qwen3.6-max-preview":          { input: 1.30,  output: 7.80,  cached: 0.13,  cache_creation: 1.625 },
  "qwen3.7-max":                  { input: 2.50,  output: 7.50,  cached: 0.50,  cache_creation: 3.125 },
  "qwen3.7-plus":                 { input: 0.50,  output: 3.00,  cached: 0.05,  cache_creation: 0.625 },
  "qwen3.8-max":                  { input: 2.00,  output: 6.00,  cached: 0.25,  cache_creation: 2.50 },
  "qwen3-next-80b-a3b-instruct":  { input: 0.50,  output: 2.00 },
  "qwen3-next-80b-a3b-thinking":  { input: 0.50,  output: 6.00 },

  // === Mistral === [mistral.ai/pricing — aliases (-latest) resolve to their
  // pinned model's retail rate; exact MODEL_PRICING keys win over the
  // 'mistral*' glob, which carries family estimates]
  "mistral-large-latest":         { input: 2.00,  output: 6.00 },
  "mistral-medium-latest":        { input: 0.40,  output: 2.00 },
  "mistral-small-latest":         { input: 0.10,  output: 0.30 },
  "ministral-3b-latest":          { input: 0.04,  output: 0.04 },
  "ministral-8b-latest":          { input: 0.10,  output: 0.10 },
  "open-mistral-nemo":            { input: 0.15,  output: 0.15 },
  "open-mistral-nemo-latest":     { input: 0.15,  output: 0.15 },
  "open-mixtral-8x22b":           { input: 0.65,  output: 0.65 },
  "open-mixtral-8x22b-latest":    { input: 0.65,  output: 0.65 },
  "codestral-latest":             { input: 0.30,  output: 0.90 },
  "codestral-2405":               { input: 0.30,  output: 0.90 },
  "codestral-2508":               { input: 0.30,  output: 0.90 }, // Mistral 2026-08 code model

  // === New providers (VansRouter lineage import, 2026-08-27) ===
  // Inference hosts / aggregators: open-weight models priced at host list rates
  "nvidia/Nemotron-120B-A12B":    { input: 0.50,  output: 1.50 }, // NVIDIA NIM inference
  "XiaomiMiMo/MiMo-V2.5-Pro":     { input: 0.435, output: 0.87,  cached: 0.0036, reasoning: 0.87, cache_creation: 0.435 },
  "GigaChat-2-Max":               { input: 0.50,  output: 1.00 }, // SberCloud
  "GigaChat-2-Pro":               { input: 0.25,  output: 0.50 }, // SberCloud
  "GigaChat-2-Lite":              { input: 0.10,  output: 0.20 }, // SberCloud
  "nova-pro":                     { input: 0.80,  output: 3.20 }, // Amazon Nova Pro
  "chatgpt-4o-latest":            { input: 2.50,  output: 10.00 }, // OpenAI snapshot (4o tier)
  "Meta-Llama-3_3-70B-Instruct":  { input: 0.59,  output: 0.79 }, // OVHcloud AI Endpoints (Llama 3.3 70B)
  "allenai/Olmo-3-32B-Think":     { input: 0.10,  output: 0.40 }, // AI2 open reasoning
  "solar-pro3":                   { input: 0.50,  output: 1.50 }, // Upstage Solar Pro 3
  "solar-mini":                   { input: 0.10,  output: 0.30 }, // Upstage Solar Mini
  "doubao-seed-2-0-pro-260215":   { input: 0.45,  output: 2.25,  cached: 0.09, reasoning: 2.25, cache_creation: 0.45 }, // Volcengine dated snapshot
  "devstral-small-latest":        { input: 0.10,  output: 0.30 },
  "magistral-medium-latest":      { input: 2.00,  output: 5.00 },
  "magistral-small-latest":       { input: 0.50,  output: 1.50 },

  // === Kimi (Moonshot) === [2026-08-15 models.dev/api.json — moonshotai official]
  "kimi-k3":                      { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  },
  "k3":                           { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  },
  "kimi-k2.7-code":               { input: 0.95,  output: 4.00,  cached: 0.19,  reasoning: 4.00,   cache_creation: 0.95  },
  "kimi-k2.7-code-highspeed":     { input: 1.90,  output: 8.00,  cached: 0.38,  reasoning: 8.00,   cache_creation: 1.90  },
  "kimi-for-coding":              { input: 0.95,  output: 4.00,  cached: 0.19,  reasoning: 4.00,   cache_creation: 0.95  },
  "kimi-for-coding-highspeed":    { input: 1.90,  output: 8.00,  cached: 0.38,  reasoning: 8.00,   cache_creation: 1.90  },
  "kimi-k2":                      { input: 0.60,  output: 2.50,  cached: 0.15,  reasoning: 2.50,   cache_creation: 0.60  },
  "kimi-k2-thinking":             { input: 0.60,  output: 2.50,  cached: 0.15,  reasoning: 2.50,   cache_creation: 0.60  },
  "kimi-k2-thinking-turbo":       { input: 1.15,  output: 8.00,  cached: 0.15,  reasoning: 8.00,   cache_creation: 1.15  },
  "kimi-k2-turbo-preview":        { input: 2.40,  output: 10.00, cached: 0.60,  reasoning: 10.00,  cache_creation: 2.40  },
  "kimi-k2.5":                    { input: 0.60,  output: 3.00,  cached: 0.10,  reasoning: 3.00,   cache_creation: 0.60  },
  "kimi-k2.5-thinking":           { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  },
  "kimi-k2.6":                    { input: 0.95,  output: 4.00,  cached: 0.16,  reasoning: 4.00,   cache_creation: 0.95  },
  "kimi-latest":                  { input: 0.60,  output: 3.00,  cached: 0.10,  reasoning: 3.00,   cache_creation: 0.60  },

  // === DeepSeek === [2026-08-15 api-docs.deepseek.com/quick_start/pricing — official]
  "deepseek-chat":                { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-reasoner":            { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-r1":                  { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v3.2":                { input: 0.28,  output: 0.42,  cached: 0.028,  reasoning: 0.42,   cache_creation: 0.28  },
  "deepseek-v3.2-chat":           { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v3.2-reasoner":       { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v4-flash":            { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  },
  "deepseek-v4-pro":              { input: 0.435, output: 0.87,  cached: 0.003625, reasoning: 0.87,  cache_creation: 0.435 },

  // === GLM (Z.ai) === [2026-08-15 models.dev/api.json — zai official; cache writes free]
  "glm-4.5":                      { input: 0.60,  output: 2.20,  cached: 0.11,  reasoning: 2.20,   cache_creation: 0     },
  "glm-4.5-air":                  { input: 0.20,  output: 1.10,  cached: 0.03,  reasoning: 1.10,   cache_creation: 0     },
  "glm-4.5-flash":                { input: 0,     output: 0,     cached: 0,     reasoning: 0,      cache_creation: 0     },
  "glm-4.5v":                     { input: 0.60,  output: 1.80 },
  "glm-4.6":                      { input: 0.60,  output: 2.20,  cached: 0.11,  reasoning: 2.20,   cache_creation: 0     },
  "glm-4.6v":                     { input: 0.30,  output: 0.90 },
  "glm-4.7":                      { input: 0.60,  output: 2.20,  cached: 0.11,  reasoning: 2.20,   cache_creation: 0     },
  "glm-4.7-flash":                { input: 0,     output: 0,     cached: 0,     reasoning: 0,      cache_creation: 0     },
  "glm-4.7-flashx":               { input: 0.07,  output: 0.40,  cached: 0.01,  reasoning: 0.40,   cache_creation: 0     },
  "glm-5":                        { input: 1.00,  output: 3.20,  cached: 0.20,  reasoning: 3.20,   cache_creation: 0     },
  "glm-5-turbo":                  { input: 1.20,  output: 4.00,  cached: 0.24,  reasoning: 4.00,   cache_creation: 0     },
  "glm-5.1":                      { input: 1.40,  output: 4.40,  cached: 0.26,  reasoning: 4.40,   cache_creation: 0     },
  "glm-5.2":                      { input: 1.40,  output: 4.40,  cached: 0.26,  reasoning: 4.40,   cache_creation: 0     },
  "glm-5v-turbo":                 { input: 1.20,  output: 4.00,  cached: 0.24,  reasoning: 4.00,   cache_creation: 0     },
  "zai-glm-4.7":                  { input: 2.25,  output: 2.75,  cached: 2.25,  reasoning: 2.75,   cache_creation: 0     }, // cerebras lane

  // === MiniMax === [2026-08-15 models.dev/api.json — minimax official]
  "MiniMax-M3":                   { input: 0.30,  output: 1.20,  cached: 0.06,  reasoning: 1.20,   cache_creation: 0.30  },
  "MiniMax-M2":                   { input: 0.30,  output: 1.20 },
  "MiniMax-M2.1":                 { input: 0.30,  output: 1.20,  cached: 0.03,  reasoning: 1.20,   cache_creation: 0.375 },
  "MiniMax-M2.5":                 { input: 0.30,  output: 1.20,  cached: 0.03,  reasoning: 1.20,   cache_creation: 0.375 },
  "MiniMax-M2.5-highspeed":       { input: 0.60,  output: 2.40,  cached: 0.06,  reasoning: 2.40,   cache_creation: 0.375 },
  "MiniMax-M2.7":                 { input: 0.30,  output: 1.20,  cached: 0.06,  reasoning: 1.20,   cache_creation: 0.375 },
  "MiniMax-M2.7-highspeed":       { input: 0.60,  output: 2.40,  cached: 0.06,  reasoning: 2.40,   cache_creation: 0.375 },
  "minimax-m2.1":                 { input: 0.30,  output: 1.20,  cached: 0.03,  reasoning: 1.20,   cache_creation: 0.375 },
  "minimax-m2.5":                 { input: 0.30,  output: 1.20,  cached: 0.03,  reasoning: 1.20,   cache_creation: 0.375 },
  "minimax-m2.7":                 { input: 0.30,  output: 1.20,  cached: 0.06,  reasoning: 1.20,   cache_creation: 0.375 },

  // === Grok (xAI) === [2026-08-15 models.dev/api.json — xai official]
  "grok-code-fast-1":             { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "grok-4.3":                     { input: 1.25,  output: 2.50,  cached: 0.20,  reasoning: 2.50,   cache_creation: 1.25  },
  "grok-4.5":                     { input: 2.00,  output: 6.00,  cached: 0.30,  reasoning: 6.00,   cache_creation: 2.00  },
  "grok-4.6":                     { input: 2.00,  output: 6.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 2.00  },
  "grok-4.20-0309-reasoning":     { input: 1.25,  output: 2.50,  cached: 0.20,  reasoning: 2.50,   cache_creation: 1.25  },
  "grok-4.20-0309-non-reasoning": { input: 1.25,  output: 2.50,  cached: 0.20,  reasoning: 2.50,   cache_creation: 1.25  },
  "grok-4.20-multi-agent-0309":   { input: 1.25,  output: 2.50,  cached: 0.20,  reasoning: 2.50,   cache_creation: 1.25  },
  "grok-build-0.1":               { input: 1.00,  output: 2.00,  cached: 0.20,  reasoning: 2.00,   cache_creation: 1.00  },

  // === Anthropic (additions) === [2026-08-15 claude.com/pricing — official]
  "claude-opus-5":                { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-opus-4-7":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-opus-4-8":              { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  },
  "claude-sonnet-5":              { input: 2.00,  output: 10.00, cached: 0.20,  reasoning: 10.00,  cache_creation: 2.50  },

  // === Perplexity === [2026-08-15 models.dev/api.json]
  "sonar":                        { input: 1.00,  output: 1.00 },
  "sonar-pro":                    { input: 3.00,  output: 15.00 },
  "sonar-reasoning-pro":          { input: 2.00,  output: 8.00 },
  "sonar-deep-research":          { input: 2.00,  output: 8.00,  reasoning: 3.00 },

  // === Cohere === [2026-08-15 models.dev/api.json]
  "command-a-03-2025":            { input: 2.50,  output: 10.00 },
  "command-a-reasoning-08-2025":  { input: 2.50,  output: 10.00 },
  "command-a-vision-07-2025":     { input: 2.50,  output: 10.00 },
  "command-a-plus-05-2026":       { input: 2.50,  output: 10.00 },
  "command-a-translate-08-2025":  { input: 2.50,  output: 10.00 },
  "command-r-plus-08-2024":       { input: 2.50,  output: 10.00 },
  "command-r-08-2024":            { input: 0.15,  output: 0.60 },
  "command-r7b-12-2024":          { input: 0.0375, output: 0.15 },
  "command-r7b-arabic-02-2025":   { input: 0.0375, output: 0.15 },

  // === Groq === [2026-08-15 models.dev/api.json]
  "llama-3.3-70b-versatile":      { input: 0.59,  output: 0.79 },
  "llama-3.1-8b-instant":         { input: 0.05,  output: 0.08 },
  "gpt-oss-120b":                 { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.60,   cache_creation: 0.15  },
  "gpt-oss-20b":                  { input: 0.075, output: 0.30,  cached: 0.0375, reasoning: 0.30,  cache_creation: 0.075 },
  // Ollama uses ":" separators (gpt-oss:120b) — alias to the base model's rate
  "gpt-oss:120b":                 { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.60,   cache_creation: 0.15  },
  "gpt-oss:20b":                  { input: 0.075, output: 0.30,  cached: 0.0375, reasoning: 0.30,  cache_creation: 0.075 },

  // === Cerebras === [2026-08-15 models.dev/api.json]
  "gemma-4-31b-it":               { input: 0.99,  output: 1.49 },
  "gemma-4-31b":                  { input: 0.99,  output: 1.49 },

  // === Morph === [2026-08-15 models.dev/api.json]
  "morph-v3-large":               { input: 0.90,  output: 1.90 },
  "morph-v3-fast":                { input: 0.80,  output: 1.20 },

  // === StepFun === [2026-08-15 platform.stepfun.ai — official; reseller-confirmed]
  "step-3.5-flash":               { input: 0.10,  output: 0.30,  cached: 0.02,  reasoning: 0.30,   cache_creation: 0.10  },
  "step-3.7-flash":               { input: 0.20,  output: 1.15,  cached: 0.04,  reasoning: 1.15,   cache_creation: 0.20  },

  // === Xiaomi MiMo === [2026-08-15 mimo.mi.com — official]
  // V2.5-Pro retail is 0.435/0.87 [2026-08-27 catalog]; V2-Pro retail 1/3.
  "mimo-v2.5":                    { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
  "mimo-v2-omni":                 { input: 0.40,  output: 2.00,  cached: 0.08,   reasoning: 2.00,   cache_creation: 0.40  },
  "mimo-v2-pro":                  { input: 1.00,  output: 3.00,  cached: 0.20,   reasoning: 3.00,   cache_creation: 1.00  },
  "mimo-v2.5-pro":                { input: 0.435, output: 0.87,  cached: 0.0036, reasoning: 0.87,  cache_creation: 0.435 },
  "mimo-v2.5-pro-ultraspeed":     { input: 1.305, output: 2.61,  cached: 0.0108, reasoning: 2.61,  cache_creation: 1.305 },
  "mimo-v2-flash":                { input: 0.10,  output: 0.30 }, // ⚠ reseller-only (official page V2.5 series only)

  // === Volcengine Ark (seed-2.0) === [2026-08-15 volcengine.com — official CNY→USD@7.1]
  // Dated snapshots (260215/260228/260328) carry the volcengine/byteplus
  // catalog rates [2026-08-27 — the whole-harbor pricing sweep].
  "doubao-seed-2-0-code-preview-260215": { input: 0.475, output: 2.375, cached: 0.095, reasoning: 2.375, cache_creation: 0.475 },
  "gpt-oss-120b-250805":          { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.60,   cache_creation: 0.15  }, // byteplus dated snapshot
  "doubao-seed-2.0-lite":         { input: 0.085, output: 0.51,  cached: 0.017, reasoning: 0.51,   cache_creation: 0.085 },
  "doubao-seed-2.0-mini":         { input: 0.028, output: 0.28,  cached: 0.006, reasoning: 0.28,   cache_creation: 0.028 },
  "doubao-seed-2.0-code":         { input: 0.45,  output: 2.25,  cached: 0.09,  reasoning: 2.25,   cache_creation: 0.45  },

  // === Baidu Qianfan (ERNIE) === [2026-08-15 cloud.baidu.com — official CNY→USD@7.1]
  "ernie-4.5-turbo":              { input: 0.113, output: 0.451, cached: 0.028, reasoning: 0.451,  cache_creation: 0.113 },
  "ernie-x1.1-preview":           { input: 0.141, output: 0.563, reasoning: 0.563 },
  "ernie-5.1":                    { input: 0.56,  output: 2.54,  reasoning: 2.54 },

  // === Tencent Hunyuan === [2026-08-15 cloud.tencent.com — official]
  "hunyuan-a13b-instruct":        { input: 0.07,  output: 0.282, reasoning: 0.282 },
  "hy3":                          { input: 0.132, output: 0.528, cached: 0.033, reasoning: 0.528 }, // ⚠ reseller (official login-walled)
  "hy3-preview":                  { input: 0.132, output: 0.528, cached: 0.033, reasoning: 0.528 }, // ⚠ reseller

  // === SambaNova === [2026-08-15 cloud.sambanova.ai/pricing — official]
  "Meta-Llama-3.3-70B-Instruct":  { input: 0.60,  output: 1.20 },

  // === Open-weight host lanes — catalog retail rates [2026-08-27 whole-harbor sweep] ===
  // Providers serving the SAME open-weight model at their own retail rate.
  "google/gemma-4-31b-it":        { input: 0.13,  output: 0.38 }, // deepinfra (gemma-4-31B-it self)
  "google/gemma-4-26b-a4b-it":    { input: 0.07,  output: 0.34 }, // deepinfra (gemma-4-26B-A4B-it self)
  "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B": { input: 0.09, output: 0.45 }, // deepinfra/requesty
  "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning": { input: 0.105, output: 0.42 }, // nano-gpt
  "NousResearch/Hermes-3-Llama-3.1-405B": { input: 1.00, output: 1.00 }, // openrouter
  "XiaomiMiMo/MiMo-V2.5":         { input: 0.40,  output: 2.00 }, // deepinfra
  "deepseek-ai/DeepSeek-V4-Pro":  { input: 0.435, output: 0.87 }, // nvidia lane
  "deepseek-ai/DeepSeek-V4-Flash":{ input: 0.14,  output: 0.28 }, // nvidia lane
  "zai-org/GLM-5.2":              { input: 1.40,  output: 4.40 }, // hpc-ai
  "zai-org/GLM-5.1":              { input: 0.615, output: 2.46 }, // hpc-ai
  "moonshotai/Kimi-K2.7-Code":    { input: 0.95,  output: 4.00 }, // hpc-ai
  "moonshotai/Kimi-K2.6":         { input: 0.69,  output: 3.22 }, // neuralwatt
  "moonshotai/Kimi-K2.5":         { input: 0.60,  output: 3.00 }, // hpc-ai
  "mistralai/Mistral-7B-Instruct-v0.3": { input: 0.20, output: 0.20 }, // pioneer
  "Qwen/QwQ-32B":                 { input: 0.40,  output: 0.40 }, // abacus
  "deepseek-ai/DeepSeek-R1":      { input: 0.70,  output: 2.50 }, // huggingface
  "deepseek-ai/DeepSeek-V3":      { input: 0.32,  output: 0.89 }, // deepinfra
  "meta-llama/Llama-3.3-70B-Instruct": { input: 0.10, output: 0.30 }, // meganova
  "meta-llama/Llama-3.2-3B-Instruct":  { input: 0.0306, output: 0.0493 }, // nano-gpt
  "Qwen/Qwen2.5-72B-Instruct":    { input: 0.59,  output: 0.59 }, // siliconflow
  "Qwen/Qwen2.5-Coder-32B-Instruct": { input: 0.20, output: 0.20 }, // nano-gpt
  "NousResearch/Hermes-3-Llama-3.1-70B": { input: 0.408, output: 0.408 }, // nano-gpt
  "poolside/laguna-s-2.1":        { input: 0.10,  output: 0.20 }, // nano-gpt
  "poolside/laguna-xs-2.1":       { input: 0.06,  output: 0.12 }, // openrouter
  "swiss-ai/apertus-70b-instruct":{ input: 0.82,  output: 2.92 }, // llmtr
  "aisingapore/Gemma-SEA-LION-v4-27B-IT": { input: 0.351, output: 0.555 }, // cloudflare-workers-ai
  "inclusionAI/Ling-flash-2.0":   { input: 0.14,  output: 0.57 }, // siliconflow self
  "venice-uncensored-1-2":        { input: 0.20,  output: 0.90 }, // venice self
  "zai-org-glm-5":                { input: 1.00,  output: 3.20 }, // venice self
  "hermes-3-llama-3.1-405b":      { input: 1.10,  output: 3.00 }, // venice self
  "mistral-small-3-2-24b-instruct": { input: 0.09375, output: 0.25 }, // venice self
  "llama-3.3-70b":                { input: 0.70,  output: 2.80 }, // venice self (cerebras/predibase lane)
  "llama-4-scout-17b-16e-instruct": { input: 0.20, output: 0.78 }, // azure-cognitive-services

  // === Fireworks === [2026-08-15 docs.fireworks.ai/serverless/pricing — official, size-tier]
  "llama-v3p3-70b-instruct":      { input: 0.90,  output: 0.90 },

  // === Together === [2026-08-15 together.ai/pricing — official]
  "Llama-3.3-70B-Instruct":       { input: 1.04,  output: 1.04 },

  // === NVIDIA Nemotron === [2026-08-15 models.dev/api.json]
  "nemotron-3-super-120b-a12b":   { input: 0.20,  output: 0.80 },
  "nemotron-3-ultra-550b-a55b":   { input: 0.50,  output: 2.50,  cached: 0.15,  reasoning: 2.50 },
  "nemotron-3-nano-30b-a3b":      { input: 0.05,  output: 0.20,  cached: 0.025, reasoning: 0.20 },

  // === TTS / STT / image / embedding / ASR — official retail rates ===
  // [2026-08-27 whole-harbor sweep] models.dev does not price these classes;
  // rates are the vendors' own published per-1M-unit prices. Images are
  // per-image USD (output column carries the image price), speech per-1M-char.
  // OpenAI TTS/STT/image [platform.openai.com/docs/pricing — official]
  "tts-1":                        { input: 15.00,  output: 0 },
  "tts-1-hd":                     { input: 30.00,  output: 0 },
  "whisper-1":                    { input: 0.006,  output: 0 },
  "dall-e-2":                     { input: 0,       output: 0.02 },
  "dall-e-3":                     { input: 0,       output: 0.04 },
  "gpt-image-1":                  { input: 0,       output: 0.021 }, // per image
  "gpt-image-2":                  { input: 0,       output: 0.02 },  // catalog sibling
  // Gemini embeddings [ai.google.dev — official]
  "text-embedding-004":           { input: 0.10,   output: 0 },
  "text-embedding-005":           { input: 0.10,   output: 0 },
  "embedding-001":                { input: 0.10,   output: 0 },
  // Groq STT [groq.com/pricing — official, per second]
  "whisper-large-v3":             { input: 0.01618, output: 0 },
  "whisper-large-v3-turbo":       { input: 0.0023,  output: 0 },
  "distil-whisper-large-v3-en":   { input: 0.0018,  output: 0 },
  // Deepgram STT [deepgram.com/pricing — official, per audio hour]
  "nova-3":                       { input: 0.017,  output: 0 }, // per hour
  "nova-2":                       { input: 0.0145, output: 0 },
  "nova":                         { input: 0.009,  output: 0 },
  "whisper-large":                { input: 0.0095, output: 0 },
  // Mistral embeddings [mistral.ai/pricing — official]
  "mistral-embed":                { input: 0.10,   output: 0 },
  // MiniMax speech [minimax.io — official, per 1M chars]
  "speech-2.8-hd":                { input: 0.08,   output: 0 },
  "speech-2.8-turbo":             { input: 0.05,   output: 0 },
  "speech-2.6-hd":                { input: 0.08,   output: 0 },
  "speech-2.6-turbo":             { input: 0.05,   output: 0 },
  "speech-02-hd":                 { input: 0.08,   output: 0 },
  "speech-02-turbo":              { input: 0.05,   output: 0 },
  "speech-01-hd":                 { input: 0.08,   output: 0 },
  "speech-01-turbo":              { input: 0.05,   output: 0 },
  // NVIDIA NIM [build.nvidia.com — official]
  "nvidia/nv-embedqa-e5-v5":      { input: 0.10,   output: 0 }, // per 1M tokens
  "nvidia/parakeet-ctc-1.1b-asr": { input: 0.003,  output: 0 }, // per audio second
  "fastpitch":                    { input: 0.0025, output: 0 }, // per char
  "tacotron2":                    { input: 0.0025, output: 0 },
  // Embedding / retrieval (open models at host retail)
  "nomic-ai/nomic-embed-text-v1.5": { input: 0.008, output: 0 }, // fireworks
  "BAAI/bge-large-en-v1.5":       { input: 0.10,   output: 0 }, // together
  "togethercomputer/m2-bert-80M-8k-retrieval": { input: 0.05, output: 0 },
  "text-embedding-bge-m3":        { input: 0.10,   output: 0 }, // venice
  "text-embedding-qwen3-8b":      { input: 0.10,   output: 0 },
  // Perplexity embed [docs.perplexity.ai — official]
  "perplexity/pplx-embed-v1-4b":  { input: 0.14,   output: 0 },
  "perplexity/pplx-embed-v1-0.6b":{ input: 0.14,   output: 0 },
  // AssemblyAI [assemblyai.com — official, per audio hour]
  "best":                         { input: 0.37,   output: 0 },
  "nano":                         { input: 0.15,   output: 0 },
  "universal-2":                  { input: 0.32,   output: 0 },
  "universal-3-pro":              { input: 0.37,   output: 0 },
  // AI21 Jamba [ai21.com — official]
  "jamba-1-5-large":              { input: 0.70,   output: 2.80 },
  "jamba-1-5-mini":               { input: 0.20,   output: 0.80 },
  "jamba-instruct":               { input: 0.50,   output: 0.70 },
  // Snowflake Arctic [snowflake.com — official family estimate]
  "snowflake-arctic":             { input: 0.80,   output: 2.40 },
  "snowflake-arctic-lite":        { input: 0.20,   output: 0.80 },
  // Galadriel [galadriel.ai — official family estimate]
  "galadriel-latest":             { input: 0.50,   output: 1.50 },
  // NanoBanana image [nanobananaapi.ai — official per-image]
  "nanobanana-flash":             { input: 0,       output: 0.02 },
  "nanobanana-pro":               { input: 0,       output: 0.04 },
  // Image / video generations (per output unit)
  "flux-2-pro":                   { input: 0,       output: 0.04 }, // venice
  "venice-sd35":                  { input: 0,       output: 0.02 }, // venice SD 3.5
  "@cf/black-forest-labs/flux-2-klein-9b": { input: 0, output: 0.006 },
  "@cf/black-forest-labs/flux-2-klein-4b": { input: 0, output: 0.006 },
  "@cf/black-forest-labs/flux-2-dev":      { input: 0, output: 0.012 },
  "@cf/black-forest-labs/flux-1-schnell":  { input: 0, output: 0.006 },
  "@cf/bytedance/stable-diffusion-xl-lightning": { input: 0, output: 0.006 },
  "@cf/lykon/dreamshaper-8-lcm":  { input: 0,       output: 0.006 },
  "@cf/runwayml/stable-diffusion-v1-5-img2img":  { input: 0, output: 0.006 },
  "@cf/runwayml/stable-diffusion-v1-5-inpainting": { input: 0, output: 0.006 },
  "@cf/stabilityai/stable-diffusion-xl-base-1.0": { input: 0, output: 0.006 },
  "@cf/leonardo/lucid-origin":    { input: 0,       output: 0.04 },
  "@cf/leonardo/phoenix-1.0":     { input: 0,       output: 0.04 },
  "bytedance-seed/seedream-4.5":  { input: 0,       output: 0.04 },
  "bytedance-seed/seedream-5.0-lite": { input: 0,   output: 0.04 },
  "bytedance-seed/seedream-5.0-pro":  { input: 0,   output: 0.08 },
  "google/imagen-3.0-generate-002": { input: 0,     output: 0.04 },
  "black-forest-labs/FLUX.1-schnell": { input: 0,   output: 0.006 },
  "happyhorse-1.0-t2v":           { input: 0,       output: 0.08 },
  "kling-v2-6":                   { input: 0,       output: 0.10 },
  "kling-v3":                     { input: 0,       output: 0.15 },
  "kling-v3-omni":                { input: 0,       output: 0.20 },

  // === Misc ===
  "oswe-vscode-prime":            { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  },
  "gpt-oss-120b-medium":          { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  },
  "vision-model":                 { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
  "coder-model":                  { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  },
};

/**
 * Provider-specific pricing overrides.
 * Only include entries where price DIFFERS from MODEL_PRICING.
 * Keyed by provider alias (cc, cx, gc, gh, ...) or provider id (openai, anthropic, ...).
 */
export const PROVIDER_PRICING = {
  // FreeAI by JembatanAI (ja) — pinned lane. Rates are the live models.dev
  // catalog values (synced via pricing_sync) for the router-prefixed ids the
  // upstream exposes; the jailbreak lane is its own catalog entry. Pinned here
  // so the lane is deterministic even if the sync scope lags a new snapshot.
  jembatanai: {
    "deepseek/deepseek-v4-pro-0813":            { input: 0.14, output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
    "deepseek/deepseek-v4-flash-0731":          { input: 0.14, output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
    "openai/gpt-5.6-luna":                      { input: 0.20, output: 1.20,  cached: 0.02,   reasoning: 1.20,  cache_creation: 0.25  },
    "anthropic/claude-sonnet-5":                { input: 2.00, output: 10.00, cached: 0.20,   reasoning: 10.00, cache_creation: 2.50  },
    "z-ai/glm-5.2":                             { input: 1.40, output: 4.40,  cached: 0.26,   reasoning: 4.40,  cache_creation: 0.00  },
    "anthropic/claude-opus-4.8":                { input: 5.00, output: 25.00, cached: 0.50,   reasoning: 25.00, cache_creation: 6.25  },
    "qwen/qwen3.8-max":                         { input: 2.00, output: 6.00,  cached: 0.25,   reasoning: 6.00,  cache_creation: 2.50  },
    "moonshotai/kimi-k3":                       { input: 3.00, output: 15.00, cached: 0.30,   reasoning: 15.00, cache_creation: 3.00  },
    "z-ai/glm-5.3":                             { input: 1.00, output: 4.00,  cached: 0.50,   reasoning: 6.00,  cache_creation: 1.00  },
    "deepseek/deepseek-v4-pro-0813-jailbreak":  { input: 0.14, output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
    "deepseek/deepseek-v4-flash-0731-jailbreak":{ input: 0.14, output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  },
    "openai/gpt-5.6-luna-jailbreak":            { input: 2.50, output: 15.00, cached: 0.25,   reasoning: 15.00, cache_creation: 2.50  },
    "anthropic/claude-sonnet-5-jailbreak":      { input: 3.00, output: 15.00, cached: 0.30,   reasoning: 15.00, cache_creation: 3.75  },
    "z-ai/glm-5.2-jailbreak":                   { input: 1.00, output: 4.00,  cached: 0.50,   reasoning: 6.00,  cache_creation: 1.00  },
    "anthropic/claude-opus-4.8-jailbreak":      { input: 5.00, output: 25.00, cached: 0.50,   reasoning: 25.00, cache_creation: 6.25  },
    "qwen/qwen3.8-max-jailbreak":               { input: 0.50, output: 2.00,  cached: 0.25,   reasoning: 3.00,  cache_creation: 0.50  },
    "moonshotai/kimi-k3-jailbreak":             { input: 3.00, output: 15.00, cached: 0.30,   reasoning: 15.00, cache_creation: 3.00  },
    "z-ai/glm-5.3-jailbreak":                   { input: 1.00, output: 4.00,  cached: 0.50,   reasoning: 6.00,  cache_creation: 1.00  },
  },
  // GitHub Copilot (gh) — explicit override, matches canonical gpt-5.3-codex rate
  gh: {
    "gpt-5.3-codex": { input: 1.75, output: 14.00, cached: 0.175, reasoning: 14.00, cache_creation: 1.75 },
  },
  // Qoder (qd) — subscription lane with opaque model ids. Retail-equivalent
  // estimates [2026-08-16]: each id is a thin alias over a priced base
  // model (per registry/qoder.js names), so every lane row carries the base
  // model's exact retail rate. Honors the header promise at the top of this
  // file ("retail-equivalent estimates for subscription lanes … qoder").
  // Tier selectors (ultimate/auto/performance/efficient/lite) stay unpriced —
  // no honest per-token rate exists for a router's own tier picker.
  qoder: {
    "qmodel_38max":  { input: 2.00,  output: 6.00,  cached: 0.25,   cache_creation: 2.50 },   // → Qwen3.8-Max
    "qmodel_latest": { input: 2.50,  output: 7.50,  cached: 0.50,   cache_creation: 3.125 },  // → Qwen3.7-Max
    "qmodel":        { input: 0.50,  output: 3.00,  cached: 0.05,   cache_creation: 0.625 },  // → Qwen3.7-Plus
    "kmodel_latest": { input: 3.00,  output: 15.00, cached: 0.30,   reasoning: 15.00, cache_creation: 3.00 },  // → Kimi-K3
    "kmodel":        { input: 0.95,  output: 4.00,  cached: 0.19,   reasoning: 4.00,  cache_creation: 0.95 },  // → Kimi-K2.7-Code
    "gmodel":        { input: 1.60,  output: 4.80,  cached: 0.30,   reasoning: 4.80 },         // → GLM-5.3 [2026-08-17 estimate, flat GLM-5.x retail drift]
    "gm51model":     { input: 1.40,  output: 4.40,  cached: 0.26,   reasoning: 4.40 },         // → GLM-5.2
    "dmodel":        { input: 0.435, output: 0.87,  cached: 0.003625, reasoning: 0.87, cache_creation: 0.435 }, // → DeepSeek-V4-Pro
    "dfmodel":       { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14 },   // → DeepSeek-V4-Flash
    "mmodel":        { input: 0.30,  output: 1.20,  cached: 0.06,   reasoning: 1.20,  cache_creation: 0.30 },   // → MiniMax-M3
  },
  // TokenRouter — exact rates from https://api.tokenrouter.com/api/pricing ($1/1M tokens).
  // Ratio→USD: input = model_ratio×2, output = model_ratio×completion_ratio×2.
  // These override the canonical MODEL_PRICING/PATTERN_PRICING, whose rates often
  // differ from TokenRouter's reseller pricing.
  tokenrouter: {
    "MiniMax-M3": { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    "anthropic/claude-fable-5": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-haiku-4.5": { input: 1.0, output: 5.0, cached: 0.1, cache_creation: 1.25, reasoning: 5.0 },
    "anthropic/claude-opus-4.5": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.6": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.7": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.7-fast": { input: 30, output: 150, cached: 3.0, reasoning: 150 },
    "anthropic/claude-opus-4.8": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-4.8-fast": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-opus-5": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "anthropic/claude-opus-5-fast": { input: 10, output: 50, cached: 1.0, cache_creation: 12.5, reasoning: 50 },
    "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-4.5": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-4.6": { input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0 },
    "anthropic/claude-sonnet-5": { input: 2, output: 10, cached: 0.2, reasoning: 10 },
    "claude-opus-4-8-m-aws": { input: 5.0, output: 25.0, cached: 0.5, cache_creation: 6.25, reasoning: 25.0 },
    "deepseek/deepseek-v3.2": { input: 0.26, output: 0.38, cached: 0.13, reasoning: 0.38 },
    "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "deepseek/deepseek-v4-flash-0731": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87, cached: 0.003625, reasoning: 0.87 },
    "ex/gpt-5.4": { input: 2.5, output: 15.0, cached: 0.25, reasoning: 15.0 },
    "google/gemini-2.5-flash-image": { input: 0.3, output: 2.5, reasoning: 2.5 },
    "google/gemini-3-flash-preview": { input: 0.5, output: 3.0, cached: 0.05, cache_creation: 0.08333, reasoning: 3.0 },
    "google/gemini-3-pro-image-preview": { input: 2, output: 12, reasoning: 12 },
    "google/gemini-3.1-flash-image-preview": { input: 0.5, output: 3.0, reasoning: 3.0 },
    "google/gemini-3.1-flash-lite-image": { input: 0.25, output: 1.5, reasoning: 1.5 },
    "google/gemini-3.1-pro-preview": { input: 2, output: 12, cached: 0.2, cache_creation: 0.375, reasoning: 12 },
    "google/gemini-3.5-flash": { input: 1.5, output: 9.0, cached: 0.15, cache_creation: 0.08333, reasoning: 9.0 },
    "google/gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cached: 0.03, cache_creation: 0.08333, reasoning: 2.5 },
    "google/gemini-3.6-flash": { input: 1.5, output: 7.5, cached: 0.15, cache_creation: 0.08333, reasoning: 7.5 },
    "google/gemini-embedding-2": { input: 1.0, output: 6.0, cached: 0.1, reasoning: 6.0 },
    "google/gemma-4-26b-a4b-it": { input: 0.06, output: 0.33, reasoning: 0.33 },
    "kling-3.0-turbo": { input: 2.1, output: 2.1, reasoning: 2.1 },
    "microsoft/mai-image-2.5": { input: 5.0, output: 47.0, reasoning: 47.0 },
    "minimax/minimax-m2-her": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.1": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.1-highspeed": { input: 0.6, output: 2.4, cached: 0.06, reasoning: 2.4 },
    "minimax/minimax-m2.5": { input: 0.3, output: 1.2, cached: 0.03, reasoning: 1.2 },
    "minimax/minimax-m2.7": { input: 0.3, output: 1.2, cached: 0.06, reasoning: 1.2 },
    "minimax/minimax-m2.7-highspeed": { input: 0.6, output: 2.4, cached: 0.06, reasoning: 2.4 },
    "miromind/mirothinker-1-7-deepresearch": { input: 4, output: 25.0, reasoning: 25.0 },
    "miromind/mirothinker-1-7-deepresearch-mini": { input: 1.25, output: 10.0, reasoning: 10.0 },
    "mistralai/devstral-2512": { input: 0.4, output: 2.0, cached: 0.04, reasoning: 2.0 },
    "mistralai/mistral-medium-3-5": { input: 1.5, output: 7.5, reasoning: 7.5 },
    "mistralai/mistral-small-2603": { input: 0.15, output: 0.6, cached: 0.015, reasoning: 0.6 },
    "mistralai/voxtral-small-24b-2507": { input: 0.1, output: 0.3, cached: 0.01, reasoning: 0.3 },
    "moonshotai/kimi-k2.5": { input: 0.6, output: 3.0, cached: 0.1, reasoning: 3.0 },
    "moonshotai/kimi-k2.6": { input: 0.95, output: 4.0, cached: 0.16, reasoning: 4.0 },
    "moonshotai/kimi-k2.7-code": { input: 0.9286, output: 3.8571, cached: 0.1857, reasoning: 3.8571 },
    "moonshotai/kimi-k3": { input: 3.0, output: 15.0, cached: 0.3, reasoning: 15.0 },
    "nvidia/nemotron-3-super-120b-a12b": { input: 0.3, output: 0.9, cached: 0.1, reasoning: 0.9 },
    "openai/gpt-4o-mini": { input: 0.15, output: 0.6, cached: 0.075, reasoning: 0.6 },
    "openai/gpt-5": { input: 1.25, output: 10.0, cached: 0.125, reasoning: 10.0 },
    "openai/gpt-5-image": { input: 10, output: 40, cached: 2.5, reasoning: 40 },
    "openai/gpt-5-image-mini": { input: 2.5, output: 8.0, cached: 0.25, reasoning: 8.0 },
    "openai/gpt-5-mini": { input: 0.25, output: 2.0, cached: 0.025, reasoning: 2.0 },
    "openai/gpt-5.2": { input: 1.75, output: 14.0, cached: 0.175, reasoning: 14.0 },
    "openai/gpt-5.3-codex": { input: 1.75, output: 14.0, cached: 0.175, reasoning: 14.0 },
    "openai/gpt-5.4": { input: 2.5, output: 15.0, cached: 0.25, reasoning: 15.0 },
    "openai/gpt-5.4-image-2": { input: 8, output: 30.0, cached: 2.0, reasoning: 30.0 },
    "openai/gpt-5.4-mini": { input: 0.75, output: 4.5, cached: 0.075, reasoning: 4.5 },
    "openai/gpt-5.4-nano": { input: 0.2, output: 1.25, cached: 0.02, reasoning: 1.25 },
    "openai/gpt-5.4-pro": { input: 30, output: 180, reasoning: 180 },
    "openai/gpt-5.5": { input: 5.0, output: 30.0, cached: 0.5, reasoning: 30.0 },
    "openai/gpt-5.5-pro": { input: 30, output: 180, reasoning: 180 },
    "openai/gpt-5.6-luna": { input: 0.2, output: 1.2, cached: 0.02, cache_creation: 0.25, reasoning: 1.2 },
    "openai/gpt-5.6-sol": { input: 5.0, output: 30.0, cached: 0.5, cache_creation: 6.25, reasoning: 30.0 },
    "openai/gpt-5.6-terra": { input: 2, output: 12, cached: 0.2, cache_creation: 2.5, reasoning: 12 },
    "openai/gpt-audio": { input: 2.5, output: 10.0, reasoning: 10.0 },
    "openai/gpt-audio-mini": { input: 0.6, output: 2.4, reasoning: 2.4 },
    "openai/gpt-oss-120b": { input: 0.039, output: 0.18, reasoning: 0.18 },
    "qwen/qwen3-coder-next": { input: 0.12, output: 0.75, cached: 0.06, reasoning: 0.75 },
    "qwen/qwen3.5-122b-a10b": { input: 0.26, output: 2.08, reasoning: 2.08 },
    "qwen/qwen3.5-35b-a3b": { input: 0.1625, output: 1.3, reasoning: 1.3 },
    "qwen/qwen3.5-397b-a17b": { input: 0.39, output: 2.34, reasoning: 2.34 },
    "qwen/qwen3.5-9b": { input: 0.1, output: 0.15, reasoning: 0.15 },
    "qwen/qwen3.5-flash": { input: 0.1048, output: 0.4194, reasoning: 0.4194 },
    "qwen/qwen3.5-plus-02-15": { input: 0.26, output: 1.56, reasoning: 1.56 },
    "qwen/qwen3.6-plus": { input: 0.54, output: 3.21, reasoning: 3.21 },
    "qwen/qwen3.7-max": { input: 1.25, output: 3.75, cached: 0.25, reasoning: 3.75 },
    "qwen/qwen3.7-plus": { input: 0.4, output: 1.6, cached: 0.08, reasoning: 1.6 },
    "qwen/qwen3.8-max": { input: 2, output: 6, cached: 0.25, cache_creation: 2.5, reasoning: 6 },
    "qwen3.5-omni-plus": { input: 1.0, output: 5.7143, reasoning: 5.7143 },
    "qwen3.6-flash": { input: 0.171, output: 1.029, cached: 0.017, cache_creation: 0.214, reasoning: 1.029 },
    "sakana/fugu-ultra": { input: 5.0, output: 30.0, cached: 0.5, reasoning: 30.0 },
    "seed-2-0-code-preview-260328": { input: 1.0, output: 6.0, cached: 0.2, cache_creation: 0.008333, reasoning: 6.0 },
    "seed-2-0-lite-260428": { input: 0.5, output: 4.0, cached: 0.1, cache_creation: 0.008333, reasoning: 4.0 },
    "seed-2-0-mini-260428": { input: 0.2, output: 0.8, cached: 0.04, cache_creation: 0.00833, reasoning: 0.8 },
    "seed-2-0-pro-260328": { input: 1.0, output: 6.0, cached: 0.2, cache_creation: 0.008333, reasoning: 6.0 },
    "stepfun/step-3.5-flash": { input: 0.1, output: 0.3, cached: 0.02, reasoning: 0.3 },
    "stepfun/step-3.7-flash": { input: 0.2, output: 1.15, cached: 0.04, reasoning: 1.15 },
    "tencent/hy3-preview": { input: 0.066, output: 0.26, cached: 0.029, reasoning: 0.26 },
    "x-ai/grok-4.1-fast": { input: 0.2, output: 0.5, cached: 0.05, reasoning: 0.5 },
    "x-ai/grok-4.20-beta": { input: 2, output: 6, cached: 0.2, reasoning: 6 },
    "x-ai/grok-4.3": { input: 1.25, output: 2.5, cached: 0.2, reasoning: 2.5 },
    "x-ai/grok-4.5": { input: 2, output: 6, cached: 0.5, reasoning: 6 },
    "x-ai/grok-build-0.1": { input: 1.0, output: 2.0, cached: 0.2, reasoning: 2.0 },
    "xiaomi/mimo-v2-flash": { input: 0.1, output: 0.3, cached: 0.01, reasoning: 0.3 },
    "xiaomi/mimo-v2-omni": { input: 0.4, output: 2.0, cached: 0.08, reasoning: 2.0 },
    "xiaomi/mimo-v2-pro": { input: 1.0, output: 3.0, cached: 0.2, reasoning: 3.0 },
    "xiaomi/mimo-v2.5": { input: 0.4, output: 2.0, cached: 0.08, reasoning: 2.0 },
    "xiaomi/mimo-v2.5-pro": { input: 1.0, output: 3.0, cached: 0.2, reasoning: 3.0 },
    "z-ai/glm-4.5-air": { input: 0.13, output: 0.85, cached: 0.025, reasoning: 0.85 },
    "z-ai/glm-4.6": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-4.6v": { input: 0.3, output: 0.9, reasoning: 0.9 },
    "z-ai/glm-4.7": { input: 0.6, output: 2.2, cached: 0.11, reasoning: 2.2 },
    "z-ai/glm-5": { input: 1.0, output: 3.2, cached: 0.2, reasoning: 3.2 },
    "z-ai/glm-5-turbo": { input: 1.2, output: 4.0, cached: 0.24, reasoning: 4.0 },
    "z-ai/glm-5.1": { input: 1.05, output: 3.5, cached: 0.525, reasoning: 3.5 },
    "z-ai/glm-5.2": { input: 1.4, output: 4.4, cached: 0.26, reasoning: 4.4 },
  },

  // === Lane tables keyed by REGISTRY ID === [2026-08-15]
  // Namespaced router ids (vendor/model, @cf/*, accounts/*) that neither
  // MODEL_PRICING exact keys nor anchored PATTERN_PRICING globs can reach.
  // Usage rows record the registry id, so these keys must be ids — never aliases.

  // NOTE: GitHub Copilot lives in the `gh` block above — resolved via the
  // alias stratum (registry id 'github' → alias 'gh'). No id-keyed twin needed.

  // Cloudflare Workers AI — chat-class @cf ids [models.dev cloudflare null; groq/vendor retail]
  "cloudflare-ai": {
    "@cf/meta/llama-3.2-1b-instruct": { input: 0.05, output: 0.15 },
    "@cf/meta/llama-3.2-3b-instruct": { input: 0.05, output: 0.15 },
    "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { input: 0.05, output: 0.15 },
    "@cf/meta/llama-3.1-8b-instruct-awq": { input: 0.05, output: 0.15 },
    "@cf/meta/llama-3.1-70b-instruct-fp8-fast": { input: 0.59, output: 0.79 },
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 0.59, output: 0.79 },
    "@cf/mistralai/mistral-small-3.1-24b-instruct": { input: 0.15, output: 0.6 },
    "@cf/qwen/qwq-32b": { input: 0.18, output: 0.7 },
  },

  // NesaRouter — reseller lane [official family rates; 2026-08-15]
  nesarouter: {
    "nesarouter/deepseek-v4-flash": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "nesarouter/step-3.7-flash": { input: 0.2, output: 1.15, cached: 0.04, reasoning: 1.15 },
    "nesarouter/step-3.5-flash": { input: 0.1, output: 0.3, cached: 0.02, reasoning: 0.3 },
  },

  // ClinePass — router lane for mimo family [mimo.mi.com official rates]
  clinepass: {
    "cline-pass/mimo-v2.5": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
    "cline-pass/mimo-v2.5-pro": { input: 0.435, output: 0.87, cached: 0.0036, reasoning: 0.87 },
  },

  // Fireworks — accounts/* namespaced ids [docs.fireworks.ai size-tier]
  fireworks: {
    "accounts/fireworks/models/llama-v3p3-70b-instruct": { input: 0.9, output: 0.9 },
  },

  // StepFun — case-variant namespaced id
  stepfun: {
    "stepfun/Step-3.5-Flash": { input: 0.1, output: 0.3, cached: 0.02, reasoning: 0.3 },
    "stepfun/Step-3.7-Flash": { input: 0.2, output: 1.15, cached: 0.04, reasoning: 1.15 },
  },

  // MiMo router lane
  mimo: {
    "mimo/mimo-v2.5": { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28 },
  },

  // Volcengine/byteplus dated snapshots — registry ids carry date-suffixed
  // ids the canonical table cannot reach [2026-08-27 whole-harbor sweep]
  byteplus: {
    "seed-2-0-pro-260328":            { input: 1.00,  output: 6.00,  cached: 0.20,  reasoning: 6.00,  cache_creation: 0.008 },
    "seed-2-0-code-preview-260328":   { input: 1.00,  output: 6.00,  cached: 0.20,  reasoning: 6.00,  cache_creation: 0.008 },
    "seed-2-0-mini-260215":           { input: 0.028, output: 0.28,  cached: 0.006, reasoning: 0.28,  cache_creation: 0.028 },
    "seed-2-0-lite-260228":           { input: 0.09,  output: 0.51,  cached: 0.017, reasoning: 0.51,  cache_creation: 0.09  },
    "gpt-oss-120b-250805":            { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.60,  cache_creation: 0.15  },
  },
  volcengine: {
    "doubao-seed-2-0-code-preview-260215": { input: 0.782, output: 3.893, cached: 0.20, reasoning: 3.893, cache_creation: 0.008 },
  },
  "volcengine-ark": {
    "Doubao-Seed-2.0-Code":     { input: 0.90,  output: 4.48,  cached: 0.20,  reasoning: 4.48,   cache_creation: 0.90  },
    "Doubao-Seed-2.0-pro":      { input: 0.45,  output: 2.24,  cached: 0.09,   reasoning: 2.24,   cache_creation: 0.45  },
    "Doubao-Seed-2.0-lite":     { input: 0.09,  output: 0.51,  cached: 0.017,  reasoning: 0.51,   cache_creation: 0.09  },
    "Doubao-Seed-Code":         { input: 0.17,  output: 1.12,  cached: 0.04,   reasoning: 1.12,   cache_creation: 0.17  },
  },
  // PublicAI host lane — open-weight models at host retail [2026-08-27]
  publicai: {
    "swiss-ai/Apertus-8B-Instruct-2509":   { input: 0.10, output: 0.30 },
    "allenai/Olmo-3-7B-Instruct":          { input: 0.10, output: 0.40 },
    "utter-project/EuroLLM-22B-Instruct-2512": { input: 0.20, output: 0.60 },
    "swiss-ai/apertus-70b-instruct":       { input: 0.82, output: 2.92 },
    "aisingapore/Gemma-SEA-LION-v4-27B-IT": { input: 0.351, output: 0.555 },
  },
  // CommandCode lane — reseller of stepfun models
  commandcode: {
    "stepfun/Step-3.5-Flash":   { input: 0.10, output: 0.30, cached: 0.02, reasoning: 0.30, cache_creation: 0.10 },
  },
  // Heroku lane — nova-2-lite STT (heroku hosts cortecs nova)
  heroku: {
    "nova-2-lite":              { input: 0.373, output: 3.144 }, // cortecs nova-2-lite
  },
  // Xiaomi TTS lane (per 1M chars)
  "xiaomi-mimo": {
    "mimo-v2.5-tts":            { input: 0.15, output: 0 },
  },
  // DeepInfra host lane — open-weight models at deepinfra's own retail
  deepinfra: {
    "google/gemma-4-31B-it":            { input: 0.13, output: 0.38 },
    "google/gemma-4-26B-A4B-it":        { input: 0.07, output: 0.34 },
    "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B": { input: 0.09, output: 0.45 },
    "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning": { input: 0.20, output: 0.80 },
    "XiaomiMiMo/MiMo-V2.5":             { input: 0.40, output: 2.00 },
  },
  // Featherless host lane — open-weight models at host retail
  featherless: {
    "deepseek-ai/DeepSeek-V4-Pro":      { input: 0.435, output: 0.87 },
    "deepseek-ai/DeepSeek-V4-Flash":    { input: 0.14,  output: 0.28 },
    "zai-org/GLM-5.2":                  { input: 1.40,  output: 4.40 },
    "zai-org/GLM-5.1":                  { input: 0.615, output: 2.46 },
    "moonshotai/Kimi-K2.7-Code":        { input: 0.95,  output: 4.00 },
    "moonshotai/Kimi-K2.6":             { input: 0.69,  output: 3.22 },
    "moonshotai/Kimi-K2.5":             { input: 0.60,  output: 3.00 },
  },
  // Hyperbolic host lane
  hyperbolic: {
    "Qwen/QwQ-32B":                     { input: 0.40,  output: 0.40 },
    "deepseek-ai/DeepSeek-R1":          { input: 0.70,  output: 2.50 },
    "deepseek-ai/DeepSeek-V3":          { input: 0.32,  output: 0.89 },
    "meta-llama/Llama-3.3-70B-Instruct":{ input: 0.10,  output: 0.30 },
    "meta-llama/Llama-3.2-3B-Instruct": { input: 0.0306, output: 0.0493 },
    "Qwen/Qwen2.5-72B-Instruct":        { input: 0.59,  output: 0.59 },
    "Qwen/Qwen2.5-Coder-32B-Instruct":  { input: 0.20,  output: 0.20 },
    "NousResearch/Hermes-3-Llama-3.1-70B": { input: 0.408, output: 0.408 },
  },
  // Venus host lane (venice registry ids are unnamespaced)
  venice: {
    "venice-uncensored-1-2":            { input: 0.20,  output: 0.90 },
    "zai-org-glm-5":                    { input: 1.00,  output: 3.20 },
    "hermes-3-llama-3.1-405b":          { input: 1.10,  output: 3.00 },
    "mistral-small-3-2-24b-instruct":   { input: 0.09375, output: 0.25 },
    "llama-3.3-70b":                    { input: 0.70,  output: 2.80 },
  },
  // Morph lane — opaque ids map to their base model's retail
  morph: {
    "morph-qwen35-397b":        { input: 0.60,  output: 3.60 },  // → Qwen3.5-397B-A17B
    "morph-minimax27-230b":     { input: 0.30,  output: 1.20 },  // → MiniMax-M2.7
    "morph-qwen36-27b":         { input: 0.25,  output: 2.00 },  // → Qwen3.6-27B-A3B
    "morph-dsv4flash":          { input: 0.14,  output: 0.28 },  // → DeepSeek-V4-Flash
  },
  // Kimchi lane
  kimchi: {
    "nemotron-3-ultra-fp4":     { input: 0.50,  output: 2.50 },  // → Nemotron-3-Ultra-550B
  },
  // MMF lane
  mmf: {
    "mimo-auto":                { input: 0.435, output: 0.87 },  // → MiMo-V2.5-Pro auto-tier
  },
  // Xiaomi TokenPlan lane
  "xiaomi-tokenplan": {
    "mimo-v2.5-pro-claude":     { input: 0.435, output: 0.87 },  // → MiMo-V2.5-Pro Claude-compat
    "mimo-v2-tts":              { input: 0.15, output: 0 },      // TTS per 1M chars
    "mimo-v2.5-tts":            { input: 0.15, output: 0 },
    "mimo-v2.5-tts-voiceclone": { input: 0.15, output: 0 },
    "mimo-v2.5-tts-voicedesign": { input: 0.15, output: 0 },
  },
  // ZCode lane — router pseudo-models (no honest per-token rate; family estimate)
  zcode: {
    "zcode-advanced-v1":        { input: 0.50,  output: 1.50 },
    "zcode-fast-v2":            { input: 0.25,  output: 0.75 },
  },
  // AssemblyAI lane — per-audio-hour STT. Router tier selectors (best = the
  // top universal tier; universal-3-pro = flagship) carry the flagship hour
  // rate; nano is the fast tier. [2026-08-27 whole-harbor sweep]
  assemblyai: {
    "best":                    { input: 0.37, output: 0 },
    "universal-2":             { input: 0.32, output: 0 },
    "universal-3-pro":         { input: 0.37, output: 0 },
    "nano":                    { input: 0.15, output: 0 },
  },
};

/**
 * Pattern-based pricing fallback — matched when no exact model entry found.
 * Patterns use simple glob: "*" matches any substring.
 * First match wins — order matters.
 */
export const PATTERN_PRICING = [
  // --- Codex variants ---
  { pattern: "*-codex-xhigh",   pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: "*-codex-high",    pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: "*-codex-max",     pricing: { input: 8.00,  output: 32.00, cached: 4.00,  reasoning: 48.00,  cache_creation: 8.00  } },
  { pattern: "*-codex-mini-*",  pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: "*-codex-mini",    pricing: { input: 1.50,  output: 6.00,  cached: 0.75,  reasoning: 9.00,   cache_creation: 1.50  } },
  { pattern: "*-codex-low",     pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "*-codex-none",    pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "*-codex-spark",   pricing: { input: 3.00,  output: 12.00, cached: 0.30,  reasoning: 12.00,  cache_creation: 3.00  } },
  { pattern: "codex-*",         pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "*-codex",         pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },

  // --- Claude ---
  { pattern: "claude-opus-*",   pricing: { input: 5.00,  output: 25.00, cached: 0.50,  reasoning: 25.00,  cache_creation: 6.25  } },
  { pattern: "claude-sonnet-*", pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },
  { pattern: "claude-haiku-*",  pricing: { input: 1.00,  output: 5.00,  cached: 0.10,  reasoning: 5.00,   cache_creation: 1.25  } },
  { pattern: "claude-*",        pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },

  // --- Gemini (specific first, generic last) ---
  { pattern: "gemini-*-flash-lite", pricing: { input: 0.15, output: 1.25, cached: 0.015, reasoning: 1.875, cache_creation: 0.15 } },
  { pattern: "gemini-*-flash",  pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: "gemini-*-pro",    pricing: { input: 2.00,  output: 12.00, cached: 0.25,  reasoning: 18.00,  cache_creation: 2.00  } },
  { pattern: "gemini-3-*",      pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },
  { pattern: "gemini-2.5-*",    pricing: { input: 0.30,  output: 2.50,  cached: 0.03,  reasoning: 3.75,   cache_creation: 0.30  } },
  { pattern: "gemini-*",        pricing: { input: 0.50,  output: 3.00,  cached: 0.03,  reasoning: 4.50,   cache_creation: 0.50  } },

  // --- GPT (specific first, generic last) ---
  { pattern: "gpt-5.6-*",       pricing: { input: 2.50,  output: 15.00, cached: 0.25,  reasoning: 15.00,  cache_creation: 2.50  } },
  { pattern: "gpt-5.3-*",       pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "gpt-5.2-*",       pricing: { input: 1.75,  output: 14.00, cached: 0.175, reasoning: 14.00,  cache_creation: 1.75  } },
  { pattern: "gpt-5.1-*",       pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-5-*",         pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-5*",          pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "gpt-4o-*",        pricing: { input: 0.15,  output: 0.60,  cached: 0.075, reasoning: 0.90,   cache_creation: 0.15  } },
  { pattern: "gpt-4o",          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  } },
  { pattern: "gpt-4*",          pricing: { input: 2.50,  output: 10.00, cached: 1.25,  reasoning: 15.00,  cache_creation: 2.50  } },

  // --- o1 / o-series ---
  { pattern: "o1-*",            pricing: { input: 3.00,  output: 12.00, cached: 1.50,  reasoning: 18.00,  cache_creation: 3.00  } },
  { pattern: "o1",              pricing: { input: 15.00, output: 60.00, cached: 7.50,  reasoning: 90.00,  cache_creation: 15.00 } },
  { pattern: "o3-*",            pricing: { input: 10.00, output: 40.00, cached: 5.00,  reasoning: 60.00,  cache_creation: 10.00 } },
  { pattern: "o4-*",            pricing: { input: 2.00,  output: 8.00,  cached: 1.00,  reasoning: 12.00,  cache_creation: 2.00  } },

  // --- Qwen ---
  { pattern: "qwen3-coder-*",   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "qwen*-coder-*",   pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "qwen*",           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Kimi ---
  { pattern: "kimi-*-thinking",  pricing: { input: 1.80,  output: 7.20,  cached: 0.90,  reasoning: 10.80,  cache_creation: 1.80  } },
  { pattern: "kimi-k3*",        pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.00  } },
  { pattern: "kimi-k2*",        pricing: { input: 1.20,  output: 4.80,  cached: 0.60,  reasoning: 7.20,   cache_creation: 1.20  } },
  { pattern: "kimi-*",          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },

  // --- DeepSeek ---
  { pattern: "deepseek-*reasoner*", pricing: { input: 0.14, output: 0.28, cached: 0.0028, reasoning: 0.28, cache_creation: 0.14 } },
  { pattern: "deepseek-r*",     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: "deepseek-v*",     pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },
  { pattern: "deepseek-*",      pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,   cache_creation: 0.14  } },

  // --- GLM ---
  { pattern: "glm-5*",          pricing: { input: 1.00,  output: 4.00,  cached: 0.50,  reasoning: 6.00,   cache_creation: 1.00  } },
  { pattern: "glm-4*",          pricing: { input: 0.75,  output: 3.00,  cached: 0.375, reasoning: 4.50,   cache_creation: 0.75  } },
  { pattern: "glm-*",           pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- MiniMax ---
  { pattern: "MiniMax-*",       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: "minimax-*",       pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Grok ---
  { pattern: "grok-code-*",     pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },
  { pattern: "grok-*",          pricing: { input: 0.50,  output: 2.00,  cached: 0.25,  reasoning: 3.00,   cache_creation: 0.50  } },

  // --- Catch-all families for namespaced router ids [2026-08-15] ---
  // Anchored globs could never reach vendor/model or @cf/* ids; these run last
  // against the vendor-stripped tail so passthrough routers price sensibly.
  { pattern: "*/gpt-*",         pricing: { input: 1.25,  output: 10.00, cached: 0.625, reasoning: 10.00,  cache_creation: 1.25  } },
  { pattern: "*/claude-*",      pricing: { input: 3.00,  output: 15.00, cached: 0.30,  reasoning: 15.00,  cache_creation: 3.75  } },
  { pattern: "*/deepseek-*",    pricing: { input: 0.14,  output: 0.28,  cached: 0.0028, reasoning: 0.28,  cache_creation: 0.14  } },
  { pattern: "*/kimi-*",        pricing: { input: 0.60,  output: 3.00,  cached: 0.10,  reasoning: 3.00,   cache_creation: 0.60  } },
  { pattern: "*/llama-*",       pricing: { input: 0.59,  output: 0.79 },
    // llama family retail approximation for namespaced ids
  },
  { pattern: "*/qwen*",         pricing: { input: 0.40,  output: 1.20,  reasoning: 1.20 },
  },
];

/**
 * FREE_ALIAS_MAP — hand-verified free model → paid sibling inheritance [2026-08-15].
 * The PRIMARY mechanism for R3 (free models inherit sibling rates everywhere).
 * Keys are the exact registry model ids; values are sibling ids resolved through
 * the EXACT strata only (3.a/3.b/3.c — never globs). Census-verified against the
 * live registry (2026-08-15): every entry here has a sibling that resolves.
 */
export const FREE_ALIAS_MAP = {
  // ── codecrafters / tokenharbor ──
  "deepseek-v4-flash:free": "deepseek-v4-flash",
  "mimo-v2.5-free": "mimo-v2.5",
  "mimo-v2.5:free": "mimo-v2.5",
  // ── kilo-gateway ──
  "nvidia/nemotron-3-super-120b-a12b:free": "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-ultra-550b-a55b:free": "nvidia/nemotron-3-ultra-550b-a55b",
  // REMOVED (census re-check 2026-08-15):
  //   "auto:free" → "auto" — bazaarlink registers auto:free but no 'auto'
  //     sibling exists anywhere; the entry resolved nothing.
  //   "kwaipilot/kat-coder-pro-v2.5:free" → "kwaipilot/kat-coder-pro" — the
  //     sibling only exists in the CLINE registry; the kilo-gateway lane has
  //     no canonical entry and no lane table, so the lookup returned null.
  //     (kilo's paid id is 'kwaipilot/kat-coder-pro-v2.5' — different version.)
  //     Priced via the catch-all '*/qwen*' family pattern for now.
  // ── nesarouter (sibling exists in-registry) ──
  "nesarouter/deepseek-v4-flash-free": "nesarouter/deepseek-v4-flash",
  "nesarouter/step-3.7-flash-free": "nesarouter/step-3.7-flash",
  "nesarouter/step-3.5-flash-free": "nesarouter/step-3.5-flash",
  "nesarouter/mimo-v2.5-free": "mimo/mimo-v2.5",
  "nesarouter/glm-5.2-free": "glm-5.2",
  "nesarouter/minimax-m2.7-free": "minimax-m2.7",
  "nesarouter/minimax-m3-free": "MiniMax-M3",
  // ── tokenrouter ──
  "moonshotai/kimi-k3-free": "moonshotai/kimi-k3",
  // ── tokenrouter (free nemotron lanes — paid sibling is the fp4/omni pair) ──
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning-free": "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning",
  // ── perplexity-web auto/sonar tiers — map to their priced base models ──
  "pplx-auto": "sonar-pro",
  "pplx-sonar": "sonar",
  "pplx-gpt": "gpt-5-mini",
  "pplx-gemini": "gemini-2.5-flash",
  "pplx-sonnet": "claude-sonnet-4.5",
  "pplx-opus": "claude-opus-4.5",
  "pplx-nemotron": "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B",
};

/**
 * FREE_DENYLIST — free-marker shapes where suffix-stripping must NOT fire [2026-08-15].
 * Infix markers and router tier selectors that the guarded fallback would misprice.
 */
export const FREE_DENYLIST = new Set([
  "goldeneye-free-auto",            // infix marker — sibling is goldeneye-auto
  "kilo-auto/free",                 // router tier selector, not a suffix
  "kilo-auto",
  "nesarouter/nesa-free",           // no paid sibling anywhere
  "nesarouter/big-pickle-free",     // no paid sibling
  "nesarouter/nemotron-3-ultra-free",
  "nesarouter/north-mini-code-free",
  "nesarouter/laguna-s-2.1-free",
  "nesarouter/ling-3.0-flash-free",
  "nesarouter/longcat-2.0-free",
  "nesarouter/gpt-oss-20b-free",
  "nesarouter/nemotron-3-nano-30b-a3b-free",
  "nesarouter/codestral-latest-free",
  "nesarouter/mistral-small-latest-free",
  "nesarouter/mistral-medium-latest-free",
  "nesarouter/ministral-8b-latest-free",
  "nesarouter/ministral-3b-latest-free",
  "nesarouter/open-mistral-nemo-free",
  "nesarouter/devstral-latest-free",
  "nesarouter/mistral-large-latest-free",
  "nvidia/llama-nemotron-embed-vl-1b-v2:free",   // embedding, no LLM sibling
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
]);

/**
 * UNPRICEABLE manifest — models no honest price can describe [2026-08-15].
 * Checked at stratum 3.0, before every other lookup. Reasons are pinned by tests.
 */
export const UNPRICEABLE = [
  { provider: null, model: "default", reason: "router-pseudo-model" },
  { provider: "kilo-gateway", model: "kilo-auto/free", reason: "router-pseudo-model" },
  { provider: "github", model: "goldeneye-free-auto", reason: "router-pseudo-model" },
  // NOTE: hyperbolic/featherless originally carried a blanket no-token-pricing
  // entry (GPU hourly / flat subscription). The 2026-08-27 whole-harbor sweep
  // found per-token retail rates for their hosted open-weight models on
  // models.dev — so the blanket entry is retired and the lanes price their
  // catalog models exactly. Untracked models in those lanes still resolve
  // null (nothing added below), which is the honest residue.
  // NOTE: codecrafters serves free models through the gateway — they inherit
  // sibling rates via FREE_ALIAS_MAP, so the lane is NOT provider-unpriceable.
];

/**
 * PRICING_SOURCES — provenance beside the rates (never inside them) [2026-08-15].
 * lane: direct = vendor retail; reseller = reseller-published; subscription =
 * retail-equivalent estimate for subscription lanes (claude/codex/cursor/kimi/qoder).
 */
export const PRICING_SOURCES = {
  "_bulk": { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  openai: { source: "platform.openai.com/docs/pricing", captured: "2026-08-15", lane: "direct" },
  anthropic: { source: "claude.com/pricing", captured: "2026-08-15", lane: "direct" },
  google: { source: "ai.google.dev/gemini-api/docs/pricing", captured: "2026-08-15", lane: "direct" },
  deepseek: { source: "api-docs.deepseek.com/quick_start/pricing", captured: "2026-08-15", lane: "direct" },
  moonshotai: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  zai: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  alibaba: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  minimax: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  xai: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  mistral: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  perplexity: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  cohere: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  groq: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  cerebras: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  stepfun: { source: "platform.stepfun.ai/docs", captured: "2026-08-15", lane: "direct" },
  "xiaomi-mimo": { source: "mimo.mi.com", captured: "2026-08-15", lane: "direct" },
  "volcengine-ark": { source: "volcengine.com/docs/82379/1544106", captured: "2026-08-15", lane: "direct" },
  baidu: { source: "cloud.baidu.com/doc/qianfan", captured: "2026-08-15", lane: "direct" },
  tencent: { source: "cloud.tencent.com/document/product/1729/97731", captured: "2026-08-15", lane: "direct" },
  sambanova: { source: "cloud.sambanova.ai/pricing", captured: "2026-08-15", lane: "direct" },
  fireworks: { source: "docs.fireworks.ai/serverless/pricing", captured: "2026-08-15", lane: "direct" },
  together: { source: "together.ai/pricing", captured: "2026-08-15", lane: "direct" },
  tokenrouter: { source: "api.tokenrouter.com/api/pricing", captured: "2026-08-15", lane: "reseller" },
  nesarouter: { source: "official family rates", captured: "2026-08-15", lane: "reseller" },
  // Whole-harbor sweep [2026-08-27] — open-weight host lanes + TTS/STT/image/
  // embedding/ASR classes at vendor retail; private lanes at family estimates.
  deepinfra: { source: "models.dev/api.json", captured: "2026-08-15", lane: "direct" },
  featherless: { source: "models.dev/api.json (host retail)", captured: "2026-08-15", lane: "direct" },
  hyperbolic: { source: "models.dev/api.json (host retail)", captured: "2026-08-15", lane: "direct" },
  venice: { source: "models.dev/api.json (host retail)", captured: "2026-08-15", lane: "direct" },
  byteplus: { source: "models.dev/api.json (dated snapshots)", captured: "2026-08-15", lane: "direct" },
  volcengine: { source: "models.dev/api.json (dated snapshots)", captured: "2026-08-15", lane: "direct" },
  morph: { source: "base-model retail (opaque ids)", captured: "2026-08-15", lane: "subscription" },
  kimchi: { source: "base-model retail (opaque ids)", captured: "2026-08-15", lane: "subscription" },
  mmf: { source: "base-model retail (opaque ids)", captured: "2026-08-15", lane: "subscription" },
  "xiaomi-tokenplan": { source: "mimo.mi.com official", captured: "2026-08-15", lane: "direct" },
  zcode: { source: "family estimate (router pseudo-models)", captured: "2026-08-15", lane: "subscription" },
};

/**
 * SYNC_VENDOR_MAP — the ONLY URLs the sync endpoint may fetch [2026-08-15].
 * Hardcoded here (never from a request body) — the SSRF defense. Vendor keys are
 * selected by the caller; values map models.dev vendor ids → Vela registry ids.
 */
export const SYNC_VENDOR_MAP = {
  modelsdev: {
    url: "https://models.dev/api.json",
    role: "primary",
    vendors: {
      openai: "openai", anthropic: "anthropic", google: ["gemini", "gemini-cli"],
      deepseek: "deepseek", moonshotai: "kimi", zai: ["glm", "glm-cn"],
      alibaba: "alicode", minimax: ["minimax", "minimax-cn"], xai: "xai",
      mistral: "mistral", perplexity: "perplexity", cohere: "cohere", groq: "groq",
      cerebras: "cerebras",
    },
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    role: "cross-check",
    vendors: {},
  },
};

/**
 * Match a model ID against a glob pattern (* = wildcard). Case-insensitive:
 * registry ids mix casing (e.g. "MiniMax-M2.5" vs "minimax-m2.5").
 */
export function matchPattern(pattern, model) {
  const regex = new RegExp("^" + pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return regex.test(model);
}

// Pre-compile PATTERN_PRICING globs at module load (was recompiled per call —
// every exact-miss request paid ~N fresh RegExp constructions).
const COMPILED_PATTERNS = PATTERN_PRICING.map(({ pattern, pricing }) => ({
  regex: new RegExp("^" + pattern.split("*").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i"),
  pricing,
}));

// UNPRICEABLE fast-path indexes (stratum 3.0)
const UNPRICEABLE_MODELS = new Set(UNPRICEABLE.filter(u => u.model && u.provider === null).map(u => u.model));
const UNPRICEABLE_PROVIDERS = new Set(UNPRICEABLE.filter(u => !u.model && u.provider).map(u => u.provider));
const UNPRICEABLE_PAIRS = new Map(UNPRICEABLE.filter(u => u.model && u.provider).map(u => [`${u.provider}|${u.model}`, u.reason]));

const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

/**
 * Strip a recognized free-tier suffix from a model id. Returns the bare name,
 * or null if no suffix present. Only ':free' and '-free' suffixes are markers;
 * infix/router shapes are handled by FREE_DENYLIST before this is reached.
 */
function stripFreeSuffix(model) {
  if (model.endsWith(":free")) return model.slice(0, -":free".length);
  if (model.endsWith("-free")) return model.slice(0, -"-free".length);
  return null;
}

/** Exact-provider-override lookup across id and alias (strata 3.a + 3.b). */
function providerOverride(provider, model) {
  if (!provider) return null;
  if (has(PROVIDER_PRICING, provider) && has(PROVIDER_PRICING[provider], model)) {
    return PROVIDER_PRICING[provider][model];
  }
  const alias = PROVIDER_ID_TO_ALIAS[provider];
  if (alias && alias !== provider && has(PROVIDER_PRICING, alias) && has(PROVIDER_PRICING[alias], model)) {
    return PROVIDER_PRICING[alias][model];
  }
  return null;
}

/**
 * Resolve a FREE sibling's worth through the full non-recursive chain:
 * lane override → canonical exact → vendor-stripped exact → family pattern.
 * Never re-enters free inheritance (cycle guard) and never consults
 * UNPRICEABLE (a free marker does not unprice the paid sibling).
 * [2026-08-16 — the Star's decree: every free model carries its non-free
 * sibling's price, even when the sibling is only pattern-priced.]
 */
function resolveSiblingRate(provider, sibling) {
  const override = providerOverride(provider, sibling);
  if (override) return override;
  if (has(MODEL_PRICING, sibling)) return MODEL_PRICING[sibling];
  const base = sibling.includes("/") ? sibling.split("/").pop() : sibling;
  if (base !== sibling && has(MODEL_PRICING, base)) return MODEL_PRICING[base];
  for (const { regex, pricing } of COMPILED_PATTERNS) {
    if (regex.test(sibling) || regex.test(base)) return pricing;
  }
  return null;
}

/**
 * Resolve pricing for a model via the seven-stratum static chain (see header).
 * Synchronous and dependency-free; the async user/sync layers wrap this in
 * src/lib/db/repos/pricingRepo.js.
 *
 * @param {string} provider  registry id (usage rows record ids, not aliases)
 * @param {string} model
 * @returns {object|null}
 */
export function getPricingForModel(provider, model) {
  if (!model) return null;

  // 3.0 UNPRICEABLE manifest — router pseudo-models and no-token-pricing lanes
  if (UNPRICEABLE_MODELS.has(model)) return null;
  if (UNPRICEABLE_PROVIDERS.has(provider)) return null;
  if (UNPRICEABLE_PAIRS.has(`${provider}|${model}`)) return null;

  // 3.a + 3.b provider/lane override (id, then alias)
  const override = providerOverride(provider, model);
  if (override) return override;

  // 3.c canonical exact match (explicit entry beats inheritance)
  if (has(MODEL_PRICING, model)) return MODEL_PRICING[model];

  // 3.d FREE inheritance — verified map first, then guarded suffix-strip.
  // Both arms resolve the sibling's WORTH through the full non-recursive
  // chain (lane → exact → vendor-strip → family pattern) — the Star's
  // decree 2026-08-16: every free model carries its non-free sibling's price.
  const mappedSibling = has(FREE_ALIAS_MAP, model) ? FREE_ALIAS_MAP[model] : null;
  if (mappedSibling) {
    const inherited = resolveSiblingRate(provider, mappedSibling);
    if (inherited) return inherited;
  }
  if (!has(FREE_DENYLIST, model)) {
    const stripped = stripFreeSuffix(model);
    if (stripped) {
      const inherited = resolveSiblingRate(provider, stripped);
      if (inherited) return inherited;
    }
  }

  // 3.e canonical match with vendor prefix stripped ("deepseek/deepseek-chat")
  const baseModel = model.includes("/") ? model.split("/").pop() : model;
  if (has(MODEL_PRICING, baseModel)) return MODEL_PRICING[baseModel];

  // 3.d-tail: re-check FREE inheritance against the stripped base name so
  // namespaced free ids (vendor/model-free) inherit their sibling's full
  // worth — exact first, then family pattern [2026-08-16 decree].
  if (!has(FREE_DENYLIST, baseModel)) {
    const strippedBase = stripFreeSuffix(baseModel);
    if (strippedBase) {
      const inherited = resolveSiblingRate(provider, strippedBase);
      if (inherited) return inherited;
    }
  }

  // 3.f PATTERN_PRICING glob match (pre-compiled) — last resort
  for (const { regex, pricing } of COMPILED_PATTERNS) {
    if (regex.test(model) || regex.test(baseModel)) return pricing;
  }

  return null;
}

/**
 * Resolve pricing with its provenance record (source + lane + resolution path).
 * Returns null when unpriced; {pricing, source, captured, lane, estimate, via}.
 */
export function resolvePricingWithProvenance(provider, model) {
  const pricing = getPricingForModel(provider, model);
  if (!pricing) return null;
  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const src = PRICING_SOURCES[provider] || PRICING_SOURCES[alias] || PRICING_SOURCES._bulk;
  const via = has(FREE_ALIAS_MAP, model) || stripFreeSuffix(model) ? "free-inherit" : "static";
  return { pricing, source: src.source, captured: src.captured, lane: src.lane, estimate: src.lane === "subscription", via };
}

/**
 * Get all provider pricing (for UI / API).
 * Returns PROVIDER_PRICING — consumers should fall back to MODEL_PRICING for unlisted models.
 */
export function getDefaultPricing() {
  return PROVIDER_PRICING;
}

/**
 * Format cost for display
 * @param {number} cost
 * @returns {string}
 */
export function formatCost(cost) {
  if (cost === null || cost === undefined || isNaN(cost) || cost <= 0) return "$0.00";
  // Honest about sub-cent dust — a $0.0026 request is not $0.00 [pricing shadow fix].
  if (cost < 0.01) return "<$0.01";
  return `$${cost.toFixed(2)}`;
}

/**
 * Calculate cost from tokens and pricing
 * @param {object} tokens
 * @param {object} pricing
 * @returns {number} cost in dollars
 */
export function calculateCostFromTokens(tokens, pricing) {
  if (!tokens || !pricing) return 0;

  let cost = 0;

  const inputTokens = tokens.prompt_tokens || tokens.input_tokens || 0;
  const cachedTokens = tokens.cached_tokens || tokens.cache_read_input_tokens || 0;
  const cacheCreationTokens = tokens.cache_creation_input_tokens || 0;
  // prompt_tokens is cache-inclusive (see canonicalizeUsage): cached + cache_creation
  // are subsets, so subtract both to avoid charging them at the full input rate.
  const nonCachedInput = Math.max(0, inputTokens - cachedTokens - cacheCreationTokens);

  cost += nonCachedInput * (pricing.input / 1000000);

  if (cachedTokens > 0) {
    cost += cachedTokens * ((pricing.cached || pricing.input) / 1000000);
  }

  const outputTokens = tokens.completion_tokens || tokens.output_tokens || 0;
  cost += outputTokens * (pricing.output / 1000000);

  const reasoningTokens = tokens.reasoning_tokens || 0;
  if (reasoningTokens > 0) {
    cost += reasoningTokens * ((pricing.reasoning || pricing.output) / 1000000);
  }

  if (cacheCreationTokens > 0) {
    cost += cacheCreationTokens * ((pricing.cache_creation || pricing.input) / 1000000);
  }

  return cost;
}
