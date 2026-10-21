// systemone URL derivation — the chat endpoint's sibling.
import { describe, it, expect } from "vitest";
import { systemoneUrl } from "@/sse/handlers/systemone.js";

describe("systemone URL", () => {
  it("replaces the chat completions endpoint with systemone", () => {
    expect(systemoneUrl("openai", {})).toBe("https://api.openai.com/v1/systemone");
  });

  it("honours a connection's custom base URL", () => {
    expect(systemoneUrl("openai", { providerSpecificData: { baseUrl: "https://gateway.local/v1" } }))
      .toBe("https://gateway.local/v1/systemone");
    expect(systemoneUrl("openai", { providerSpecificData: { baseUrl: "https://gateway.local/chat/completions" } }))
      .toBe("https://gateway.local/systemone");
  });

  it("returns null when the provider has no base URL at all", () => {
    expect(systemoneUrl("does-not-exist", {})).toBeNull();
  });
});
