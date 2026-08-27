// AI Lab W1 locking suite — the pipeline injector band.
// Proves: fail-open on malformed entries, applyTo filtering, distinct-text
// applied-count hardening (2N→1 captureSystemText walks), and the legacy
// applyUserInjectors wrapper behaving identically to the pipeline band.
import { describe, it, expect } from "vitest";
import { runRtkPipeline, captureSystemText, applyRendered } from "open-sse/rtk/pipeline.js";
import { applyUserInjectors, normalizeUserInjectors } from "open-sse/rtk/userInjectors.js";
import { FORMATS } from "open-sse/translator/formats.js";

function openaiBody(messages = [{ role: "user", content: "hi" }]) {
  return { model: "gpt-5", messages };
}

describe("rtk pipeline — injector band (W1)", () => {
  it("applies enabled llm injectors in order; returns applied + distinct counts", () => {
    const body = openaiBody([{ role: "system", content: "base" }, { role: "user", content: "hi" }]);
    const { trace } = runRtkPipeline(body, FORMATS.OPENAI, {
      injectors: [
        { name: "A", prompt: "alpha", position: "append", applyTo: "llm", enabled: true },
        { name: "B", prompt: "beta", position: "append", applyTo: "llm", enabled: true },
      ],
    });
    expect(trace.applied).toBe(2);
    expect(trace.appliedDistinct).toBe(2);
    expect(trace.names).toEqual(["A", "B"]);
    const sys = body.messages.find((m) => m.role === "system");
    expect(sys.content).toContain("alpha");
    expect(sys.content).toContain("beta");
  });

  it("distinct-text hardening: two injectors rendering identical text count once", () => {
    const body = openaiBody();
    const { trace } = runRtkPipeline(body, FORMATS.OPENAI, {
      injectors: [
        { name: "A", prompt: "same text", enabled: true },
        { name: "B", prompt: "same text", enabled: true },
      ],
    });
    expect(trace.applied).toBe(2); // both physically layered
    expect(trace.appliedDistinct).toBe(1); // one distinct rendered text
  });

  it("fail-open: malformed entries are skipped, never throw", () => {
    const body = openaiBody();
    const { trace } = runRtkPipeline(body, FORMATS.OPENAI, {
      injectors: [null, {}, { name: "", prompt: "x" }, { name: "ok", prompt: "fine" }, 42, "str"],
    });
    expect(trace.applied).toBe(1);
    expect(trace.names).toEqual(["ok"]);
  });

  it("applyTo filtering: '*' applies everywhere, 'llm' only to chat, others skip", () => {
    const body = openaiBody();
    const { trace } = runRtkPipeline(body, FORMATS.OPENAI, {
      kind: "embedding",
      injectors: [
        { name: "star", prompt: "all", applyTo: "*", enabled: true },
        { name: "chat-only", prompt: "llm", applyTo: "llm", enabled: true },
      ],
    });
    expect(trace.applied).toBe(1);
    expect(trace.names).toEqual(["star"]);
  });

  it("disabled injectors never apply", () => {
    const body = openaiBody();
    const { trace } = runRtkPipeline(body, FORMATS.OPENAI, {
      injectors: [{ name: "off", prompt: "x", enabled: false }, { name: "on", prompt: "y", enabled: true }],
    });
    expect(trace.applied).toBe(1);
    expect(trace.names).toEqual(["on"]);
  });

  it("legacy applyUserInjectors wrapper == pipeline band (delegation, not duplication)", () => {
    const body1 = openaiBody([{ role: "system", content: "base" }, { role: "user", content: "hi" }]);
    const body2 = openaiBody([{ role: "system", content: "base" }, { role: "user", content: "hi" }]);
    const inj = [
      { name: "A", prompt: "alpha {{model}}", position: "append", enabled: true },
      { name: "B", prompt: "beta", position: "prepend", enabled: true },
    ];
    const legacyCount = applyUserInjectors(body1, FORMATS.OPENAI, { injectors: inj, ctx: { model: "gpt-x" } });
    const { trace } = runRtkPipeline(body2, FORMATS.OPENAI, { injectors: inj, ctx: { model: "gpt-x" } });
    expect(legacyCount).toBe(trace.applied);
    expect(body1.messages.find((m) => m.role === "system").content)
      .toBe(body2.messages.find((m) => m.role === "system").content);
  });

  it("captureSystemText / applyRendered are stable across formats", () => {
    const claude = { model: "claude", system: [{ type: "text", text: "base" }], messages: [{ role: "user", content: "hi" }] };
    const before = captureSystemText(claude, FORMATS.CLAUDE);
    const applied = applyRendered(claude, FORMATS.CLAUDE, { text: "injected", position: "append" }, before);
    expect(applied).toBe(true);
    expect(claude.system.some((b) => b.text === "injected")).toBe(true);

    const gemini = { system_instruction: { parts: [{ text: "base" }] }, contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    const gBefore = captureSystemText(gemini, FORMATS.GEMINI);
    const gApplied = applyRendered(gemini, FORMATS.GEMINI, { text: "g-injected", position: "prepend" }, gBefore);
    expect(gApplied).toBe(true);
    expect(gemini.system_instruction.parts[0].text).toBe("g-injected");
  });

  it("normalizeUserInjectors drops invalid rows, keeps valid (id carried)", () => {
    const out = normalizeUserInjectors([
      { name: "ok", prompt: "p", id: "abc" },
      { name: "", prompt: "x" },
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("abc");
  });
});
