// The tool_choice wire — object in, string out, on every CodeBuddy shore.
//
// Proven live four times: the family's upstream Go gateway 400s (business code
// 11101) when a request carries tool_choice as an object. The mapping under test
// is total: every input shape has exactly one answer, and an absent field stays
// absent rather than being invented.
import { describe, expect, it } from "vitest";
import {
  normalizeToolChoice,
  applyToolChoiceNormalization,
} from "../../open-sse/shared/codebuddy/toolChoice.js";
import { CodeBuddyFamilyExecutor } from "../../open-sse/executors/codebuddy-family.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { CODEBUDDY_FAMILY } from "../../open-sse/shared/codebuddy/profiles.js";

const NAMED = { type: "function", function: { name: "get_weather" } };

describe("normalizeToolChoice — the mapping table", () => {
  it("flattens a named function object to the bare name", () => {
    expect(normalizeToolChoice(NAMED)).toBe("get_weather");
  });

  it("flattens a function object with no name to 'auto'", () => {
    expect(normalizeToolChoice({ type: "function" })).toBe("auto");
    expect(normalizeToolChoice({ type: "function", function: {} })).toBe("auto");
    expect(normalizeToolChoice({ type: "function", function: { name: "" } })).toBe("auto");
    expect(normalizeToolChoice({ type: "function", function: { name: 42 } })).toBe("auto");
  });

  it("passes the auto / none / required directives through as strings", () => {
    expect(normalizeToolChoice({ type: "auto" })).toBe("auto");
    expect(normalizeToolChoice({ type: "none" })).toBe("none");
    expect(normalizeToolChoice({ type: "required" })).toBe("required");
  });

  it("leaves an already-string tool_choice unchanged", () => {
    for (const value of ["auto", "none", "required", "get_weather"]) {
      expect(normalizeToolChoice(value)).toBe(value);
    }
  });

  it("returns undefined for undefined — the key is never invented", () => {
    expect(normalizeToolChoice(undefined)).toBeUndefined();
  });

  it("fails permissive on shapes it does not recognise", () => {
    // A request that carried tools still wanted tools; "auto" is the upstream's
    // accepting answer and never pins a function that does not exist.
    expect(normalizeToolChoice(null)).toBe("auto");
    expect(normalizeToolChoice({ type: "web_search" })).toBe("auto");
    expect(normalizeToolChoice({})).toBe("auto");
  });
});

describe("applyToolChoiceNormalization — in place on the body", () => {
  it("rewrites tool_choice in place and returns the same body object", () => {
    const body = { tools: [], tool_choice: NAMED };
    expect(applyToolChoiceNormalization(body)).toBe(body);
    expect(body.tool_choice).toBe("get_weather");
  });

  it("leaves the key absent when the client sent none", () => {
    const body = { tools: [] };
    applyToolChoiceNormalization(body);
    expect("tool_choice" in body).toBe(false);
  });

  it("drops an explicit undefined rather than sending it", () => {
    const body = { tool_choice: undefined };
    applyToolChoiceNormalization(body);
    expect("tool_choice" in body).toBe(false);
  });
});

describe("the family executor applies it on all four products", () => {
  for (const providerId of CODEBUDDY_FAMILY) {
    it(`${providerId} sends tool_choice as a string`, () => {
      const exec = new CodeBuddyFamilyExecutor(providerId);
      const out = exec.transformRequest(
        "glm-5.3",
        { messages: [{ role: "user", content: "weather?" }], tools: [{ type: "function", function: { name: "get_weather" } }], tool_choice: NAMED },
        true,
        {},
      );
      expect(out.tool_choice).toBe("get_weather");
    });
  }

  it("keeps the absent case absent through the executor", () => {
    const exec = new CodeBuddyFamilyExecutor("codebuddy-cn");
    const out = exec.transformRequest("glm-5.3", { messages: [{ role: "user", content: "hi" }] }, true, {});
    expect("tool_choice" in out).toBe(false);
  });
});

describe("no other provider's wire is touched", () => {
  it("the default lane leaves an object tool_choice exactly as it was", () => {
    const exec = getExecutor("openai");
    if (!exec || exec instanceof CodeBuddyFamilyExecutor) return; // lane absent — nothing to prove
    const out = exec.transformRequest("gpt-4o", { messages: [{ role: "user", content: "hi" }], tool_choice: NAMED }, false, {});
    expect(out.tool_choice).toEqual(NAMED);
  });
});
