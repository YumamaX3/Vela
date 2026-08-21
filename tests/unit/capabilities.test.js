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

  // Qoder (alias qd) — every frontier lane reasons natively. Proven by the
  // model-reasoning-audit battery (2026-08-21): each qd/* emits real hidden
  // reasoning tokens. This block fixes the registry lie where qd/* fell back
  // to DEFAULT caps (reasoning:false), making thinking-capable clients
  // disable thinking — the root of "qd/qmodel_38max can't think".
  const qoderQwen = { reasoning: true, thinkingFormat: "qwen", contextWindow: 200000, maxOutput: 64000 };
  const qoderZai = { reasoning: true, thinkingFormat: "zai", contextWindow: 200000, maxOutput: 64000 };
  const qoderKimi = { reasoning: true, thinkingFormat: "kimi", contextWindow: 200000, maxOutput: 64000 };
  const qoderDeepseek = { reasoning: true, thinkingFormat: "deepseek", contextWindow: 200000, maxOutput: 64000 };

  it("reports Qoder qwen-family models as reasoning (qwen wire format)", () => {
    for (const model of ["qmodel_38max", "qmodel_latest", "qmodel", "auto", "ultimate", "performance", "efficient", "lite"]) {
      expect(getCapabilitiesForModel("qoder", model)).toMatchObject(qoderQwen);
    }
  });

  it("reports Qoder GLM lanes as reasoning (zai wire format)", () => {
    expect(getCapabilitiesForModel("qoder", "gmodel")).toMatchObject(qoderZai);
    expect(getCapabilitiesForModel("qoder", "gm51model")).toMatchObject(qoderZai);
  });

  it("reports Qoder Kimi and DeepSeek lanes as reasoning", () => {
    expect(getCapabilitiesForModel("qoder", "kmodel_latest")).toMatchObject(qoderKimi);
    expect(getCapabilitiesForModel("qoder", "kmodel")).toMatchObject(qoderKimi);
    expect(getCapabilitiesForModel("qoder", "dmodel")).toMatchObject(qoderDeepseek);
    expect(getCapabilitiesForModel("qoder", "dfmodel")).toMatchObject(qoderDeepseek);
  });

  it("does NOT report retired or unknown qoder keys as reasoning", () => {
    // qmodel_preview was retired upstream 2026-08-17 and has no entry — must fall to the safe floor.
    expect(getCapabilitiesForModel("qoder", "qmodel_preview").reasoning).toBe(false);
    expect(getCapabilitiesForModel("qoder", "totally-unknown").reasoning).toBe(false);
  });
});
