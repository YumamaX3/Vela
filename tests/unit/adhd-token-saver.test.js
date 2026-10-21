// ADHD action-first style — prompt shape and injection.
import { describe, it, expect } from "vitest";
import { getADHDPrompt, ADHD_PROMPTS } from "../../open-sse/rtk/adhdPrompt.js";
import { injectADHD } from "../../open-sse/rtk/adhd.js";

describe("ADHD token saver", () => {
  it("defaults to the full ten-rule prompt and offers a lite shape", () => {
    expect(getADHDPrompt("full")).toBe(ADHD_PROMPTS.full);
    expect(getADHDPrompt("anything-else")).toBe(ADHD_PROMPTS.full);
    expect(getADHDPrompt("lite")).toBe(ADHD_PROMPTS.lite);
    expect(ADHD_PROMPTS.full).toContain("Lead with the next action");
    expect(ADHD_PROMPTS.full).toContain("End with ONE concrete next step");
    expect(ADHD_PROMPTS.lite).toContain("# I have ADHD (lite)");
  });

  it("appends the prompt to the system message exactly once", () => {
    const body = { messages: [{ role: "system", content: "base" }, { role: "user", content: "hi" }] };
    injectADHD(body, "openai", "full");
    expect(body.messages[0].content).toContain("base");
    expect(body.messages[0].content).toContain(ADHD_PROMPTS.full);
    const first = body.messages[0].content;

    injectADHD(body, "openai", "full");
    expect(body.messages[0].content).toBe(first);
  });

  it("creates a system turn when the conversation has none", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectADHD(body, "openai", "lite");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain(ADHD_PROMPTS.lite);
  });
});
