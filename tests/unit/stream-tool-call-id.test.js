// Two streaming defects, one file:
//   1. a fragment that opens a NEW tool-call index without an id aborts strict
//      OpenAI-compatible clients ("Expected 'id' to be a string") (#4992)
//   2. the fingerprint's tool rename (read → read_client) was never restored on
//      the passthrough path, so the client was asked to call a tool it never
//      declared (#4986)
import { describe, expect, it } from "vitest";
import { ensureStreamToolCallIds, restoreStreamToolNames } from "../../open-sse/utils/streamHelpers.js";

const fragment = (toolCalls) => ({ choices: [{ index: 0, delta: { tool_calls: toolCalls } }] });

describe("ensureStreamToolCallIds", () => {
  it("mints an id for a fragment that opens an index without one", () => {
    const seen = new Map();
    const chunk = fragment([{ index: 0, function: { name: "read", arguments: "{" } }]);
    expect(ensureStreamToolCallIds(chunk, seen)).toBe(true);
    expect(typeof chunk.choices[0].delta.tool_calls[0].id).toBe("string");
    expect(chunk.choices[0].delta.tool_calls[0].id.length).toBeGreaterThan(0);
    expect(seen.get(0)).toBe(chunk.choices[0].delta.tool_calls[0].id);
  });

  it("reuses the id already seen for the same index", () => {
    const seen = new Map();
    const first = fragment([{ index: 0, id: "call_abc", function: { name: "read" } }]);
    expect(ensureStreamToolCallIds(first, seen)).toBe(false);
    const second = fragment([{ index: 0, function: { arguments: "{}" } }]);
    expect(ensureStreamToolCallIds(second, seen)).toBe(true);
    expect(second.choices[0].delta.tool_calls[0].id).toBe("call_abc");
  });

  it("keeps a provider-supplied id and records it", () => {
    const seen = new Map();
    const chunk = fragment([{ index: 3, id: "call_xyz", function: { name: "edit" } }]);
    expect(ensureStreamToolCallIds(chunk, seen)).toBe(false);
    expect(chunk.choices[0].delta.tool_calls[0].id).toBe("call_xyz");
    expect(seen.get(3)).toBe("call_xyz");
  });

  it("ignores chunks without tool calls", () => {
    const seen = new Map();
    expect(ensureStreamToolCallIds({ choices: [{ delta: { content: "hi" } }] }, seen)).toBe(false);
    expect(ensureStreamToolCallIds({}, seen)).toBe(false);
    expect(ensureStreamToolCallIds(null, seen)).toBe(false);
  });
});

describe("restoreStreamToolNames", () => {
  it("restores a fingerprint-renamed tool name", () => {
    const chunk = fragment([{ index: 0, id: "call_1", function: { name: "read_client", arguments: "{}" } }]);
    expect(restoreStreamToolNames(chunk, new Map([["read_client", "read"]]))).toBe(true);
    expect(chunk.choices[0].delta.tool_calls[0].function.name).toBe("read");
  });

  it("leaves unknown names alone", () => {
    const chunk = fragment([{ index: 0, id: "call_1", function: { name: "grep", arguments: "{}" } }]);
    expect(restoreStreamToolNames(chunk, new Map([["read_client", "read"]]))).toBe(false);
    expect(chunk.choices[0].delta.tool_calls[0].function.name).toBe("grep");
  });

  it("is a no-op without a map or without tool calls", () => {
    const chunk = fragment([{ index: 0, id: "call_1", function: { name: "read_client" } }]);
    expect(restoreStreamToolNames(chunk, null)).toBe(false);
    expect(restoreStreamToolNames({ choices: [] }, new Map([["read_client", "read"]]))).toBe(false);
  });
});
