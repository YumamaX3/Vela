/**
 * User Prompt Injectors Test Suite — v0.9.19
 *
 * Proves the operator-defined injector engine:
 *
 *   I1. applyUserInjectors appends into the system message (OpenAI shape)
 *   I2. position "prepend" puts the prompt BEFORE existing system content
 *   I3. disabled injectors are skipped
 *   I4. applyTo filter (llm vs *) gates application
 *   I5. Claude and Gemini shapes both work (system string + parts)
 *   I6. normalizeUserInjectors filters malformed entries
 *   I7. injectSystemPrompt position param on Claude cache_control arrays
 */
import { describe, it, expect } from "vitest";
import { applyUserInjectors, normalizeUserInjectors, __test__ as userInjectorsTest } from "../../open-sse/rtk/userInjectors.js";
import { injectSystemPrompt } from "../../open-sse/rtk/systemInject.js";

const LOG = { info: () => {} };

describe("I1: append into OpenAI-shaped system message", () => {
  it("appends to an existing system message", () => {
    const body = { messages: [{ role: "system", content: "You are helpful." }, { role: "user", content: "hi" }] };
    const count = applyUserInjectors(body, "openai", {
      injectors: [{ name: "lang", prompt: "Answer in Indonesian.", enabled: true, position: "append", applyTo: "llm" }],
      kind: "llm",
      log: LOG,
    });
    expect(count).toBe(1);
    expect(body.messages[0].content).toContain("You are helpful.\n\nAnswer in Indonesian.");
  });

  it("creates a system message when none exists", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    applyUserInjectors(body, "openai", {
      injectors: [{ name: "x", prompt: "Be brief.", enabled: true }],
      kind: "llm",
      log: LOG,
    });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toBe("Be brief.");
  });

  it("handles the Responses instructions string", () => {
    const body = { instructions: "Be careful." };
    applyUserInjectors(body, "openai", {
      injectors: [{ name: "x", prompt: "Be fast.", enabled: true }],
      kind: "llm",
      log: LOG,
    });
    expect(body.instructions).toContain("Be careful.\n\nBe fast.");
  });
});

describe("I2: prepend position", () => {
  it("puts the injector BEFORE the existing system content", () => {
    const body = { messages: [{ role: "system", content: "Original system." }] };
    applyUserInjectors(body, "openai", {
      injectors: [{ name: "x", prompt: "TOP PRIORITY.", enabled: true, position: "prepend", applyTo: "llm" }],
      kind: "llm",
      log: LOG,
    });
    expect(body.messages[0].content).toBe("TOP PRIORITY.\n\nOriginal system.");
  });
});

describe("I3: disabled injectors are skipped", () => {
  it("applies nothing when disabled", () => {
    const body = { messages: [{ role: "system", content: "Keep me." }] };
    const count = applyUserInjectors(body, "openai", {
      injectors: [{ name: "x", prompt: "Nope.", enabled: false }],
      kind: "llm",
      log: LOG,
    });
    expect(count).toBe(0);
    expect(body.messages[0].content).toBe("Keep me.");
  });
});

describe("I4: applyTo filter", () => {
  it("skips llm-scoped injectors for a different kind", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const count = applyUserInjectors(body, "openai", {
      injectors: [{ name: "x", prompt: "chat only.", enabled: true, applyTo: "llm" }],
      kind: "tts",
      log: LOG,
    });
    expect(count).toBe(0);
    expect(body.messages.length).toBe(1);
  });

  it("applies * injectors to any kind", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const count = applyUserInjectors(body, "openai", {
      injectors: [{ name: "x", prompt: "everywhere.", enabled: true, applyTo: "*" }],
      kind: "tts",
      log: LOG,
    });
    expect(count).toBe(1);
  });
});

describe("I5: Claude and Gemini shapes", () => {
  it("appends to a Claude string system", () => {
    const body = { system: "Be careful.", messages: [{ role: "user", content: "hi" }] };
    applyUserInjectors(body, "claude", {
      injectors: [{ name: "x", prompt: "Be fast.", enabled: true }],
      kind: "llm",
      log: LOG,
    });
    expect(body.system).toBe("Be careful.\n\nBe fast.");
  });

  it("appends to Gemini systemInstruction parts", () => {
    const body = { systemInstruction: { parts: [{ text: "Be careful." }] } };
    applyUserInjectors(body, "gemini", {
      injectors: [{ name: "x", prompt: "Be fast.", enabled: true }],
      kind: "llm",
      log: LOG,
    });
    expect(body.systemInstruction.parts[1].text).toBe("Be fast.");
  });

  it("prepends into a Claude cache_control array inside the cached prefix", () => {
    const body = {
      system: [
        { type: "text", text: "Base instructions." },
        { type: "text", text: "Cached tail.", cache_control: { type: "ephemeral" } },
      ],
    };
    injectSystemPrompt(body, "claude", "TOP.", "prepend");
    // The injected block lands before the cache_control block.
    const idxCached = body.system.findIndex((b) => b.cache_control);
    expect(body.system[idxCached - 1].text).toBe("TOP.");
    expect(body.system[idxCached + 1]).toBeUndefined();
  });
});

describe("I6: normalizeUserInjectors filters malformed entries", () => {
  it("drops entries without a name or prompt, keeps valid ones", () => {
    const list = [
      { name: "good", prompt: "ok" },
      { name: "", prompt: "no name" },
      { prompt: "no name field" },
      { name: "empty prompt", prompt: "   " },
      null,
      "garbage",
      { name: "disabled", prompt: "off", enabled: false },
    ];
    const out = normalizeUserInjectors(list);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("good");
    expect(out[0].position).toBe("append");
    expect(out[0].applyTo).toBe("llm");
    expect(out[1].name).toBe("disabled");
    expect(out[1].enabled).toBe(false);
  });

  it("returns [] for non-array input", () => {
    expect(normalizeUserInjectors(null)).toEqual([]);
    expect(normalizeUserInjectors("nope")).toEqual([]);
    expect(normalizeUserInjectors(undefined)).toEqual([]);
  });
});

describe("I7: multi-injector layering", () => {
  it("applies multiple enabled injectors in order", () => {
    const body = { messages: [{ role: "system", content: "Base." }] };
    const count = applyUserInjectors(body, "openai", {
      injectors: [
        { name: "a", prompt: "First.", enabled: true },
        { name: "b", prompt: "Second.", enabled: true },
        { name: "c", prompt: "Skip me.", enabled: false },
      ],
      kind: "llm",
      log: LOG,
    });
    expect(count).toBe(2);
    expect(body.messages[0].content).toBe("Base.\n\nFirst.\n\nSecond.");
  });
});
