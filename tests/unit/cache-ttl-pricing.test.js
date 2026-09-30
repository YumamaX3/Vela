import { describe, it, expect } from "vitest";
import { canonicalizeUsage, extractUsage, mergeUsage } from "../../open-sse/utils/usageTracking.js";
import { calculateCostFromTokens, MODEL_PRICING } from "../../open-sse/providers/pricing.js";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";

// C1 — Cache Pricing Truth (the TTL split).
// Anthropic prompt caching carries two write tiers (2026-09-30, verified live
// against platform.claude.com/docs/en/build-with-claude/prompt-caching):
//   5m writes = 1.25x base input  (the stored `cache_creation` rate)
//   1h writes = 2x    base input  (derived in calculateCostFromTokens — never
//                                 a sixth rate field, per open-sse/AGENTS.md)
// The 1h count rides the canonical object as a flat field
// (cache_creation_1h_input_tokens), flattened from
// usage.cache_creation.ephemeral_1h_input_tokens by the extractors.
// Client-facing usage NEVER carries the split; the ledger does.

const FABLE = { input: 10, output: 50, cached: 0.25, cache_creation: 12.5 };

describe("calculateCostFromTokens — TTL split (5m at 1.25x, 1h at 2x input)", () => {
  it("charges a mixed 5m/1h write split at the two verified rates", () => {
    // canonical: prompt 600 includes cached 200 + creation 50 (30 of it 1h)
    const cost = calculateCostFromTokens(
      { prompt_tokens: 600, completion_tokens: 50, cached_tokens: 200,
        cache_creation_input_tokens: 50, cache_creation_1h_input_tokens: 30 },
      FABLE
    );
    // nonCached 350@10 + cached 200@0.25 + output 50@50 + 5m 20@12.5 + 1h 30@20
    const expected = (350 * 10 + 200 * 0.25 + 50 * 50 + 20 * 12.5 + 30 * 20) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("charges an all-1h write entirely at 2x input", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 500, completion_tokens: 50, cached_tokens: 0,
        cache_creation_input_tokens: 50, cache_creation_1h_input_tokens: 50 },
      FABLE
    );
    const expected = (450 * 10 + 50 * 20 + 50 * 50) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("falls back to the legacy single-rate charge when no 1h field is present", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 330, completion_tokens: 50, cached_tokens: 200, cache_creation_input_tokens: 30 },
      FABLE
    );
    const expected = (100 * 10 + 200 * 0.25 + 30 * 12.5 + 50 * 50) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });

  it("clamps a pathological 1h > total to the total creation count", () => {
    const cost = calculateCostFromTokens(
      { prompt_tokens: 100, completion_tokens: 0, cached_tokens: 0,
        cache_creation_input_tokens: 30, cache_creation_1h_input_tokens: 500 },
      FABLE
    );
    // clamped: 5m = 30-30 = 0, the whole write at 2x
    const expected = (70 * 10 + 30 * 20) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12);
  });
});

describe("canonicalizeUsage — TTL split + the hybrid fold guard", () => {
  it("carries the 1h field through the fold without disturbing the prompt sum", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 100, completion_tokens: 50,
      cache_read_input_tokens: 200, cache_creation_input_tokens: 30,
      cache_creation_1h_input_tokens: 12,
    });
    expect(out.prompt_tokens).toBe(330);
    expect(out.cached_tokens).toBe(200);
    expect(out.cache_creation_input_tokens).toBe(30);
    expect(out.cache_creation_1h_input_tokens).toBe(12);
  });

  it("does NOT double-fold the translator's hybrid state (prompt_tokens already inclusive)", () => {
    // claude-to-openai streaming leaves state.usage carrying BOTH spellings:
    // prompt_tokens = input + cache_read + cache_creation AND input_tokens.
    // The fold must use the exclusive count or the cache subsets land twice
    // (560 = phantom 100 full-price + 230 write charges).
    const out = canonicalizeUsage({
      prompt_tokens: 330, completion_tokens: 20,
      input_tokens: 100,
      cache_read_input_tokens: 200, cache_creation_input_tokens: 30,
      output_tokens: 20,
    });
    expect(out.prompt_tokens).toBe(330); // not 560
    expect(out.cached_tokens).toBe(200);
    expect(out.cache_creation_input_tokens).toBe(30);
  });

  it("folds a 1h-only write (total creation absent, nested Anthropic shape)", () => {
    const out = canonicalizeUsage({
      input_tokens: 100, completion_tokens: 5,
      cache_creation_1h_input_tokens: 500,
    });
    expect(out.prompt_tokens).toBe(600);
    expect(out.cache_creation_input_tokens).toBe(500);
    expect(out.cache_creation_1h_input_tokens).toBe(500);
  });

  it("clamps the carried 1h to the total creation count", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 100, completion_tokens: 0,
      cache_creation_input_tokens: 30, cache_creation_1h_input_tokens: 500,
    });
    expect(out.cache_creation_1h_input_tokens).toBe(30);
  });

  it("stays idempotent when the 1h field rides along", () => {
    const once = canonicalizeUsage({
      prompt_tokens: 100, completion_tokens: 50,
      cache_read_input_tokens: 200, cache_creation_input_tokens: 30,
      cache_creation_1h_input_tokens: 12,
    });
    const twice = canonicalizeUsage(once);
    expect(twice).toEqual(once);
  });

  it("leaves legacy rows byte-identical (no 1h key when absent)", () => {
    const out = canonicalizeUsage({
      prompt_tokens: 100, completion_tokens: 50,
      cache_read_input_tokens: 200, cache_creation_input_tokens: 30,
    });
    expect(out).not.toHaveProperty("cache_creation_1h_input_tokens");
  });
});

