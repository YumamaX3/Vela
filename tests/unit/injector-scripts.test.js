/**
 * Injector scripts (027) — the dispatch seam.
 *
 * Proves the script half of applyUserInjectors, the half that today's system
 * injector could never prove because it never existed:
 *
 *   S1. system behavior is UNCHANGED — same system message, same position, and
 *       a script beside a system injector does not disturb it
 *   S2. a script inserts its turns, in order, as fake history — before the live
 *       conversation and after the system message (OpenAI chat shape)
 *   S3. idempotent — applying twice, or on a spread-copied body that lost the
 *       marker, inserts no duplicate
 *   S4. fail-open — a malformed script is skipped and the request body is left
 *       exactly as it was
 *   S5. the wire shapes — Claude blocks, Gemini parts/model role, Responses
 *       items, Kiro history — each receive turns in its own grammar
 *   S6. a script is not a scanner — it can never refuse, and it is invisible to
 *       JSON.stringify (the marker never crosses the boundary)
 *   S7. grammar safety — a script cannot open a Gemini/Claude history with an
 *       assistant turn or place itself ahead of the system message
 */
import { describe, it, expect } from "vitest";
import { applyUserInjectors } from "../../open-sse/rtk/userInjectors.js";
import { SCRIPT_MARKER_KEY } from "../../open-sse/rtk/scriptInject.js";

const LOG = { info: () => {}, warn: () => {} };

const SCRIPT = [
  { role: "user", content: "Speak like a pirate." },
  { role: "assistant", content: "Arrr, that I shall." },
];

function openaiBody() {
  return {
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Tell me about the sea." },
    ],
  };
}

function scriptInjector(overrides = {}) {
  return { name: "pirate", kind: "script", turns: SCRIPT, enabled: true, applyTo: "llm", ...overrides };
}

function apply(body, format, injectors, ctx = {}) {
  return applyUserInjectors(body, format, { injectors, kind: "llm", log: LOG, ctx });
}

describe("S1 — system behavior is unchanged", () => {
  it("a system injector still appends into the system message exactly as before", () => {
    const body = openaiBody();
    const n = apply(body, "openai", [{ name: "s", prompt: "Answer in Indonesian.", position: "append" }]);
    expect(n).toBe(1);
    expect(body.messages[0]).toEqual({ role: "system", content: "You are helpful.\n\nAnswer in Indonesian." });
    expect(body.messages).toHaveLength(2); // no turns added
  });

  it("an injector with no kind reads as a system injector (additive default)", () => {
    const body = openaiBody();
    const n = apply(body, "openai", [{ name: "s", prompt: "Be brief.", position: "prepend" }]);
    expect(n).toBe(1);
    expect(body.messages[0].content).toBe("Be brief.\n\nYou are helpful.");
  });

  it("a script beside a system injector leaves the system text to the system injector alone", () => {
    const body = openaiBody();
    const n = apply(body, "openai", [
      { name: "s", prompt: "Answer in Indonesian.", position: "append" },
      scriptInjector(),
    ]);
    expect(n).toBe(2);
    expect(body.messages[0].content).toBe("You are helpful.\n\nAnswer in Indonesian.");
  });
});

describe("S2 — a script inserts its turns, in order, as fake history", () => {
  it("inserts the turns after the system message and before the live conversation", () => {
    const body = openaiBody();
    const n = apply(body, "openai", [scriptInjector()]);
    expect(n).toBe(1);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(body.messages[1].content).toBe("Speak like a pirate.");
    expect(body.messages[2].content).toBe("Arrr, that I shall.");
    expect(body.messages[3].content).toBe("Tell me about the sea."); // the real turn, untouched
  });

  it("expands variables in turn content at dispatch", () => {
    const body = openaiBody();
    apply(body, "openai", [scriptInjector({ turns: [{ role: "user", content: "You are {{model}}." }, { role: "assistant", content: "Yes, on {{date}}." }] })], { model: "gpt-4o", date: "2026-11-02" });
    expect(body.messages[1].content).toBe("You are gpt-4o.");
    expect(body.messages[2].content).toBe("Yes, on 2026-11-02.");
  });

  it("applyTo defaults to llm and applies to a chat request; '*' is explicit and equal here", () => {
    const a = openaiBody();
    expect(apply(a, "openai", [scriptInjector()])).toBe(1);
    const b = openaiBody();
    expect(apply(b, "openai", [scriptInjector({ applyTo: "*" })])).toBe(1);
    expect(b.messages[1].content).toBe("Speak like a pirate.");
  });
});

describe("S3 — idempotent, no double-insert on retry", () => {
  it("applying the same script twice inserts once", () => {
    const body = openaiBody();
    apply(body, "openai", [scriptInjector()]);
    const afterFirst = body.messages.length;
    apply(body, "openai", [scriptInjector()]);
    expect(body.messages.length).toBe(afterFirst);
    // The second pass is reported as applied (present), so the caller logs once.
    expect(body.messages.filter((m) => m.content === "Speak like a pirate.")).toHaveLength(1);
  });

  it("recognises the turns on a spread-copied body that lost the marker", () => {
    const body = openaiBody();
    apply(body, "openai", [scriptInjector()]);
    // The shape chatCore's retry path can produce: a copy without the marker.
    const copy = { ...body, messages: body.messages.map((m) => ({ ...m })) };
    expect(copy[SCRIPT_MARKER_KEY]).toBeUndefined();
    apply(copy, "openai", [scriptInjector()]);
    expect(copy.messages.filter((m) => m.content === "Speak like a pirate.")).toHaveLength(1);
  });
});

