/**
 * W4 · Recovery — kimiToolParser (sibling-harbor-ports §3.1 row 3).
 *
 * Kimi K2.6/K2.7 (served through Kimchi / Cast AI / NVIDIA NIM) occasionally
 * leaks its native token-based tool-call format into the OpenAI `content` field
 * instead of populating the structured `tool_calls` array. The markup shape is:
 *
 *   <optional prose>functions.NAME:ID {"arg": "value"}functions.NAME:ID {…}
 *
 * This suite pins the fixture that matters — real leaked markup parses into a
 * correct OpenAI tool_call — plus the conservative guards: ordinary prose is
 * never rewritten, malformed fragments never throw, and structured tool_calls
 * are left alone.
 */
import { describe, it, expect } from "vitest";
import {
  hasKimiToolMarkup,
  splitKimiToolRegion,
  parseJsonObject,
  parseKimiToolCallFragment,
  extractKimiToolCalls,
  parseKimiToolCalls,
  normalizeKimiToolCalls,
} from "../../open-sse/utils/kimiToolParser.js";

// A realistic Kimchi/NVIDIA leak: prose, then the native markup with a nested
// shell command (quotes, braces) that a naive regex would mis-parse.
const LEAKED =
  'Let me look around.  functions.bash:0 {"command": "echo \\"=== PROJECTS ===\\" && ls -d */ 2>/dev/null || echo \\"No project dirs\\"", "timeout": 30000}';

describe("hasKimiToolMarkup — detection", () => {
  it("detects native Kimi markup", () => {
    expect(hasKimiToolMarkup('functions.bash:0 {"command":"ls"}')).toBe(true);
  });
  it("detects markup embedded after prose", () => {
    expect(hasKimiToolMarkup(LEAKED)).toBe(true);
  });
  it("returns false for ordinary prose and non-strings", () => {
    expect(hasKimiToolMarkup("Hello world")).toBe(false);
    expect(hasKimiToolMarkup("")).toBe(false);
    expect(hasKimiToolMarkup(null)).toBe(false);
    expect(hasKimiToolMarkup(undefined)).toBe(false);
    expect(hasKimiToolMarkup(123)).toBe(false);
  });
});

describe("splitKimiToolRegion", () => {
  it("splits leading prose from the tool region", () => {
    const { prefix, tail } = splitKimiToolRegion('I will run it functions.bash:0 {"command":"ls"}');
    expect(prefix).toBe("I will run it");
    expect(tail).toBe('functions.bash:0 {"command":"ls"}');
  });
  it("returns the original as prefix and an empty tail when no markup", () => {
    expect(splitKimiToolRegion("Just prose")).toEqual({ prefix: "Just prose", tail: "" });
  });
  it("trims whitespace-only leading prose to an empty string", () => {
    expect(splitKimiToolRegion('   functions.bash:0 {"command":"ls"}').prefix).toBe("");
  });
});

describe("parseJsonObject — balanced scanning", () => {
  it("parses nested objects", () => {
    expect(parseJsonObject('{"outer":{"inner":true}}')).toEqual({ outer: { inner: true } });
  });
  it("respects quoted braces and escaped quotes", () => {
    expect(parseJsonObject('{"cmd":"echo {a,b}","x":1}')).toEqual({ cmd: "echo {a,b}", x: 1 });
    expect(parseJsonObject('{"cmd":"echo \\"hi\\""}')).toEqual({ cmd: 'echo "hi"' });
  });
  it("stops after the first balanced object", () => {
    expect(parseJsonObject('{"a":1}{"b":2}')).toEqual({ a: 1 });
  });
  it("throws on unbalanced input", () => {
    expect(() => parseJsonObject('{"a":1')).toThrow();
  });
});

describe("parseKimiToolCallFragment", () => {
  it("parses NAME:ID {json} into an OpenAI tool_call", () => {
    const call = parseKimiToolCallFragment('bash:0 {"command":"echo hi"}', 0);
    expect(call).toEqual({
      id: "functions.bash:0",
      type: "function",
      function: { name: "bash", arguments: JSON.stringify({ command: "echo hi" }) },
    });
  });
  it("uses the index when the id is omitted", () => {
    expect(parseKimiToolCallFragment('bash {"command":"x"}', 7).id).toBe("functions.bash:7");
  });
  it("accepts dots, hyphens, underscores, and slashes in tool names", () => {
    expect(parseKimiToolCallFragment('my-tool.v2:abc {"x":1}', 0).function.name).toBe("my-tool.v2");
    expect(parseKimiToolCallFragment('my_tool:1 {"x":1}', 0).function.name).toBe("my_tool");
  });
  it("returns null rather than throwing on malformed fragments", () => {
    expect(parseKimiToolCallFragment("bash:0 no json", 0)).toBeNull();
    expect(parseKimiToolCallFragment('bash:0 {"broken"}', 0)).toBeNull();
    expect(parseKimiToolCallFragment('bad name:0 {"x":1}', 0)).toBeNull();
    expect(parseKimiToolCallFragment("", 0)).toBeNull();
  });
  it("parses empty JSON arguments", () => {
    expect(parseKimiToolCallFragment('noop:0 {}', 0).function.arguments).toBe("{}");
  });
});