describe("extraction — the split enters through every front door", () => {
  it("extractUsage flattens the nested Anthropic shape at message_start", () => {
    const u = extractUsage({
      type: "message_start",
      message: { usage: { input_tokens: 100, output_tokens: 1,
        cache_read_input_tokens: 200, cache_creation_input_tokens: 30,
        cache_creation: { ephemeral_5m_input_tokens: 18, ephemeral_1h_input_tokens: 12 } } },
    });
    expect(u.cache_creation_input_tokens).toBe(30);
    expect(u.cache_creation_1h_input_tokens).toBe(12);
  });

  it("extractUsage carries the 1h split at message_delta", () => {
    const u = extractUsage({
      type: "message_delta",
      usage: { output_tokens: 50, cache_creation: { ephemeral_1h_input_tokens: 12 } },
    });
    expect(u.cache_creation_1h_input_tokens).toBe(12);
  });

  it("extractUsageFromResponse carries flat and nested 1h from a non-streamed Claude body", () => {
    const u = extractUsageFromResponse({
      usage: { input_tokens: 100, output_tokens: 20,
        cache_read_input_tokens: 200, cache_creation_input_tokens: 30,
        cache_creation: { ephemeral_1h_input_tokens: 12 } },
    });
    expect(u.prompt_tokens).toBe(100);
    expect(u.cache_creation_input_tokens).toBe(30);
    expect(u.cache_creation_1h_input_tokens).toBe(12);
  });

  it("mergeUsage preserves the 1h field across the start→delta merge", () => {
    const start = extractUsage({
      type: "message_start",
      message: { usage: { input_tokens: 100, output_tokens: 1,
        cache_read_input_tokens: 200, cache_creation_input_tokens: 30,
        cache_creation: { ephemeral_1h_input_tokens: 12 } } },
    });
    const delta = extractUsage({ type: "message_delta", usage: { output_tokens: 50 } });
    const canon = canonicalizeUsage(mergeUsage(start, delta));
    expect(canon.prompt_tokens).toBe(330);
    expect(canon.cache_creation_1h_input_tokens).toBe(12);
  });
});

describe("pricing table — the four verified additions (2026-09-30)", () => {
  const EXPECTED = {
    "claude-fable-5.1":  { input: 10, output: 50, cached: 0.25, reasoning: 50, cache_creation: 12.5 },
    "claude-mythos-5.1": { input: 10, output: 50, cached: 0.25, reasoning: 50, cache_creation: 12.5 },
    "claude-opus-5.5":   { input: 4,  output: 20, cached: 0.2,  reasoning: 20, cache_creation: 5 },
    "claude-sonnet-5.5": { input: 2,  output: 10, cached: 0.2,  reasoning: 10, cache_creation: 2.5 },
  };
  it("carries exactly the verified rates", () => {
    for (const [model, rates] of Object.entries(EXPECTED)) {
      expect(MODEL_PRICING[model]).toEqual(rates);
    }
  });
  it("holds the verified shape: five numeric fields, cache_creation = 1.25x input", () => {
    for (const [model, rates] of Object.entries(EXPECTED)) {
      const entry = MODEL_PRICING[model];
      expect(Object.keys(entry).sort()).toEqual(["cache_creation", "cached", "input", "output", "reasoning"]);
      for (const v of Object.values(entry)) expect(Number.isFinite(v)).toBe(true);
      expect(entry.cache_creation).toBeCloseTo(entry.input * 1.25, 10);
    }
  });
  it("holds the verified read multipliers (cached / input)", () => {
    expect(MODEL_PRICING["claude-fable-5.1"].cached / MODEL_PRICING["claude-fable-5.1"].input).toBeCloseTo(0.025, 12);
    expect(MODEL_PRICING["claude-mythos-5.1"].cached / MODEL_PRICING["claude-mythos-5.1"].input).toBeCloseTo(0.025, 12);
    expect(MODEL_PRICING["claude-opus-5.5"].cached / MODEL_PRICING["claude-opus-5.5"].input).toBeCloseTo(0.05, 12);
    expect(MODEL_PRICING["claude-sonnet-5.5"].cached / MODEL_PRICING["claude-sonnet-5.5"].input).toBeCloseTo(0.1, 12);
  });
});

describe("end-to-end — a streamed Claude request priced through the full chain", () => {
  it("message_start → merge → canonicalize → cost, on fable-5.1 rates", () => {
    const start = extractUsage({
      type: "message_start",
      message: { usage: { input_tokens: 100, output_tokens: 1,
        cache_read_input_tokens: 200, cache_creation_input_tokens: 30,
        cache_creation: { ephemeral_5m_input_tokens: 18, ephemeral_1h_input_tokens: 12 } } },
    });
    const delta = extractUsage({ type: "message_delta", usage: { output_tokens: 50 } });
    const canon = canonicalizeUsage(mergeUsage(start, delta));
    const cost = calculateCostFromTokens(canon, MODEL_PRICING["claude-fable-5.1"]);
    // nonCached 100@10 + cached 200@0.25 + output 50@50 + 5m 18@12.5 + 1h 12@20
    const expected = (100 * 10 + 200 * 0.25 + 50 * 50 + 18 * 12.5 + 12 * 20) / 1_000_000;
    expect(cost).toBeCloseTo(expected, 12); // 0.004015
  });
});
