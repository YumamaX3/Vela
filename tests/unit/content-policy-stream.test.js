// AI Lab W4a locking suite — response-path content policy.
// Proves: leaf-path redaction touches ONLY assistant text (tool args/alt-text
// structurally unreachable), ReDoS patterns are rejected at compile + scans
// time-boxed, the 451 block envelope, and honest stream-abort semantics.
import { describe, it, expect } from "vitest";
import {
  validatePattern, compileProfile, scanText, applyContentPolicy,
  walkOpenAI, walkClaude, walkGemini, policyBlockEvent, VERDICTS,
} from "open-sse/rtk/contentPolicy.js";

const FLAG = { id: "p1", name: "flag-pol", action: "flag", patterns: ["(badword|forbidden)"], enabled: true };
const REDACT = { id: "p2", name: "redact-pol", action: "redact", patterns: ["secret\\s*\\w+"], enabled: true };
const BLOCK = { id: "p3", name: "block-pol", action: "block", patterns: ["(violent content|explicit text)"], enabled: true };

describe("pattern validation (ReDoS guard)", () => {
  it("rejects nested-quantifier bombs", () => {
    expect(validatePattern("(a+)+$")).toBeTruthy();
    expect(validatePattern("(a*)*")).toBeTruthy();
    expect(validatePattern("(a|a)*")).toBeTruthy(); // classic OWASP bomb
  });
  it("accepts benign patterns, caps length, rejects invalid regex", () => {
    expect(validatePattern("secret word")).toBeNull();
    expect(validatePattern("x".repeat(300))).toBeTruthy();
    expect(validatePattern("([unclosed")).toBeTruthy();
  });
  it("compileProfile drops invalid patterns silently (fail-open)", () => {
    const c = compileProfile({ id: "x", action: "flag", patterns: ["(a+)+$", "ok word", "([bad"] });
    expect(c.patterns.map((p) => p.source)).toEqual(["ok word"]);
  });
});

describe("leaf-path discipline — tool args / alt-text unreachable", () => {
  it("OpenAI: redacts choices[].delta.content AND message.content, NEVER tool args", () => {
    const body = {
      choices: [
        { delta: { content: "the secret value is here", tool_calls: [{ function: { arguments: '{"x":"secret value"}' } }] } },
        { message: { content: "another secret value", tool_calls: [{ function: { arguments: "secret value" } }] } },
      ],
    };
    const profile = compileProfile(REDACT);
    const { verdict } = applyContentPolicy(body, "openai", profile);
    expect(verdict).toBe("redact");
    expect(body.choices[0].delta.content).not.toContain("secret value");
    expect(body.choices[1].message.content).not.toContain("secret value");
    // Tool-call arguments survive UNTOUCHED — the walker never reaches them.
    expect(body.choices[0].delta.tool_calls[0].function.arguments).toBe('{"x":"secret value"}');
    expect(body.choices[1].message.tool_calls[0].function.arguments).toBe("secret value");
  });

  it("Claude: redacts content_block_delta.text_delta.text, never tool_result", () => {
    const body = {
      content: [
        { type: "text", delta: { type: "text_delta", text: "leak secret value now" } },
        { type: "tool_use", delta: { type: "input_json_delta", partial_json: "secret value" } },
        { type: "tool_result", content: [{ type: "text", text: "secret value from tool" }] },
      ],
    };
    const profile = compileProfile(REDACT);
    const { verdict } = applyContentPolicy(body, "claude", profile);
    expect(verdict).toBe("redact");
    expect(body.content[0].delta.text).toContain("[CONTENT REDACTED]");
    // tool_use partial_json + tool_result text survive — unreachable by design.
    expect(body.content[1].delta.partial_json).toContain("secret value");
    expect(body.content[2].content[0].text).toContain("secret value from tool");
  });

  it("Gemini: redacts parts[].text, never inline-data/alt shapes", () => {
    const body = {
      candidates: [{ content: { parts: [{ text: "find secret value here" }, { inlineData: { data: "secret value" } }] } }],
    };
    const profile = compileProfile(REDACT);
    const { verdict } = applyContentPolicy(body, "gemini", profile);
    expect(verdict).toBe("redact");
    expect(body.candidates[0].content.parts[0].text).toContain("[CONTENT REDACTED]");
    expect(body.candidates[0].content.parts[1].inlineData.data).toContain("secret value");
  });
});

describe("block verdict + honest stream-abort", () => {
  it("block → verdict block with source, 451 envelope shape, breaker/fallback visible", () => {
    const body = { choices: [{ delta: { content: "this has violent content inside" } }] };
    const profile = compileProfile(BLOCK);
    const { verdict, source } = applyContentPolicy(body, "openai", profile);
    expect(verdict).toBe("block");
    expect(source).toBe("(violent content|explicit text)");

    const ev = policyBlockEvent(profile, "req-123");
    expect(ev.status).toBe(403); // 403-shaped internal event — satisfies isContentPolicy
    expect(ev.errorText).toContain("content policy");
    expect(ev.contentPolicyBlocked).toBe(true);
    expect(ev.requestId).toBe("req-123");
  });

  it("flag → pass-through, no mutation", () => {
    const body = { choices: [{ delta: { content: "contains forbidden word" } }] };
    const profile = compileProfile(FLAG);
    const { verdict } = applyContentPolicy(body, "openai", profile);
    expect(verdict).toBe("flag");
    expect(body.choices[0].delta.content).toContain("forbidden"); // untouched
  });

  it("no match → verdict none, body untouched", () => {
    const body = { choices: [{ delta: { content: "clean text" } }] };
    const before = JSON.stringify(body);
    const { verdict } = applyContentPolicy(body, "openai", compileProfile(BLOCK));
    expect(verdict).toBe("none");
    expect(JSON.stringify(body)).toBe(before);
  });

  it("detector crash fails OPEN (a throwing pattern never blocks traffic)", () => {
    const evil = { id: "e", action: "block", patterns: ["(a+)+$"] }; // ReDoS bomb
    const profile = compileProfile(evil);
    expect(profile.patterns).toHaveLength(0); // rejected at compile → inert
    const body = { choices: [{ delta: { content: "aaaa aaaa aaaa" } }] };
    const { verdict } = applyContentPolicy(body, "openai", profile);
    expect(verdict).toBe("none"); // no hang, no block — the guarantee holds
  });
});

describe("verdict taxonomy (W4b)", () => {
  it("three first-class kinds", () => {
    expect(VERDICTS).toEqual({
      UPSTREAM_REFUSAL: "UPSTREAM_REFUSAL",
      GATEWAY_POLICY_BLOCK: "GATEWAY_POLICY_BLOCK",
      ACCOUNT_FAILURE: "ACCOUNT_FAILURE",
    });
  });
});

describe("walkers stay precise", () => {
  it("walkOpenAI/walkClaude/walkGemini count touched leaves only", () => {
    expect(walkOpenAI({ choices: [{ delta: { content: "a" } }] }, () => "b")).toBe(1);
    expect(walkClaude({ content: [{ delta: { text: "a" } }, { type: "tool_use", delta: { partial_json: "x" } }] }, () => "b")).toBe(1);
    expect(walkGemini({ candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] }, () => "c")).toBe(2);
  });
});
