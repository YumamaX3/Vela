// W3 · Loop discipline — terminationPrompt unit tests (sibling-harbor-ports §3.1 row 2).
// Proves (a) the Kimi gate lets a Kimi model through and blocks a Claude model,
// (b) injection lands in the outgoing body via the systemInject seam, and
// (c) the seam's idempotency means a double injection does not duplicate the prompt.
import { describe, it, expect } from "vitest";
import {
  injectTerminationPrompt,
  injectToolProtocolPrompt,
  needsTerminationPrompt,
  TERMINATION_PROMPT,
} from "../../open-sse/rtk/terminationPrompt.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("needsTerminationPrompt — the Kimi gate", () => {
  it("passes a Kimi model (provider or model segment)", () => {
    expect(needsTerminationPrompt("moonshot", "kimi-k2.7")).toBe(true);
    expect(needsTerminationPrompt("kimi", "kimi-k2.6")).toBe(true);
    expect(needsTerminationPrompt("nvidia", "moonshotai/kimi-k2.6")).toBe(true);
  });

  it("blocks a non-Kimi model", () => {
    expect(needsTerminationPrompt("anthropic", "claude-sonnet-4-5")).toBe(false);
    expect(needsTerminationPrompt("openai", "gpt-4o")).toBe(false);
    expect(needsTerminationPrompt("google", "gemini-2.5-pro")).toBe(false);
  });
});

describe("injectTerminationPrompt — injection through the systemInject seam", () => {
  it("a Kimi model receives the termination prompt (openai chat body)", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    if (needsTerminationPrompt("moonshot", "kimi-k2.7")) {
      injectTerminationPrompt(body, FORMATS.OPENAI);
    }
    const sys = body.messages.find((m) => m.role === "system");
    expect(sys).toBeTruthy();
    expect(sys.content).toContain(TERMINATION_PROMPT);
  });

  it("a Claude model receives nothing", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    if (needsTerminationPrompt("anthropic", "claude-sonnet-4-5")) {
      injectTerminationPrompt(body, FORMATS.OPENAI);
    }
    expect(body.messages.find((m) => m.role === "system")).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(TERMINATION_PROMPT);
  });

  it("injects into the Claude system field for a claude-format body", () => {
    const body = { system: "You are helpful.", messages: [{ role: "user", content: "hi" }] };
    injectTerminationPrompt(body, FORMATS.CLAUDE);
    expect(body.system).toContain("You are helpful.");
    expect(body.system).toContain(TERMINATION_PROMPT);
  });

  it("injecting twice does not duplicate the prompt (dedup)", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    injectTerminationPrompt(body, FORMATS.OPENAI);
    const afterFirst = JSON.stringify(body);
    injectTerminationPrompt(body, FORMATS.OPENAI);
    expect(JSON.stringify(body)).toBe(afterFirst);
    const occurrences = body.messages[0].content.split(TERMINATION_PROMPT).length - 1;
    expect(occurrences).toBe(1);
  });

  it("dedups a double injection onto an existing system message", () => {
    const body = { messages: [{ role: "system", content: "base" }, { role: "user", content: "hi" }] };
    injectTerminationPrompt(body, FORMATS.OPENAI);
    injectTerminationPrompt(body, FORMATS.OPENAI);
    const sys = body.messages.find((m) => m.role === "system");
    expect(sys.content.split(TERMINATION_PROMPT).length - 1).toBe(1);
  });
});

describe("injectToolProtocolPrompt", () => {
  it("lists deduped valid tool names and is idempotent", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectToolProtocolPrompt(body, FORMATS.OPENAI, ["read_file", "read_file", "grep"]);
    injectToolProtocolPrompt(body, FORMATS.OPENAI, ["read_file", "read_file", "grep"]);
    const sys = body.messages.find((m) => m.role === "system");
    expect(sys.content).toContain("Valid tool names: read_file, grep.");
    expect(sys.content.split("Valid tool names:").length - 1).toBe(1);
  });
});
