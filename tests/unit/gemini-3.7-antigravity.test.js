import { describe, it, expect } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import antigravityRegistry from "../../open-sse/providers/registry/antigravity.js";
import geminiRegistry from "../../open-sse/providers/registry/gemini.js";
import { MODEL_PRICING } from "../../open-sse/providers/pricing.js";

describe("Gemini 3.7 Flash Support & Config (#3286, #3281)", () => {
  it("registers gemini-3.7-flash tiered models in antigravity provider registry", () => {
    const agIds = antigravityRegistry.models.map(m => m.id);
    expect(agIds).toContain("gemini-3.7-flash-high");
    expect(agIds).toContain("gemini-3.7-flash-medium");
    expect(agIds).toContain("gemini-3.7-flash-low");
    expect(agIds).not.toContain("gemini-3.7-flash");
  });

  it("registers gemini-3.7-flash in gemini provider registry", () => {
    const geminiIds = geminiRegistry.models.map(m => m.id);
    expect(geminiIds).toContain("gemini-3.7-flash");
  });

  it("resolves capabilities correctly for gemini-3.7 models with official limits", () => {
    const caps = getCapabilitiesForModel("antigravity", "gemini-3.7-flash-high");
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.thinkingFormat).toBe("gemini-level");
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(65536);
  });

  it("defines gemini-3.7-flash pricing at the official 2026 rate (half the 3.6 rate)", () => {
    // Re-baselined 2026-08-15 (Pricing Covenant): Google's official pricing cut
    // gemini-3.7-flash to 0.75/3.75 — half the gemini-3.6-flash 1.5/7.5 rate
    // (models.dev/api.json + ai.google.dev/gemini-api/docs/pricing). The three
    // thinking-level suffix tiers keep parity with each other.
    expect(MODEL_PRICING["gemini-3.7-flash"]).toMatchObject({ input: 0.75, output: 3.75 });
    expect(MODEL_PRICING["gemini-3.7-flash-high"]).toEqual(MODEL_PRICING["gemini-3.7-flash-medium"]);
    expect(MODEL_PRICING["gemini-3.7-flash-medium"]).toEqual(MODEL_PRICING["gemini-3.7-flash-low"]);
  });
});
