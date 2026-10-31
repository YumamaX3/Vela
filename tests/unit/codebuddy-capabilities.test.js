import { describe, expect, it } from "vitest";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// The CodeBuddy lanes serve the GLM-5.3 family at its vendor windows. The
// provider rows must win over the stale 200k *glm-5* pattern fallback, and the
// gateway's OpenAI reasoning_effort format must win over the vendor-native
// "zai"/"kimi"/"deepseek" shapes the generic patterns carry.
describe("codebuddy capability rows", () => {
  it("resolves glm-5.3 at the 1M window on the CN lane and its alias", () => {
    for (const provider of ["codebuddy-cn", "cbcn"]) {
      expect(getCapabilitiesForModel(provider, "glm-5.3").contextWindow).toBe(1000000);
    }
  });

  it("resolves glm-5.2 at the 1M window on both lanes (intl previously fell to the 200k pattern)", () => {
    for (const provider of ["codebuddy-cn", "codebuddy-intl"]) {
      expect(getCapabilitiesForModel(provider, "glm-5.2").contextWindow).toBe(1000000);
    }
  });

  it("forces the gateway's openai reasoning format over vendor-native shapes", () => {
    expect(getCapabilitiesForModel("codebuddy-cn", "glm-5.3").thinkingFormat).toBe("openai");
    expect(getCapabilitiesForModel("codebuddy-intl", "glm-5.2").thinkingFormat).toBe("openai");
    expect(getCapabilitiesForModel("codebuddy-cn", "kimi-k3-1").thinkingFormat).toBe("openai");
    expect(getCapabilitiesForModel("codebuddy-intl", "deepseek-v4-pro").thinkingFormat).toBe("openai");
  });

  it("resolves glm-5.3-flash with vision at the 1M window", () => {
    const caps = getCapabilitiesForModel("codebuddy-cn", "glm-5.3-flash");
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(1000000);
    expect(caps.maxOutput).toBe(131072);
  });

  it("carries the kimi-k3-1 1M window on the CN lane", () => {
    expect(getCapabilitiesForModel("codebuddy-cn", "kimi-k3-1").contextWindow).toBe(1048576);
  });

  it("keeps glm-5.1 at its vendor 200k window (the 1M tier starts at 5.2)", () => {
    expect(getCapabilitiesForModel("codebuddy-cn", "glm-5.1").contextWindow).toBe(200000);
  });

  it("lifts the vendor pattern itself — glm-5.3 ids on pattern-only lanes (zcode-plan) read 1M, not 200k", () => {
    expect(getCapabilitiesForModel("zcode-plan", "glm-5.3").contextWindow).toBe(1000000);
  });
});
