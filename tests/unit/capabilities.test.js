import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

describe("getCapabilitiesForModel", () => {
  const claudeSonnet5Expected = {
    contextWindow: 1000000,
    maxOutput: 128000,
    thinkingFormat: "claude-adaptive",
    reasoning: true,
    vision: true,
    search: true,
  };

  const kiroGpt56Expected = {
    contextWindow: 272000,
    maxOutput: 128000,
    thinkingFormat: "openai",
    reasoning: true,
    vision: true,
    search: true,
  };

  it("reports Kiro Claude Opus 5 variants as 1M adaptive-thinking models", () => {
    for (const model of [
      "claude-opus-5",
      "anthropic/claude-opus-5",
      "claude-opus-5-thinking",
      "claude-opus-5-agentic",
      "claude-opus-5-thinking-agentic",
    ]) {
      expect(getCapabilitiesForModel("kiro", model)).toMatchObject(claudeSonnet5Expected);
    }
  });

  it("reports Kiro Claude Opus 4.8 as a 1M context model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-opus-4.8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4.8-thinking").contextWindow).toBe(1000000);
    expect(getCapabilitiesForModel("kiro", "claude-opus-4-8-thinking").contextWindow).toBe(1000000);
  });

  it("reports Kiro Claude Sonnet 5 as a 1M adaptive-thinking model", () => {
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "anthropic/claude-sonnet-5")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-agentic")).toMatchObject(claudeSonnet5Expected);
    expect(getCapabilitiesForModel("kiro", "claude-sonnet-5-thinking-agentic")).toMatchObject(claudeSonnet5Expected);
  });

  it("reports Kiro GPT 5.6 models with the Kiro 272k context window", () => {
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-sol")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "openai/gpt-5.6-sol")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-terra-thinking")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-luna-agentic")).toMatchObject(kiroGpt56Expected);
    expect(getCapabilitiesForModel("kiro", "gpt-5.6-sol-thinking-agentic")).toMatchObject(kiroGpt56Expected);
  });

  // Qoder (alias qd) — context windows + reasoning flags from the LIVE Qoder
  // catalog (2026-08-21): 1M for dfmodel/dmodel/gm51model/ultimate/mmodel/
  // performance/qmodel/qmodel_latest; 256k kmodel; 180k rest. Only six lanes
  // reason natively (is_reasoning:true) — the rest must NOT be advertised as
  // reasoning (that would be a lie the other way). maxOutput 64000 (catalog
  // does not publish max_output_tokens).
  // Windows reconciled 2026-08-21: the Qoder catalog under-reports the
  // flagship lanes (180k stale). Vendor specs (z.ai / b.ai / OpenRouter) +
  // empirical bridge probe => true 1M-class windows. Only 6 lanes reason.
  const qoderQwen1M = { reasoning: false, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 131072 };
  const qoderQwen180 = { reasoning: false, thinkingFormat: "qwen", contextWindow: 180000, maxOutput: 64000 };
  const qoderQwenReason1M = { reasoning: true, thinkingFormat: "qwen", contextWindow: 1000000, maxOutput: 131072 };
  const qoderZai1M = { reasoning: true, thinkingFormat: "zai", contextWindow: 1000000, maxOutput: 131072 };
  const qoderKimi256 = { reasoning: false, thinkingFormat: "kimi", contextWindow: 256000, maxOutput: 65536 };
  const qoderKimi1M = { reasoning: false, thinkingFormat: "kimi", contextWindow: 1048576, maxOutput: 131072 };
  const qoderDeepseek1M = { reasoning: true, thinkingFormat: "deepseek", contextWindow: 1000000, maxOutput: 131072 };
  const qoderMinimax1M = { reasoning: false, thinkingFormat: "minimax", contextWindow: 1000000, maxOutput: 131072 };

  it("reports Qoder qwen-family windows + reasoning (reconciled truth)", () => {
    expect(getCapabilitiesForModel("qoder", "qmodel_38max")).toMatchObject(qoderQwenReason1M);
    expect(getCapabilitiesForModel("qoder", "qmodel_latest")).toMatchObject(qoderQwen1M);
    expect(getCapabilitiesForModel("qoder", "qmodel")).toMatchObject(qoderQwen1M);
    expect(getCapabilitiesForModel("qoder", "auto")).toMatchObject(qoderQwen180);
    expect(getCapabilitiesForModel("qoder", "ultimate")).toMatchObject(qoderQwenReason1M);
    expect(getCapabilitiesForModel("qoder", "performance")).toMatchObject(qoderQwen1M);
    expect(getCapabilitiesForModel("qoder", "efficient")).toMatchObject(qoderQwen180);
    expect(getCapabilitiesForModel("qoder", "lite")).toMatchObject(qoderQwen180);
  });

  it("reports Qoder GLM lanes with real windows (zai wire format)", () => {
    expect(getCapabilitiesForModel("qoder", "gmodel")).toMatchObject(qoderZai1M);
    expect(getCapabilitiesForModel("qoder", "gm51model")).toMatchObject(qoderZai1M);
  });

  it("reports Qoder Kimi, DeepSeek and MiniMax lanes with real windows", () => {
    expect(getCapabilitiesForModel("qoder", "kmodel_latest")).toMatchObject(qoderKimi1M);
    expect(getCapabilitiesForModel("qoder", "kmodel")).toMatchObject(qoderKimi256);
    expect(getCapabilitiesForModel("qoder", "dmodel")).toMatchObject(qoderDeepseek1M);
    expect(getCapabilitiesForModel("qoder", "dfmodel")).toMatchObject(qoderDeepseek1M);
    expect(getCapabilitiesForModel("qoder", "mmodel")).toMatchObject(qoderMinimax1M);
  });

  it("does NOT report retired or unknown qoder keys as reasoning", () => {
    // qmodel_preview was retired upstream 2026-08-17 and has no entry — must fall to the safe floor.
    expect(getCapabilitiesForModel("qoder", "qmodel_preview").reasoning).toBe(false);
    expect(getCapabilitiesForModel("qoder", "totally-unknown").reasoning).toBe(false);
  });
});
