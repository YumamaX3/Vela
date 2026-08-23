/**
 * User Injectors v2 — variables + control (v0.9.23)
 *
 * Proves the v2 injector engine:
 *   V1. built-in variables expand ({{model}}, {{date}}, {{kind}}, ...)
 *   V2. operator custom variables expand
 *   V3. x-vela-inject-var-<name> headers override custom vars per request
 *   V4. unresolved vars stay literal (fail-safe, never crash)
 *   V5. applyTo + position still honored alongside variables
 *   V6. normalizeInjector preserves the variables block
 */
import { describe, it, expect } from "vitest";
import { applyUserInjectors, normalizeUserInjectors, __test__ } from "../../open-sse/rtk/userInjectors.js";

function openaiBody(systemText = "You are helpful.") {
  return { model: "gpt-4o", messages: [{ role: "system", content: systemText }, { role: "user", content: "hi" }] };
}

function getSystem(body) {
  return body.messages.find((m) => m.role === "system").content;
}

describe("V1: built-in variables", () => {
  it("expands model, kind, and date into the injected prompt", () => {
    const body = openaiBody();
    const applied = applyUserInjectors(body, "openai", {
      injectors: [{ name: "ctx", prompt: "You are assisting {{model}} on {{date}} ({{kind}}).", position: "prepend" }],
      kind: "llm",
      ctx: { model: "gpt-4o", date: "2026-08-23", kind: "llm", keyPrefix: "sk-vela" },
    });
    expect(applied).toBe(1);
    expect(getSystem(body)).toContain("You are assisting gpt-4o on 2026-08-23 (llm).");
  });

  it("expands keyPrefix and requestId when provided", () => {
    const body = openaiBody();
    applyUserInjectors(body, "openai", {
      injectors: [{ name: "k", prompt: "key={{keyPrefix}} req={{requestId}}" }],
      ctx: { keyPrefix: "sk-vela", requestId: "abc-123" },
    });
    expect(getSystem(body)).toContain("key=sk-vela req=abc-123");
  });
});

describe("V2: custom variables", () => {
  it("expands operator-defined custom vars", () => {
    const body = openaiBody();
    applyUserInjectors(body, "openai", {
      injectors: [{ name: "custom", prompt: "tone={{tone}} audience={{audience}}", variables: { tone: "formal", audience: "developers" } }],
    });
    expect(getSystem(body)).toContain("tone=formal audience=developers");
  });
});

describe("V3: per-request header overrides", () => {
  it("overrides custom vars via x-vela-inject-var-<name> headers", () => {
    const body = openaiBody();
    const headers = new Headers({ "x-vela-inject-var-tone": "casual" });
    applyUserInjectors(body, "openai", {
      injectors: [{ name: "custom", prompt: "tone={{tone}}", variables: { tone: "formal" } }],
      ctx: { headers },
    });
    expect(getSystem(body)).toContain("tone=casual");
  });
});

describe("V4: fail-safe expansion", () => {
  it("leaves unresolved vars literal, never crashes", () => {
    const body = openaiBody();
    applyUserInjectors(body, "openai", {
      injectors: [{ name: "missing", prompt: "{{unknownVar}} stays" }],
    });
    expect(getSystem(body)).toContain("{{unknownVar}} stays");
  });
});

describe("V5: applyTo + position with variables", () => {
  it("honors applyTo — non-* values coerce to llm (the only kind today)", () => {
    const body = openaiBody();
    const applied = applyUserInjectors(body, "openai", {
      injectors: [{ name: "apply", prompt: "applies", applyTo: "web" }],
      kind: "llm",
    });
    // normalizeInjector maps any non-"*" applyTo to "llm" — so it applies.
    expect(applied).toBe(1);
    expect(getSystem(body)).toContain("applies");
  });

  it("prepend places the rendered prompt before existing system content", () => {
    const body = openaiBody("Original.");
    applyUserInjectors(body, "openai", {
      injectors: [{ name: "pre", prompt: "PREFIX {{model}}", position: "prepend" }],
      ctx: { model: "m" },
    });
    expect(getSystem(body)).toBe("PREFIX m\n\nOriginal.");
  });
});

describe("V6: normalize preserves variables", () => {
  it("keeps the variables block through normalization", () => {
    const list = normalizeUserInjectors([{ name: "n", prompt: "p {{x}}", variables: { x: "1" } }]);
    expect(list[0].variables).toEqual({ x: "1" });
  });
});