describe("extractKimiToolCalls", () => {
  it("extracts multiple consecutive calls in order", () => {
    const calls = extractKimiToolCalls(
      'functions.bash:0 {"command":"ls"}functions.read:1 {"path":"README.md"}functions.bash:2 {"command":"pwd"}'
    );
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.function.name)).toEqual(["bash", "read", "bash"]);
    expect(calls[1].id).toBe("functions.read:1");
  });
  it("ignores leading prose", () => {
    const calls = extractKimiToolCalls('I will search functions.web_search:0 {"query":"vitest"}');
    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe("web_search");
  });
  it("handles nested JSON arguments", () => {
    const calls = extractKimiToolCalls('functions.complex:0 {"outer":{"inner":[1,2,3]},"flag":true}');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({ outer: { inner: [1, 2, 3] }, flag: true });
  });
  it("preserves the argument JSON exactly", () => {
    const args = '{"command":"echo \\"=== PROJECTS ===\\" && ls -d */"}';
    expect(extractKimiToolCalls(`functions.bash:0 ${args}`)[0].function.arguments).toBe(args);
  });
  it("returns [] when no markup or when the tail is malformed", () => {
    expect(extractKimiToolCalls("no tools here")).toEqual([]);
    expect(extractKimiToolCalls("")).toEqual([]);
    expect(extractKimiToolCalls('functions.bash:0 {"command":"ls"}functions.broken no json')).toHaveLength(1);
  });
  it("caps extraction at MAX_CALLS (64)", () => {
    const repeated = Array(100).fill('functions.bash:0 {"command":"x"}').join("");
    expect(extractKimiToolCalls(repeated)).toHaveLength(64);
  });
});

describe("normalizeKimiToolCalls — the fixture that matters", () => {
  it("parses leaked markup into a correct tool_call and trims the content to prose", () => {
    const { message, hasTools, originalContent } = normalizeKimiToolCalls({
      role: "assistant",
      content: LEAKED,
    });
    expect(hasTools).toBe(true);
    expect(message.content).toBe("Let me look around.");
    expect(originalContent).toBe(LEAKED);
    expect(message.tool_calls).toHaveLength(1);
    expect(message.tool_calls[0]).toMatchObject({
      id: "functions.bash:0",
      type: "function",
      function: { name: "bash" },
    });
    expect(JSON.parse(message.tool_calls[0].function.arguments)).toEqual({
      command: 'echo "=== PROJECTS ===" && ls -d */ 2>/dev/null || echo "No project dirs"',
      timeout: 30000,
    });
  });

  it("empties the content when markup starts immediately", () => {
    const { message } = normalizeKimiToolCalls({ role: "assistant", content: 'functions.bash:0 {"command":"ls"}' });
    expect(message.content).toBe("");
    expect(message.tool_calls).toHaveLength(1);
  });

  it("leaves already-structured tool_calls untouched (hasTools true, no rewrite)", () => {
    const message = {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: "{}" } }],
    };
    const result = normalizeKimiToolCalls(message);
    expect(result.hasTools).toBe(true);
    expect(result.message.tool_calls).toEqual(message.tool_calls);
  });

  it("passes through a message without markup (hasTools false, content intact)", () => {
    const message = { role: "assistant", content: "Just saying hello" };
    const result = normalizeKimiToolCalls(message);
    expect(result.hasTools).toBe(false);
    expect(result.message).toEqual(message);
    expect(result.message.tool_calls).toBeUndefined();
  });

  it("survives null / empty input", () => {
    expect(normalizeKimiToolCalls(null)).toMatchObject({ hasTools: false, originalContent: "" });
    expect(normalizeKimiToolCalls({ role: "assistant", content: "" }).hasTools).toBe(false);
  });
});

describe("parseKimiToolCalls — convenience wrapper", () => {
  it("returns the tool_calls array for markup", () => {
    expect(parseKimiToolCalls('functions.bash:0 {"command":"ls"}')).toHaveLength(1);
  });
  it("returns null when there is no markup", () => {
    expect(parseKimiToolCalls("plain text")).toBeNull();
    expect(parseKimiToolCalls("")).toBeNull();
    expect(parseKimiToolCalls(null)).toBeNull();
    expect(parseKimiToolCalls(42)).toBeNull();
  });
});
