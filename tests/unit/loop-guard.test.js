// W3 · Loop discipline — loopGuard unit tests (sibling-harbor-ports §3.1 row 1).
// The guard is a pure function over the outgoing message list: it must fire on a
// genuine repetition and stay silent on healthy history.
import { describe, it, expect } from "vitest";
import { detectLoop } from "../../open-sse/utils/loopGuard.js";

function toolCall(name, args = {}) {
  return { id: `c_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

describe("detectLoop — tool-call repetition", () => {
  it("triggers when the same tool is called 3x with identical arguments", () => {
    const body = {
      messages: [
        { role: "user", content: "read the config" },
        { role: "assistant", tool_calls: [toolCall("read_file", { path: "a.js" })] },
        { role: "tool", content: "..." },
        { role: "assistant", tool_calls: [toolCall("read_file", { path: "a.js" })] },
        { role: "tool", content: "..." },
        { role: "assistant", tool_calls: [toolCall("read_file", { path: "a.js" })] },
      ],
    };
    const res = detectLoop(body);
    expect(res.detected).toBe(true);
    expect(res.hint).toMatch(/same tool with identical arguments/i);
  });

  it("does NOT trigger when the same tool is called only 2x", () => {
    const body = {
      messages: [
        { role: "user", content: "read the config" },
        { role: "assistant", tool_calls: [toolCall("read_file", { path: "a.js" })] },
        { role: "tool", content: "..." },
        { role: "assistant", tool_calls: [toolCall("read_file", { path: "a.js" })] },
      ],
    };
    expect(detectLoop(body)).toEqual({ detected: false, hint: null });
  });

  it("normalizes argument key order (same call, different key order)", () => {
    const body = {
      messages: [
        { role: "assistant", tool_calls: [toolCall("grep", { a: 1, b: 2 })] },
        { role: "assistant", tool_calls: [toolCall("grep", { b: 2, a: 1 })] },
        { role: "assistant", tool_calls: [toolCall("grep", { b: 2, a: 1 })] },
      ],
    };
    expect(detectLoop(body).detected).toBe(true);
  });

  it("triggers on a repeated tool SEQUENCE (A,B twice)", () => {
    const body = {
      messages: [
        { role: "assistant", tool_calls: [toolCall("read_file", { path: "a.js" })] },
        { role: "assistant", tool_calls: [toolCall("grep", { q: "x" })] },
        { role: "assistant", tool_calls: [toolCall("read_file", { path: "a.js" })] },
        { role: "assistant", tool_calls: [toolCall("grep", { q: "x" })] },
      ],
    };
    const res = detectLoop(body);
    expect(res.detected).toBe(true);
    expect(res.hint).toMatch(/sequence of tool calls/i);
  });
});

describe("detectLoop — text-only repetition", () => {
  it("triggers when the same assistant message repeats 3x", () => {
    const line = "I need to read the key files before I can answer the question.";
    const body = {
      messages: [
        { role: "assistant", content: line },
        { role: "assistant", content: line },
        { role: "assistant", content: line },
      ],
    };
    const res = detectLoop(body);
    expect(res.detected).toBe(true);
    expect(res.hint).toMatch(/text loop/i);
  });

  it("triggers when the same planning sentence appears in 3 assistant messages", () => {
    const sentence = "I will now inspect the authentication middleware module";
    const body = {
      messages: [
        { role: "assistant", content: `${sentence}. First pass.` },
        { role: "assistant", content: `${sentence}. Second pass.` },
        { role: "assistant", content: `${sentence}. Third pass.` },
      ],
    };
    expect(detectLoop(body).detected).toBe(true);
  });
});

describe("detectLoop — no false positives", () => {
  it("returns not-detected for empty / missing messages", () => {
    expect(detectLoop({})).toEqual({ detected: false, hint: null });
    expect(detectLoop({ messages: [] })).toEqual({ detected: false, hint: null });
    expect(detectLoop(null)).toEqual({ detected: false, hint: null });
  });

  it("returns not-detected for distinct tool calls", () => {
    const body = {
      messages: [
        { role: "assistant", tool_calls: [toolCall("read_file", { path: "a.js" })] },
        { role: "assistant", tool_calls: [toolCall("read_file", { path: "b.js" })] },
        { role: "assistant", tool_calls: [toolCall("read_file", { path: "c.js" })] },
      ],
    };
    expect(detectLoop(body).detected).toBe(false);
  });

  it("does not mutate the input body", () => {
    const body = { messages: [{ role: "assistant", content: "hello there friend, this is a longer sentence" }] };
    const snapshot = JSON.stringify(body);
    detectLoop(body);
    expect(JSON.stringify(body)).toBe(snapshot);
  });
});