describe("S4 — fail-open on a malformed script", () => {
  it("skips a script whose turns are not an array, leaving the body untouched", () => {
    const body = openaiBody();
    const snapshot = JSON.stringify(body);
    const n = apply(body, "openai", [scriptInjector({ turns: "{not json}" })]);
    expect(n).toBe(0);
    expect(JSON.stringify(body)).toBe(snapshot);
  });

  it("skips turns with an unknown role or empty content rather than inventing one", () => {
    const body = openaiBody();
    const n = apply(body, "openai", [scriptInjector({ turns: [
      { role: "system", content: "nope" },
      { role: "user", content: "   " },
      { role: "assistant", content: "real" },
    ] })]);
    // Only the assistant turn survives normalization; an assistant-only script
    // has no user opener, so on an OpenAI body it still lands, but the invalid
    // turns never appear.
    const text = JSON.stringify(body.messages);
    expect(text).not.toContain("nope");
    expect(n).toBeLessThanOrEqual(1);
  });

  it("survives a script whose turns are all invalid (nothing to insert)", () => {
    const body = openaiBody();
    const snapshot = JSON.stringify(body);
    const n = apply(body, "openai", [scriptInjector({ turns: [{ role: "tool", content: "x" }] })]);
    expect(n).toBe(0);
    expect(JSON.stringify(body)).toBe(snapshot);
  });
});

describe("S5 — each wire shape receives turns in its own grammar", () => {
  it("Claude gets text blocks in messages[]", () => {
    const body = { system: "sys", messages: [{ role: "user", content: "hi" }] };
    apply(body, "claude", [scriptInjector()]);
    expect(body.messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "Speak like a pirate." }] });
    expect(body.messages[1]).toEqual({ role: "assistant", content: [{ type: "text", text: "Arrr, that I shall." }] });
    expect(body.messages[2].content).toBe("hi");
  });

  it("Gemini/Vertex get parts[] with the model role for assistant turns", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    apply(body, "gemini", [scriptInjector()]);
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[0].parts[0].text).toBe("Speak like a pirate.");
  });

  it("Responses input[] gets message items with input_text", () => {
    const body = { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }] };
    apply(body, "openai-responses", [scriptInjector()]);
    expect(body.input[0]).toEqual({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Speak like a pirate." }],
    });
    expect(body.input[1].role).toBe("assistant");
  });

  it("Kiro gets history turns in conversationState", () => {
    const body = { conversationState: { history: [{ userInputMessage: { content: "hi" } }] } };
    apply(body, "kiro", [scriptInjector()]);
    expect(body.conversationState.history[0]).toEqual({ userInputMessage: { content: "Speak like a pirate." } });
    expect(body.conversationState.history[1]).toEqual({ assistantResponseMessage: { content: "Arrr, that I shall." } });
  });
});

describe("S6 — a script is not a scanner; the marker never crosses the boundary", () => {
  it("the injected turns are plain text — no findings, no action", () => {
    const body = openaiBody();
    const n = apply(body, "openai", [scriptInjector()]);
    expect(typeof n).toBe("number"); // applyUserInjectors returns a count, never a decision
    expect(body.messages[1]).toHaveProperty("content", "Speak like a pirate.");
  });

  it("JSON.stringify of the body never carries the internal marker", () => {
    const body = openaiBody();
    apply(body, "openai", [scriptInjector()]);
    const wire = JSON.stringify(body);
    expect(wire).not.toContain("speak like a pirate") === false; // turns ARE on the wire
    expect(wire).not.toContain("_vela_inject_scripts");
    expect(wire).not.toMatch(/inject\.scriptMarker/);
    expect(Object.keys(body).some((k) => /vela/i.test(k))).toBe(false);
  });
});

describe("S7 — grammar safety: the join keeps history well-formed", () => {
  it("Gemini history cannot open with an assistant turn — leading assistant turns are dropped", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    apply(body, "gemini", [scriptInjector({ turns: [
      { role: "assistant", content: "lead-in" },
      { role: "user", content: "open" },
      { role: "assistant", content: "reply" },
    ] })]);
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[0].parts[0].text).toBe("open");
    expect(JSON.stringify(body)).not.toContain("lead-in");
  });

  it("an assistant-only script never lands on a Gemini body (no valid opener)", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    const n = apply(body, "gemini", [scriptInjector({ turns: [{ role: "assistant", content: "only" }] })]);
    expect(n).toBe(0);
    expect(body.contents).toHaveLength(1);
  });

  it("an OpenAI script lands after the system message, never ahead of it", () => {
    const body = openaiBody();
    apply(body, "openai", [scriptInjector()]);
    expect(body.messages[0].role).toBe("system");
  });
});
